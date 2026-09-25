/* KAZ Anniversary Tour 2026 — Vote service (Firebase + plain JS)
 *
 * votes/{uid}: full record including name/nameKey (owner-read + Console admin).
 * publicTallies/live: counts only — public live results (no names on the wire).
 * voterNames/{nameHash}: same-name lock (SHA-256 id, no plaintext name in path).
 */
(function (global) {
  const DEST_IDS = ["sundarbans", "sylhet", "sajekkaptai", "nepal", "bandarban", "coxstmartin"];
  const COLLECTION = "votes";
  const TALLIES = "publicTallies";
  const TALLY_DOC = "live";
  const NAMES = "voterNames";
  const KEY_FALLBACK_VOTER = "kaz-2026-firebase-voter";
  const KEY_LOCAL_NAME = "kaz-2026-voter-display-name";

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

  function totalsFromCounts(countsIn) {
    const counts = emptyCounts();
    DEST_IDS.forEach((id) => {
      counts[id] = Math.max(0, Number(countsIn && countsIn[id]) || 0);
    });
    const totalVotes = DEST_IDS.reduce((s, id) => s + counts[id], 0);
    const percentages = emptyCounts();
    DEST_IDS.forEach((id) => {
      percentages[id] = totalVotes > 0 ? Math.round((counts[id] / totalVotes) * 100) : 0;
    });
    return { counts, totalVotes, percentages };
  }

  function calculateTotals(votes) {
    const counts = emptyCounts();
    const list = Array.isArray(votes) ? votes : [];
    for (const v of list) {
      if (!v || typeof v !== "object") continue;
      const id = v.destination || v.destinationId;
      if (DEST_IDS.includes(id)) counts[id] += 1;
    }
    return totalsFromCounts(counts);
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
          if (
            code === "auth/configuration-not-found" ||
            code === "auth/operation-not-allowed" ||
            code === "auth/admin-restricted-operation"
          ) {
            authMode = "fallback";
            console.warn(
              "[VoteService] Anonymous Auth is required for private votes. Enable Authentication → Anonymous."
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

  function requireAnonymousUser(user) {
    if (!user || user.mode === "fallback") {
      const err = new Error("auth_required");
      err.code = "auth_required";
      throw err;
    }
  }

  function normalizeVoterName(raw) {
    if (typeof raw !== "string") return "";
    return raw.replace(/\s+/g, " ").trim().slice(0, 60);
  }

  function voterNameKey(raw) {
    return normalizeVoterName(raw).toLowerCase();
  }

  function bytesToHex(buf) {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function nameHashFrom(raw) {
    const key = voterNameKey(raw);
    if (!key) return "";
    if (!global.crypto || !crypto.subtle) {
      const err = new Error("crypto_unavailable");
      err.code = "crypto_unavailable";
      throw err;
    }
    const data = new TextEncoder().encode(key);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return bytesToHex(digest);
  }

  function rememberLocalName(name) {
    try {
      if (name) localStorage.setItem(KEY_LOCAL_NAME, name);
      else localStorage.removeItem(KEY_LOCAL_NAME);
    } catch {
      /* private mode */
    }
  }

  function readLocalName() {
    try {
      return normalizeVoterName(localStorage.getItem(KEY_LOCAL_NAME) || "");
    } catch {
      return "";
    }
  }

  function canChangeVote() {
    return !!(global.SITE_CONFIG && global.SITE_CONFIG.allowChangeVote === true);
  }

  function talliesRef(db) {
    return db.collection(TALLIES).doc(TALLY_DOC);
  }

  async function bumpTally(db, fromId, toId) {
    const ref = talliesRef(db);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const counts = emptyCounts();
      if (snap.exists) {
        const c = (snap.data() || {}).counts || {};
        DEST_IDS.forEach((id) => {
          counts[id] = Math.max(0, Number(c[id]) || 0);
        });
      }
      if (fromId && DEST_IDS.includes(fromId)) {
        counts[fromId] = Math.max(0, counts[fromId] - 1);
      }
      if (toId && DEST_IDS.includes(toId)) {
        counts[toId] = counts[toId] + 1;
      }
      const totalVotes = DEST_IDS.reduce((s, id) => s + counts[id], 0);
      tx.set(ref, { counts, totalVotes, updatedAt: nowIso() });
    });
  }

  function buildResults(countsIn, myVote, error) {
    const { counts, totalVotes, percentages } = totalsFromCounts(countsIn);
    const ok = !error;
    return {
      ok,
      votes: [],
      counts,
      percentages,
      totalVotes,
      updatedAt: nowIso(),
      myVote: myVote || null,
      localVote: myVote || null,
      persistence: "firebase-firestore",
      canWriteRemote: ok && global.FIREBASE_ENABLED,
      publishedOk: ok,
      error: error || null,
    };
  }

  function unavailable(code) {
    const results = buildResults(emptyCounts(), null, code || "unavailable");
    results.canWriteRemote = false;
    results.publishedOk = false;
    lastResults = results;
    return results;
  }

  function parseTalliesSnap(snap) {
    if (!snap || !snap.exists) return emptyCounts();
    return totalsFromCounts((snap.data() || {}).counts || {}).counts;
  }

  async function loadOwnVote(db, uid) {
    try {
      const mine = await db.collection(COLLECTION).doc(uid).get();
      if (!mine.exists) return null;
      const d = mine.data() || {};
      if (!DEST_IDS.includes(d.destination)) return null;
      const name = normalizeVoterName(d.name) || readLocalName();
      if (name) rememberLocalName(name);
      return {
        destination: d.destination,
        destinationId: d.destination,
        voter_id: uid,
        voterId: uid,
        name,
        voted_at: d.voted_at || d.updated_at || null,
      };
    } catch {
      return null;
    }
  }

  async function fetchResults() {
    const { db } = ensureApp();
    const user = await ensureAuth();
    const tallySnap = await talliesRef(db).get();
    const counts = parseTalliesSnap(tallySnap);
    const myVote = user.mode === "anonymous" ? await loadOwnVote(db, user.uid) : null;
    lastResults = buildResults(counts, myVote, null);
    return lastResults;
  }

  async function getResults() {
    try {
      if (!global.FIREBASE_ENABLED) return unavailable("firebase_not_configured");
      return await fetchResults();
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

  /** Live results: publicTallies only — other users' names never on this path. */
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
          const user = await ensureAuth();
          unsubLive = talliesRef(db).onSnapshot(
            async (snap) => {
              const counts = parseTalliesSnap(snap);
              const uid = getVoterId() || user.uid;
              const myVote = authMode === "anonymous" ? await loadOwnVote(db, uid) : null;
              lastResults = buildResults(counts, myVote, null);
              notifyLive(lastResults);
            },
            (err) => {
              notifyLive(unavailable(err?.code || "snapshot_error"));
            }
          );
        } catch (e) {
          notifyLive(unavailable(e?.code || e?.message || "unavailable"));
        }
      })();
    } else if (lastResults && callback) {
      callback(lastResults);
    }

    return () => {
      liveListeners.delete(callback);
    };
  }

  async function claimNameHash(db, nameHash, uid) {
    const nameRef = db.collection(NAMES).doc(nameHash);
    const nameSnap = await nameRef.get();
    if (nameSnap.exists && nameSnap.data().uid !== uid) {
      return { ok: false, error: "name_taken" };
    }
    await nameRef.set({ uid });
    return { ok: true };
  }

  async function castVote(destinationId, voterName) {
    if (busy) return { ok: false, error: "busy" };
    if (!DEST_IDS.includes(destinationId)) return { ok: false, error: "invalid" };
    const name = normalizeVoterName(voterName);
    if (!name) return { ok: false, error: "name_required" };
    if (!global.FIREBASE_ENABLED) return { ok: false, error: "firebase_not_configured", results: unavailable("firebase_not_configured") };

    busy = true;
    try {
      const nameKey = voterNameKey(name);
      const nameHash = await nameHashFrom(name);
      const { db } = ensureApp();
      const user = await ensureAuth();
      requireAnonymousUser(user);

      const voteRef = db.collection(COLLECTION).doc(user.uid);
      const existing = await voteRef.get();
      if (existing.exists) {
        const results = await fetchResults();
        return { ok: false, error: "already", vote: existing.data(), results };
      }

      const claim = await claimNameHash(db, nameHash, user.uid);
      if (!claim.ok) {
        const results = await fetchResults();
        return { ok: false, error: "name_taken", name, results };
      }

      const stamp = nowIso();
      const record = {
        destination: destinationId,
        name,
        nameKey,
        nameHash,
        voted_at: stamp,
        updated_at: stamp,
      };

      await voteRef.set(record);
      rememberLocalName(name);
      await bumpTally(db, null, destinationId);

      const results = await fetchResults();
      return { ok: true, vote: { ...record, voter_id: user.uid }, results };
    } catch (e) {
      const code = e && e.code ? String(e.code) : "";
      if (code === "auth_required") return { ok: false, error: "auth_required", results: lastResults };
      if (code === "permission-denied" || code === "firestore/permission-denied") {
        return { ok: false, error: "permission", results: lastResults };
      }
      if (code === "crypto_unavailable") return { ok: false, error: "crypto_unavailable", results: lastResults };
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
      requireAnonymousUser(user);

      const ref = db.collection(COLLECTION).doc(user.uid);
      const existing = await ref.get();
      const stamp = nowIso();

      if (!existing.exists) {
        const results = await fetchResults();
        return { ok: false, error: "name_required", results };
      }

      const prev = existing.data() || {};
      if (prev.destination === destinationId) {
        const results = await fetchResults();
        return {
          ok: true,
          unchanged: true,
          vote: { ...prev, voter_id: user.uid },
          results,
        };
      }

      const displayName = normalizeVoterName(prev.name) || readLocalName();
      const record = {
        destination: destinationId,
        name: displayName,
        nameKey: typeof prev.nameKey === "string" ? prev.nameKey : voterNameKey(displayName),
        nameHash: typeof prev.nameHash === "string" ? prev.nameHash : await nameHashFrom(displayName),
        voted_at: prev.voted_at || stamp,
        updated_at: stamp,
      };
      await ref.set(record);
      await bumpTally(db, prev.destination, destinationId);

      const results = await fetchResults();
      return { ok: true, vote: { ...record, voter_id: user.uid }, results };
    } catch (e) {
      const code = e && e.code ? String(e.code) : "";
      if (code === "auth_required") return { ok: false, error: "auth_required", results: lastResults };
      return { ok: false, error: code || "network", results: lastResults };
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
      requireAnonymousUser(user);

      const voteRef = db.collection(COLLECTION).doc(user.uid);
      const existing = await voteRef.get();
      if (!existing.exists) {
        const results = await fetchResults();
        return { ok: true, cleared: false, results };
      }
      const prev = existing.data() || {};
      const hash =
        (typeof prev.nameHash === "string" && prev.nameHash) ||
        (await nameHashFrom(prev.name || prev.nameKey || "").catch(() => ""));
      await voteRef.delete();
      rememberLocalName("");
      if (hash) {
        try {
          const nameRef = db.collection(NAMES).doc(hash);
          const nameSnap = await nameRef.get();
          if (nameSnap.exists && nameSnap.data().uid === user.uid) {
            await nameRef.delete();
          }
        } catch {
          /* optional */
        }
      }
      if (DEST_IDS.includes(prev.destination)) {
        await bumpTally(db, prev.destination, null);
      }
      const results = await fetchResults();
      return { ok: true, cleared: true, results };
    } catch (e) {
      const code = e && e.code ? String(e.code) : "";
      if (code === "auth_required") return { ok: false, error: "auth_required", results: lastResults };
      return { ok: false, error: code || "network", results: lastResults };
    } finally {
      busy = false;
    }
  }

  async function undoVote() {
    return clearVote();
  }

  /**
   * Recount all votes → publicTallies/live.
   * Needs temporary list permission on votes (or run before tightening rules).
   */
  async function rebuildPublicTallies() {
    if (!global.FIREBASE_ENABLED) return { ok: false, error: "firebase_not_configured" };
    const { db } = ensureApp();
    const user = await ensureAuth();
    requireAnonymousUser(user);

    let snap;
    try {
      snap = await db.collection(COLLECTION).get();
    } catch (e) {
      return {
        ok: false,
        error: e?.code || "permission",
        message:
          "Cannot list votes. Publish rules that allow signed-in list of votes, rebuild, then restore owner-only rules.",
      };
    }

    const counts = emptyCounts();
    let skipped = 0;
    snap.forEach((docSnap) => {
      const dest = (docSnap.data() || {}).destination;
      if (DEST_IDS.includes(dest)) counts[dest] += 1;
      else skipped += 1;
    });
    const totalVotes = DEST_IDS.reduce((s, id) => s + counts[id], 0);
    const payload = { counts, totalVotes, updatedAt: nowIso(), rebuiltAt: nowIso() };
    await talliesRef(db).set(payload);

    lastResults = buildResults(counts, await loadOwnVote(db, user.uid), null);
    notifyLive(lastResults);
    return { ok: true, ...payload, voteDocs: snap.size, skipped };
  }

  function purgeLegacyVoteStorage() {
    try {
      localStorage.removeItem("kaz-2026-cast-vote");
      localStorage.removeItem("kaz-2026-local-vote-log");
      localStorage.removeItem("kaz-2026-voter-id");
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
    rebuildPublicTallies,
  };
})(typeof window !== "undefined" ? window : globalThis);
