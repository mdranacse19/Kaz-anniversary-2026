/* Static poll — localStorage + published JSON.
   Browser never writes poll-results.json. Change/undo only affect this browser. */
(function (global) {
  const VOTE_KEY = "kaz-anniversary-2026-vote";
  const RESULTS_URL = "data/poll-results.json";
  const DEST_IDS = ["sundarbans", "sylhet", "rangamati", "sajek_rangamati", "nepal"];

  function getUserVote() {
    try {
      const raw = localStorage.getItem(VOTE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !DEST_IDS.includes(parsed.destinationId)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function hasUserVoted() {
    return Boolean(getUserVote());
  }

  function setVote(destinationId) {
    if (!DEST_IDS.includes(destinationId)) {
      return { ok: false, error: "invalid" };
    }
    const previous = getUserVote();
    const vote = {
      destinationId,
      votedAt: new Date().toISOString(),
    };
    try {
      localStorage.setItem(VOTE_KEY, JSON.stringify(vote));
      return {
        ok: true,
        vote,
        changed: Boolean(previous && previous.destinationId !== destinationId),
        same: Boolean(previous && previous.destinationId === destinationId),
      };
    } catch {
      return { ok: false, error: "storage" };
    }
  }

  /** @deprecated use setVote — kept for older callers */
  function submitVote(destinationId) {
    return setVote(destinationId);
  }

  function clearVote() {
    try {
      localStorage.removeItem(VOTE_KEY);
      return { ok: true };
    } catch {
      return { ok: false, error: "storage" };
    }
  }

  async function getPollResults() {
    const response = await fetch(RESULTS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("unavailable");
    const data = await response.json();
    const counts = {};
    let total = 0;
    DEST_IDS.forEach((id) => {
      const n = Math.max(0, Number(data[id]) || 0);
      counts[id] = n;
      total += n;
    });
    const results = DEST_IDS.map((id) => {
      const votes = counts[id];
      const pct = total === 0 ? 0 : Math.round((votes / total) * 100);
      return { id, votes, pct };
    });
    if (total > 0) {
      const sumPct = results.reduce((s, r) => s + r.pct, 0);
      if (sumPct !== 100) {
        const largest = results.reduce((a, b) => (a.votes >= b.votes ? a : b));
        largest.pct += 100 - sumPct;
      }
    }
    return {
      counts,
      total,
      results,
      updatedAt: data.updatedAt || null,
    };
  }

  global.PollService = {
    VOTE_KEY,
    DEST_IDS,
    getPollResults,
    setVote,
    submitVote,
    clearVote,
    hasUserVoted,
    getUserVote,
  };
})(window);
