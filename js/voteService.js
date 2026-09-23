/* KAZ Anniversary Tour 2026 — Vote service (static-compatible)
 *
 * Limitation: a browser cannot write to data/votes.json on disk/CDN.
 * This service:
 *  - Reads published totals from data/votes.json (shared baseline)
 *  - Casts at most one active vote per anonymous voterId (localStorage)
 *  - Supports changeVote (same voterId, replace destination) and undoVote/clearVote
 *  - Optionally stores a SHA-256 hashed public IP (never raw IP)
 *  - Does NOT block multiple voters on the same IP (office Wi-Fi)
 *  - Keeps a local vote log matching the votes.json schema for export/merge
 *
 * Display counts = published totals + this device's active vote (+0 after undo).
 */
(function (global) {
  const VOTES_URL = "data/votes.json";
  const DEST_IDS = ["sundarbans", "sylhet", "rangamati", "sajek", "nepal"];
  const KEY_VOTER = "kaz-2026-voter-id";
  const KEY_CAST = "kaz-2026-cast-vote";
  const KEY_LOG = "kaz-2026-local-vote-log";
  const IP_SALT = "kaz-anniversary-tour-2026-v1";

  let publishedCache = null;
  let busy = false;

  function safeParse(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function getVoterId() {
    try {
      let id = localStorage.getItem(KEY_VOTER);
      if (!id) {
        id =
          global.crypto && crypto.randomUUID
            ? crypto.randomUUID()
            : "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(KEY_VOTER, id);
      }
      return id;
    } catch {
      return "ephemeral-" + Date.now();
    }
  }

  function getCastVote() {
    try {
      const v = safeParse(localStorage.getItem(KEY_CAST), null);
      if (!v || !v.destinationId || !DEST_IDS.includes(v.destinationId)) return null;
      if (v.active === false) return null;
      return v;
    } catch {
      return null;
    }
  }

  function hasUserVoted() {
    return !!getCastVote();
  }

  function getLocalLog() {
    try {
      const log = safeParse(localStorage.getItem(KEY_LOG), []);
      return Array.isArray(log) ? log : [];
    } catch {
      return [];
    }
  }

  function saveLocalLog(log) {
    try {
      localStorage.setItem(KEY_LOG, JSON.stringify(log.slice(-50)));
    } catch {
      /* quota / private mode */
    }
  }

  function persistCast(record) {
    try {
      localStorage.setItem(KEY_CAST, JSON.stringify(record));
      return true;
    } catch {
      return false;
    }
  }

  function clearCastStorage() {
    try {
      localStorage.removeItem(KEY_CAST);
    } catch {
      /* private mode */
    }
  }

  async function sha256Hex(text) {
    if (!global.crypto || !crypto.subtle) return null;
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** Best-effort public IP → hash only. Soft-fail; never blocks voting. */
  async function getIpHash() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2500);
      const res = await fetch("https://api.ipify.org?format=json", {
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(t);
      if (!res.ok) return null;
      const data = await res.json();
      const ip = typeof data.ip === "string" ? data.ip.trim() : "";
      if (!ip) return null;
      return await sha256Hex(IP_SALT + "|" + ip);
    } catch {
      return null;
    }
  }

  function emptyTotals() {
    return DEST_IDS.reduce((acc, id) => {
      acc[id] = 0;
      return acc;
    }, {});
  }

  async function loadPublished(force) {
    if (publishedCache && !force) return publishedCache;
    try {
      const res = await fetch(VOTES_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("votes_unavailable");
      const data = await res.json();
      const totals = emptyTotals();
      DEST_IDS.forEach((id) => {
        const n = Number(data.totals && data.totals[id]);
        totals[id] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
      });
      publishedCache = {
        ok: true,
        updatedAt: data.updatedAt || null,
        persistence: data.persistence || "static-read-only",
        note: data.note || "",
        totals,
        votes: Array.isArray(data.votes) ? data.votes : [],
      };
      return publishedCache;
    } catch {
      publishedCache = {
        ok: false,
        updatedAt: null,
        persistence: "static-read-only",
        note: "",
        totals: emptyTotals(),
        votes: [],
        error: "unavailable",
      };
      return publishedCache;
    }
  }

  /**
   * Display counts = published totals + this device's active cast vote (if any).
   * After undo, local active vote is gone → +0. Never claims JSON was written.
   */
  async function getResults() {
    const published = await loadPublished(false);
    const local = getCastVote();
    const counts = { ...published.totals };
    if (local && DEST_IDS.includes(local.destinationId)) {
      counts[local.destinationId] = (counts[local.destinationId] || 0) + 1;
    }
    const totalVotes = DEST_IDS.reduce((s, id) => s + (counts[id] || 0), 0);
    return {
      counts,
      totalVotes,
      publishedOk: published.ok,
      publishedTotals: published.totals,
      localVote: local,
      canWriteRemote: false,
      persistence: "localStorage + published data/votes.json (read-only)",
    };
  }

  async function castVote(destinationId) {
    if (busy) return { ok: false, error: "busy" };
    if (!DEST_IDS.includes(destinationId)) {
      return { ok: false, error: "invalid" };
    }

    const existing = getCastVote();
    if (existing && DEST_IDS.includes(existing.destinationId)) {
      return { ok: false, error: "already", vote: existing };
    }

    busy = true;
    try {
      const voterId = getVoterId();
      const ipHash = await getIpHash();
      const record = {
        destinationId,
        voterId,
        ipHash,
        timestamp: new Date().toISOString(),
        active: true,
        action: "cast",
      };

      if (!persistCast(record)) {
        return { ok: false, error: "storage" };
      }

      const log = getLocalLog();
      log.push(record);
      saveLocalLog(log);

      const results = await getResults();
      return {
        ok: true,
        vote: record,
        results,
        wroteToProjectJson: false,
        message: "local_only",
      };
    } finally {
      busy = false;
    }
  }

  /**
   * Replace the active vote with a new destination (same voterId).
   * Never keeps two active destinations for one voter.
   */
  async function changeVote(destinationId) {
    if (busy) return { ok: false, error: "busy" };
    if (!DEST_IDS.includes(destinationId)) {
      return { ok: false, error: "invalid" };
    }

    const existing = getCastVote();
    if (!existing) {
      return castVote(destinationId);
    }
    if (existing.destinationId === destinationId) {
      const results = await getResults();
      return { ok: true, vote: existing, results, unchanged: true, wroteToProjectJson: false };
    }

    busy = true;
    try {
      const voterId = existing.voterId || getVoterId();
      const ipHash = (await getIpHash()) || existing.ipHash || null;
      const record = {
        destinationId,
        voterId,
        ipHash,
        timestamp: new Date().toISOString(),
        active: true,
        action: "change",
        previousDestinationId: existing.destinationId,
      };

      if (!persistCast(record)) {
        return { ok: false, error: "storage" };
      }

      const log = getLocalLog();
      log.push(record);
      saveLocalLog(log);

      const results = await getResults();
      return {
        ok: true,
        vote: record,
        results,
        wroteToProjectJson: false,
        message: "local_only",
      };
    } finally {
      busy = false;
    }
  }

  /** Remove / deactivate the active vote. User may vote again. */
  async function clearVote() {
    if (busy) return { ok: false, error: "busy" };

    const existing = getCastVote();
    if (!existing) {
      return { ok: true, cleared: false, results: await getResults() };
    }

    busy = true;
    try {
      clearCastStorage();

      const log = getLocalLog();
      log.push({
        destinationId: existing.destinationId,
        voterId: existing.voterId || getVoterId(),
        ipHash: existing.ipHash || null,
        timestamp: new Date().toISOString(),
        active: false,
        action: "undo",
      });
      saveLocalLog(log);

      const results = await getResults();
      return {
        ok: true,
        cleared: true,
        results,
        wroteToProjectJson: false,
        message: "local_only",
      };
    } finally {
      busy = false;
    }
  }

  async function undoVote() {
    return clearVote();
  }

  function exportLocalVotes() {
    const cast = getCastVote();
    const log = getLocalLog();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      note: "Merge active votes into data/votes.json totals, then redeploy. Never store raw IP. Undo/change history is in votes[].",
      cast,
      votes: log,
    };
  }

  function downloadExport() {
    const payload = exportLocalVotes();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kaz-2026-vote-export.json";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  global.VoteService = {
    DEST_IDS,
    getVoterId,
    getCastVote,
    hasUserVoted,
    loadPublished,
    getResults,
    castVote,
    changeVote,
    clearVote,
    undoVote,
    exportLocalVotes,
    downloadExport,
  };
})(typeof window !== "undefined" ? window : globalThis);
