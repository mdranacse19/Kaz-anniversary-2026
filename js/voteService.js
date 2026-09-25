/* KAZ Anniversary Tour 2026 — Vote service (Firebase + plain JS)
 *
 * Architecture: Browser JS → Cloud Firestore → shared votes
 * Totals are calculated in JavaScript from vote documents.
 * localStorage is NOT used for vote counts (Anonymous Auth UID is identity).
 */
(function (global) {
  const DEST_IDS = ["sundarbans", "sylhet", "sajekkaptai", "nepal", "bandarban", "coxstmartin"];
  const COLLECTION = "votes";
  const NAMES = "voterNames";
  const KEY_FALLBACK_VOTER = "kaz-2026-firebase-voter";

  let busy = false;
  let lastResults = null;
  let authReady = null;
  let authMode = "pending"; // "anonymous" | "fallback" | "pending"
  let fallbackVoterId = null;
  let unsubLive = null;
  const liveListeners = new Set();

  function emptyCounts() {
    return DEST_IDS.reduce((acc, id) => {
      acc[id] = 0;
      return acc;
    }, {});
  }

  function calculateTotals(votes) {
    const counts = emptyCounts();
    const list = Array.isArray(votes) ? votes : [];
    for (const v of list) {
      if (!v || typeof v !== "object") continue;
      const id = v.destination || v.destinationId;
      if (DEST_IDS.includes(id)) counts[id] += 1;
    }
    const totalVotes = DEST_IDS.reduce((s, id) => s + counts[id], 0);
    const percentages = emptyCounts();
    DEST_IDS.forEach((id) => {
      percentages[id] = totalVotes > 0 ? Math.round((counts[id] / totalVotes) * 100) : 0;
    });
    return { counts, totalVotes, percentages };
  }

  function nowIso() {
    const d = new Date();
    const shifted = new Date(d.getTime() + 6 * 60 * 60 * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return (
      `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
      `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}+06:00`
    );
  }

  function firebaseReady() {
    return !!(
      global.FIREBASE_ENABLED &&
      global.firebase &&
      global.firebase.apps &&
      global.firebase.app
    );
  }

  function ensureApp() {
    if (!global.FIREBASE_ENABLED) {
      const err = new Error("firebase_not_configured");
      err.code = "firebase_not_configured";
      throw err;
    }
    if (!global.firebase) {
      const err = new Error("firebase_sdk_missing");
      err.code = "firebase_sdk_missing";
      throw err;
    }
    if (!global.firebase.apps.length) {
      global.firebase.initializeApp(global.FIREBASE_CONFIG);
    }
    return {
      auth: global.firebase.auth(),
      db: global.firebase.firestore(),
    };
  }

  function getOrCreateFallbackVoterId() {
    if (fallbackVoterId) return fallbackVoterId;
    try {
      let id = localStorage.getItem(KEY_FALLBACK_VOTER);
      if (!id) {
        id =
          global.crypto && crypto.randomUUID
            ? crypto.randomUUID()
            : "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(KEY_FALLBACK_VOTER, id);
      }
      fallbackVoterId = id;
      return id;
    } catch {
      fallbackVoterId = "ephemeral-" + Date.now().toString(36);
      return fallbackVoterId;
    }
  }

  async function ensureAuth() {
    if (!authReady) {
      authReady = (async () => {
        const { auth } = ensureApp();
        if (auth.currentUser) {
          authMode = "anonymous";
          return { uid: auth.currentUser.uid, mode: "anonymous" };
        }
        try {
          const cred = await auth.signInAnonymously();
          authMode = "anonymous";
          return { uid: cred.user.uid, mode: "anonymous" };
        } catch (e) {
          const code = e && e.code ? String(e.code) : "";
          // Auth product not enabled yet — allow office voting via client voter id.
          if (
            code === "auth/configuration-not-found" ||
            code === "auth/operation-not-allowed" ||
            code === "auth/admin-restricted-operation"
          ) {
            authMode = "fallback";
            console.warn(
              "[VoteService] Firebase Anonymous Auth unavailable (" +
                code +
                "). Using local voter id. Enable Authentication → Anonymous in Firebase Console when ready."
            );
            return { uid: getOrCreateFallbackVoterId(), mode: "fallback" };
          }
          throw e;
        }
      })().catch((e) => {
        authReady = null;
        throw e;
      });
    }
    return authReady;
  }

  function getVoterId() {
    if (authMode === "fallback") return getOrCreateFallbackVoterId();
    try {
      const { auth } = ensureApp();
      if (auth.currentUser) return auth.currentUser.uid;
    } catch {
      /* not ready */
    }
    return fallbackVoterId;
  }

  function normalizeVoterName(raw) {
    if (typeof raw !== "string") return "";
    return raw.replace(/\s+/g, " ").trim().slice(0, 60);
  }

  /** Lock id: trimmed name, Latin case-folded. Bengali is unchanged by toLowerCase. */
  function voterNameKey(raw) {
    let key = normalizeVoterName(raw).toLowerCase();
    if (!key) return "";
    key = key.replace(/\//g, "\u2044");
    if (key === "." || key === ".." || /^__.*__$/.test(key)) key = "n-" + key;
    return key.slice(0, 700);
  }

  function sameNameTaken(votes, nameKey, uid) {
    if (!nameKey) return false;
    return votes.some((v) => {
      if (v.voter_id === uid) return false;
      const key = v.nameKey || voterNameKey(v.name);
      return key === nameKey;
    });
  }

  function canChangeVote() {
    return !!(global.SITE_CONFIG && global.SITE_CONFIG.allowChangeVote === true);
  }

  function docsToVotes(snapshot) {
    const votes = [];
    snapshot.forEach((doc) => {
      const data = doc.data() || {};
      if (!DEST_IDS.includes(data.destination)) return;
      votes.push({
        destination: data.destination,
        voter_id: doc.id,
        name: typeof data.name === "string" ? data.name : "",
        nameKey: typeof data.nameKey === "string" ? data.nameKey : "",
        voted_at: data.voted_at || data.updated_at || null,
      });
    });
    return votes;
  }

  function buildResults(votes, voterId, error) {
    const { counts, totalVotes, percentages } = calculateTotals(votes);
    let myVote = null;
    if (voterId) {
      const mine = votes.find((v) => v.voter_id === voterId);
      if (mine) {
        myVote = {
          destination: mine.destination,
          destinationId: mine.destination,
          voter_id: mine.voter_id,
          voterId: mine.voter_id,
          name: mine.name || "",
          voted_at: mine.voted_at,
        };
      }
    }
    const ok = !error;
    return {
      ok,
      votes,
      counts,
      percentages,
      totalVotes,
      updatedAt: nowIso(),
      myVote,
      localVote: myVote,
      persistence: "firebase-firestore",
      canWriteRemote: ok && global.FIREBASE_ENABLED,
      publishedOk: ok,
      error: error || null,
    };
  }

  function unavailable(code) {
    const results = buildResults([], null, code || "unavailable");
    results.canWriteRemote = false;
    results.publishedOk = false;
    lastResults = results;
    return results;
  }

  async function fetchAllVotes() {
    const { db } = ensureApp();
    const user = await ensureAuth();
    const snap = await db.collection(COLLECTION).get();
    const votes = docsToVotes(snap);
    lastResults = buildResults(votes, user.uid);
    return lastResults;
  }

  async function getResults() {
    try {
      if (!global.FIREBASE_ENABLED) return unavailable("firebase_not_configured");
      return await fetchAllVotes();
    } catch (e) {
      const code = e?.code || e?.message || "unavailable";
      return unavailable(String(code));
    }
  }

  function getCastVote() {
    return (lastResults && lastResults.myVote) || null;
  }

  function hasUserVoted() {
    return !!getCastVote();
  }

  function notifyLive(results) {
    liveListeners.forEach((fn) => {
      try {
        fn(results);
      } catch {
        /* listener error */
      }
    });
  }

  /** Realtime Live Results — Device B sees Device A without reload. */
  function subscribeResults(callback) {
    if (typeof callback === "function") liveListeners.add(callback);

    if (!global.FIREBASE_ENABLED) {
      const r = unavailable("firebase_not_configured");
      if (callback) callback(r);
      return () => liveListeners.delete(callback);
    }

    if (!unsubLive) {
      (async () => {
        try {
          const { db } = ensureApp();
          await ensureAuth();
          unsubLive = db.collection(COLLECTION).onSnapshot(
            (snap) => {
              const voterId = getVoterId();
              lastResults = buildResults(docsToVotes(snap), voterId);
              notifyLive(lastResults);
            },
            (err) => {
              const r = unavailable(err?.code || "snapshot_error");
              notifyLive(r);
            }
          );
        } catch (e) {
          const r = unavailable(e?.code || e?.message || "unavailable");
          notifyLive(r);
        }
      })();
    } else if (lastResults && callback) {
      callback(lastResults);
    }

    return () => {
      liveListeners.delete(callback);
    };
  }

  async function castVote(destinationId, voterName) {
    if (busy) return { ok: false, error: "busy" };
    if (!DEST_IDS.includes(destinationId)) return { ok: false, error: "invalid" };
    const name = normalizeVoterName(voterName);
    if (!name) return { ok: false, error: "name_required" };
    if (!global.FIREBASE_ENABLED) return { ok: false, error: "firebase_not_configured", results: unavailable("firebase_not_configured") };

    const nameKey = voterNameKey(name);
    busy = true;
    try {
      const { db } = ensureApp();
      const user = await ensureAuth();
      const voteRef = db.collection(COLLECTION).doc(user.uid);
      const stamp = nowIso();
      const record = {
        destination: destinationId,
        name,
        nameKey,
        voted_at: stamp,
        updated_at: stamp,
      };

      // Uniqueness = name only (any browser). Scan votes; do not require voterNames
      // (that collection fails if Console rules were never updated).
      const priorSnap = await db.collection(COLLECTION).get();
      const existingMine = priorSnap.docs.find((d) => d.id === user.uid);
      if (existingMine) {
        const results = await fetchAllVotes();
        return { ok: false, error: "already", vote: existingMine.data(), results };
      }
      if (sameNameTaken(docsToVotes(priorSnap), nameKey, user.uid)) {
        const results = await fetchAllVotes();
        return { ok: false, error: "name_taken", name, results };
      }

      await voteRef.set(record);

      // Soft lock in voterNames when rules allow it; ignore if permission-denied.
      try {
        const nameRef = db.collection(NAMES).doc(nameKey);
        const nameSnap = await nameRef.get();
        if (!nameSnap.exists || nameSnap.data().uid === user.uid) {
          await nameRef.set({ uid: user.uid, name, nameKey });
        }
      } catch (_) {
        /* voterNames optional — votes collection is source of truth */
      }

      const results = await fetchAllVotes();
      return { ok: true, vote: { ...record, voter_id: user.uid }, results };
    } catch (e) {
      const code = e && e.code ? String(e.code) : "";
      if (code === "permission-denied" || code === "firestore/permission-denied") {
        return { ok: false, error: "permission", results: lastResults };
      }
      return { ok: false, error: code || "network", results: lastResults };
    } finally {
      busy = false;
    }
  }

  async function changeVote(destinationId) {
    if (!canChangeVote()) {
      const results = lastResults || (await getResults().catch(() => unavailable("locked")));
      return { ok: false, error: "locked", results };
    }
    if (busy) return { ok: false, error: "busy" };
    if (!DEST_IDS.includes(destinationId)) return { ok: false, error: "invalid" };
    if (!global.FIREBASE_ENABLED) return { ok: false, error: "firebase_not_configured", results: unavailable("firebase_not_configured") };

    busy = true;
    try {
      const { db } = ensureApp();
      const user = await ensureAuth();
      const ref = db.collection(COLLECTION).doc(user.uid);
      const existing = await ref.get();
      const stamp = nowIso();

      if (!existing.exists) {
        const results = await fetchAllVotes();
        return { ok: false, error: "name_required", results };
      }

      const prev = existing.data() || {};
      if (prev.destination === destinationId) {
        const results = await fetchAllVotes();
        return {
          ok: true,
          unchanged: true,
          vote: { ...prev, voter_id: user.uid },
          results,
        };
      }

      const displayName = normalizeVoterName(prev.name);
      const record = {
        destination: destinationId,
        name: displayName,
        nameKey: prev.nameKey || voterNameKey(displayName),
        voted_at: prev.voted_at || stamp,
        updated_at: stamp,
      };
      await ref.set(record);
      const results = await fetchAllVotes();
      return { ok: true, vote: { ...record, voter_id: user.uid }, results };
    } catch (e) {
      return { ok: false, error: e?.code || "network", results: lastResults };
    } finally {
      busy = false;
    }
  }

  async function clearVote() {
    if (!canChangeVote()) {
      const results = lastResults || (await getResults().catch(() => unavailable("locked")));
      return { ok: false, error: "locked", results };
    }
    if (busy) return { ok: false, error: "busy" };
    if (!global.FIREBASE_ENABLED) return { ok: false, error: "firebase_not_configured", results: unavailable("firebase_not_configured") };

    busy = true;
    try {
      const { db } = ensureApp();
      const user = await ensureAuth();
      const voteRef = db.collection(COLLECTION).doc(user.uid);
      const existing = await voteRef.get();
      if (!existing.exists) {
        const results = await fetchAllVotes();
        return { ok: true, cleared: false, results };
      }
      const prev = existing.data() || {};
      const key = prev.nameKey || voterNameKey(prev.name);
      await voteRef.delete();
      if (key) {
        try {
          const nameRef = db.collection(NAMES).doc(key);
          const nameSnap = await nameRef.get();
          if (nameSnap.exists && nameSnap.data().uid === user.uid) {
            await nameRef.delete();
          }
        } catch (_) {
          /* optional */
        }
      }
      const results = await fetchAllVotes();
      return { ok: true, cleared: true, results };
    } catch (e) {
      return { ok: false, error: e?.code || "network", results: lastResults };
    } finally {
      busy = false;
    }
  }

  async function undoVote() {
    return clearVote();
  }

  function purgeLegacyVoteStorage() {
    try {
      localStorage.removeItem("kaz-2026-cast-vote");
      localStorage.removeItem("kaz-2026-local-vote-log");
      localStorage.removeItem("kaz-2026-voter-id");
      // Keep KEY_FALLBACK_VOTER — identity when Anonymous Auth is unavailable
    } catch {
      /* private mode */
    }
  }

  purgeLegacyVoteStorage();

  global.VoteService = {
    DEST_IDS,
    getVoterId,
    getCastVote,
    hasUserVoted,
    canChangeVote,
    calculateTotals,
    getResults,
    subscribeResults,
    castVote,
    changeVote,
    clearVote,
    undoVote,
  };
})(typeof window !== "undefined" ? window : globalThis);
