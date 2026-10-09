/* KAZ Anniversary Tour 2026 — live tallies + employee OTP API.
 *
 * Counts come from publicTallies/live. The roster comes from publicVotes.
 * Casting goes through the vote API.
 * The browser never lists the private votes collection and never decides uniqueness.
 * It remembers its own cast vote (localStorage) only to keep showing it after a reload.
 */
(function (global) {
  const DEST_IDS = ["sundarbans", "sylhet", "sajekkaptai", "nepal", "bandarban", "coxstmartin"];
  const TALLIES = "publicTallies";
  const TALLY_DOC = "live";
  const PUBLIC_VOTES = "publicVotes";
  const VOTE_KEY = "kaz2026.vote";

  let busy = false;
  let lastResults = null;
  let sessionVote = null;
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
    return { db: global.firebase.firestore() };
  }

  let allowChangeVoteCache = false;
  let voteApiUrlCache = "";
  let closesAtCache = "";
  let closesAtLoaded = false;

  function canChangeVote() {
    return allowChangeVoteCache;
  }

  function votingClosesAt() {
    return closesAtCache;
  }

  async function loadVotingClose() {
    if (closesAtLoaded) return closesAtCache;
    const bases = [apiBase()];
    if (!bases.includes("http://127.0.0.1:8787")) bases.push("http://127.0.0.1:8787");
    for (const base of bases) {
      try {
        const res = await fetch(base + "/api/vote/close", { method: "GET" });
        if (!res.ok) continue;
        const data = await res.json();
        if (!data || data.ok === false) continue;
        closesAtCache = data.closesAt ? String(data.closesAt) : "";
        allowChangeVoteCache = data.allowChangeVote === true;
        voteApiUrlCache = data.voteApiUrl ? String(data.voteApiUrl).replace(/\/$/, "") : "";
        closesAtLoaded = true;
        return closesAtCache;
      } catch {
        /* try the next vote server */
      }
    }
    return closesAtCache;
  }

  function votingClosesAtMs() {
    const raw = votingClosesAt().trim();
    if (!raw) return null;
    const at = Date.parse(raw);
    return Number.isFinite(at) ? at : null;
  }

  function votingClosed(nowMs) {
    const at = votingClosesAtMs();
    if (at == null) return false;
    return (nowMs == null ? Date.now() : Number(nowMs)) >= at;
  }

  function apiBase() {
    if (voteApiUrlCache) return voteApiUrlCache;
    const host = global.location ? global.location.hostname : "";
    const local = host === "127.0.0.1" || host === "localhost" || host === "";
    return local ? "http://127.0.0.1:8787" : "";
  }

  function talliesRef(db) {
    return db.collection(TALLIES).doc(TALLY_DOC);
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
      canWriteRemote: ok && !!global.FIREBASE_ENABLED,
      publishedOk: ok,
      error: error || null,
    };
  }

  function keepKnownResults(code) {
    if (lastResults && lastResults.publishedOk) return lastResults;
    return unavailable(code);
  }

  function unavailable(code) {
    const results = buildResults(emptyCounts(), sessionVote, code || "unavailable");
    results.canWriteRemote = false;
    results.publishedOk = false;
    lastResults = results;
    return results;
  }

  function parseTalliesSnap(snap) {
    if (!snap || !snap.exists) return emptyCounts();
    return totalsFromCounts((snap.data() || {}).counts || {}).counts;
  }

  function rememberSession(vote) {
    if (!vote || !DEST_IDS.includes(vote.destination || vote.destinationId)) {
      sessionVote = null;
      return;
    }
    const destination = vote.destination || vote.destinationId;
    sessionVote = {
      destination,
      destinationId: destination,
      name: vote.name || "",
      employee_id: vote.employee_id || "",
      voted_at: vote.voted_at || null,
    };
  }

  function readStoredVote() {
    try {
      const vote = JSON.parse(localStorage.getItem(VOTE_KEY) || "null");
      return vote && typeof vote === "object" ? vote : null;
    } catch {
      return null;
    }
  }

  function storeVote(vote) {
    try {
      if (!vote) {
        localStorage.removeItem(VOTE_KEY);
        return;
      }
      localStorage.setItem(
        VOTE_KEY,
        JSON.stringify({
          destination: vote.destination,
          employee_id: vote.employee_id,
          voted_at: vote.voted_at,
        })
      );
    } catch {
      /* private mode */
    }
  }

  /** The server still owns the vote. If it no longer has one for this id, drop the local mark. */
  async function confirmStoredVote() {
    const vote = sessionVote;
    if (!vote || !vote.employee_id) return;
    const data = await postJson("/api/vote/status", { employeeId: vote.employee_id });
    if (!data || data.ok !== true || sessionVote !== vote) return;
    sessionVote = null;
    storeVote(null);
    if (lastResults) {
      lastResults = { ...lastResults, myVote: null, localVote: null };
      notifyLive(lastResults);
    }
  }

  async function fetchResults() {
    const { db } = ensureApp();
    const tallySnap = await talliesRef(db).get();
    const counts = parseTalliesSnap(tallySnap);
    lastResults = buildResults(counts, sessionVote, null);
    return lastResults;
  }

  async function getResults() {
    try {
      if (!global.FIREBASE_ENABLED) return unavailable("firebase_not_configured");
      return await fetchResults();
    } catch (e) {
      const code = e?.code || e?.message || "unavailable";
      return keepKnownResults(String(code));
    }
  }

  function getCastVote() {
    return sessionVote || (lastResults && lastResults.myVote) || null;
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

  let unsubRoster = null;
  const rosterListeners = new Set();
  let lastRoster = null;

  function parseRosterSnap(snap) {
    const people = [];
    if (!snap) return people;
    snap.forEach((doc) => {
      const data = doc.data() || {};
      const destination = data.destination;
      if (!DEST_IDS.includes(destination)) return;
      people.push({
        employee_id: String(data.employee_id || doc.id || ""),
        name: String(data.name || ""),
        email: String(data.email || ""),
        destination,
        voted_at: data.voted_at ? String(data.voted_at) : "",
      });
    });
    return people;
  }

  function notifyRoster(roster) {
    rosterListeners.forEach((fn) => {
      try {
        fn(roster);
      } catch {
        /* listener error */
      }
    });
  }

  function listenRoster() {
    const { db } = ensureApp();
    return db.collection(PUBLIC_VOTES).onSnapshot(
      (snap) => {
        lastRoster = { ok: true, people: parseRosterSnap(snap), error: null };
        notifyRoster(lastRoster);
      },
      (err) => {
        if (typeof unsubRoster === "function") {
          const stop = unsubRoster;
          unsubRoster = null;
          try {
            stop();
          } catch {
            /* already stopped */
          }
        }
        lastRoster = {
          ok: false,
          people: [],
          error: String(err?.code || err?.message || "snapshot_error"),
        };
        notifyRoster(lastRoster);
      }
    );
  }

  function subscribeRoster(callback) {
    if (typeof callback === "function") rosterListeners.add(callback);

    if (!global.FIREBASE_ENABLED) {
      const roster = { ok: false, people: [], error: "firebase_not_configured" };
      lastRoster = roster;
      if (callback) callback(roster);
      return () => rosterListeners.delete(callback);
    }

    if (!unsubRoster) {
      try {
        unsubRoster = listenRoster();
      } catch (e) {
        lastRoster = {
          ok: false,
          people: [],
          error: String(e?.code || e?.message || "unavailable"),
        };
        notifyRoster(lastRoster);
      }
    } else if (lastRoster && callback) {
      callback(lastRoster);
    }

    return () => {
      rosterListeners.delete(callback);
    };
  }

  function reloadRoster() {
    if (typeof unsubRoster === "function") {
      const stop = unsubRoster;
      unsubRoster = null;
      try {
        stop();
      } catch {
        /* already stopped */
      }
    }
    lastRoster = null;
    if (!rosterListeners.size) return;
    if (!global.FIREBASE_ENABLED) {
      lastRoster = { ok: false, people: [], error: "firebase_not_configured" };
      notifyRoster(lastRoster);
      return;
    }
    try {
      unsubRoster = listenRoster();
    } catch (e) {
      lastRoster = {
        ok: false,
        people: [],
        error: String(e?.code || e?.message || "unavailable"),
      };
      notifyRoster(lastRoster);
    }
  }

  function subscribeResults(callback) {
    if (typeof callback === "function") liveListeners.add(callback);

    if (!global.FIREBASE_ENABLED) {
      const r = unavailable("firebase_not_configured");
      if (callback) callback(r);
      return () => liveListeners.delete(callback);
    }

    if (!unsubLive) {
      try {
        const { db } = ensureApp();
        unsubLive = talliesRef(db).onSnapshot(
          (snap) => {
            const counts = parseTalliesSnap(snap);
            lastResults = buildResults(counts, sessionVote, null);
            notifyLive(lastResults);
          },
          (err) => {
            notifyLive(keepKnownResults(err?.code || "snapshot_error"));
          }
        );
      } catch (e) {
        notifyLive(keepKnownResults(e?.code || e?.message || "unavailable"));
      }
    } else if (lastResults && callback) {
      callback(lastResults);
    }

    return () => {
      liveListeners.delete(callback);
    };
  }

  async function postJson(path, body) {
    let res;
    try {
      res = await fetch(apiBase() + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, error: "network" };
    }
    try {
      const data = await res.json();
      if (!data || typeof data !== "object") return { ok: false, error: "network" };
      return data;
    } catch {
      return { ok: false, error: "network" };
    }
  }

  async function requestOtp(input) {
    if (votingClosed()) return { ok: false, error: "voting_closed" };
    if (busy) return { ok: false, error: "busy" };
    if (!input || !DEST_IDS.includes(input.destinationId)) return { ok: false, error: "invalid" };
    busy = true;
    try {
      return await postJson("/api/vote/request", {
        employeeId: input.employeeId,
        name: input.name,
        email: input.email,
        destinationId: input.destinationId,
        resend: input.resend === true,
      });
    } finally {
      busy = false;
    }
  }

  async function otpStatus(input) {
    if (busy) return { ok: false, error: "busy" };
    busy = true;
    try {
      return await postJson("/api/vote/status", {
        employeeId: input && input.employeeId,
      });
    } finally {
      busy = false;
    }
  }

  async function verifyOtp(input) {
    if (votingClosed()) return { ok: false, error: "voting_closed" };
    if (busy) return { ok: false, error: "busy" };
    busy = true;
    try {
      const data = await postJson("/api/vote/verify", {
        employeeId: input && input.employeeId,
        otp: input && input.otp,
      });
      if (data && data.ok && data.vote) {
        rememberSession(data.vote);
        storeVote(sessionVote);
      }
      if (data && data.ok && data.counts) {
        lastResults = buildResults(data.counts, sessionVote, null);
        notifyLive(lastResults);
        return { ...data, results: lastResults };
      }
      let results = lastResults;
      try {
        results = await getResults();
      } catch {
        results = lastResults;
      }
      return { ...data, results: results || lastResults };
    } finally {
      busy = false;
    }
  }

  async function changeVote() {
    const results = lastResults || (await getResults().catch(() => unavailable("locked")));
    return { ok: false, error: "locked", results };
  }

  async function clearVote() {
    return changeVote();
  }

  async function undoVote() {
    return changeVote();
  }

  function purgeLegacyVoteStorage() {
    try {
      localStorage.removeItem("kaz-2026-cast-vote");
      localStorage.removeItem("kaz-2026-local-vote-log");
      localStorage.removeItem("kaz-2026-voter-id");
      localStorage.removeItem("kaz-2026-firebase-voter");
      localStorage.removeItem("kaz-2026-voter-display-name");
    } catch {
      /* private mode */
    }
  }

  purgeLegacyVoteStorage();
  rememberSession(readStoredVote());
  confirmStoredVote();

  global.VoteService = {
    DEST_IDS,
    getCastVote,
    hasUserVoted,
    canChangeVote,
    votingClosed,
    votingClosesAtMs,
    loadVotingClose,
    calculateTotals,
    getResults,
    subscribeResults,
    subscribeRoster,
    reloadRoster,
    requestOtp,
    otpStatus,
    verifyOtp,
    changeVote,
    clearVote,
    undoVote,
  };
})(typeof window !== "undefined" ? window : globalThis);
