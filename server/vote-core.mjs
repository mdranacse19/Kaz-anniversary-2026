/**
 * Employee vote rules shared by the API and tests.
 * Uniqueness is votes/{employeeId} plus voteEmails/{emailHash}, both created once inside a transaction.
 */
import { createHash, randomInt } from "node:crypto";

export const DEST_IDS = ["sundarbans", "sylhet", "sajekkaptai", "nepal", "bandarban", "coxstmartin"];
export const DEST_NAMES = {
  sundarbans: "সুন্দরবন",
  sylhet: "সিলেট + শ্রীমঙ্গল",
  sajekkaptai: "সাজেক + কাপ্তাই",
  nepal: "নেপাল · কাঠমান্ডু + পোখরা",
  bandarban: "বান্দরবান",
  coxstmartin: "কক্সবাজার এবং সেন্টমার্টিন",
};
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_WAIT_MS = 60 * 1000;
export const OTP_MAX_SENDS = 5;

export function canonicalEmployeeId(raw) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function nameTokens(raw) {
  return String(raw || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && token !== "md");
}

export function namesMatch(typed, rosterName) {
  const typedTokens = nameTokens(typed);
  if (!typedTokens.length) return false;
  const rosterTokens = new Set(nameTokens(rosterName));
  return typedTokens.some((token) => rosterTokens.has(token));
}

export function firstMeaningfulToken(raw) {
  return nameTokens(raw)[0] || "";
}

export function playfulWarning(token) {
  const name = token || "বন্ধু";
  return `মাসুদ তুমি কি ভালো হবা না?`;
}

export function validEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

/** Firestore id for one stored address. Case does not make a second address. */
export function emailClaimPath(email) {
  const mail = validEmail(email);
  return mail ? `voteEmails/${sha256(mail)}` : "";
}

export function sha256(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export function hashOtp(code) {
  return sha256(String(code));
}

export function generateOtp() {
  return String(randomInt(0, 1000000)).padStart(6, "0");
}

export function nameKey(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function nowIso(date = new Date()) {
  const shifted = new Date(date.getTime() + 6 * 60 * 60 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}` +
    `T${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}:${p(shifted.getUTCSeconds())}+06:00`
  );
}

export function emptyCounts() {
  return DEST_IDS.reduce((acc, id) => {
    acc[id] = 0;
    return acc;
  }, {});
}

function rosterRows(roster) {
  const list = Array.isArray(roster) ? roster : roster && roster.employees;
  return Array.isArray(list) ? list : [];
}

export function findEmployee(roster, employeeId) {
  const id = canonicalEmployeeId(employeeId);
  if (!id) return null;
  return (
    rosterRows(roster).find((row) => row && row.id && canonicalEmployeeId(row.id) === id) || null
  );
}

export function nameMatchesAnyEmployee(roster, name) {
  return rosterRows(roster).some((row) => row && row.name && namesMatch(name, row.name));
}

/** Roster + shape check. Does not look at existing votes. */
export function assessRoster({ employeeId, name, email, destinationId, roster }) {
  const id = canonicalEmployeeId(employeeId);
  const mail = validEmail(email);
  if (!id) return { ok: false, error: "invalid_id", warning: playfulWarning(firstMeaningfulToken(name)) };
  if (!DEST_IDS.includes(destinationId)) return { ok: false, error: "invalid" };
  if (!mail) return { ok: false, error: "invalid_email" };
  const employee = findEmployee(roster, id);
  if (!employee) {
    const errors = nameMatchesAnyEmployee(roster, name)
      ? ["id_not_found"]
      : ["id_not_found", "name_not_found"];
    return { ok: false, error: errors[0], errors };
  }
  if (!namesMatch(name, employee.name)) {
    return { ok: false, error: "name_not_found", errors: ["name_not_found"] };
  }
  return {
    ok: true,
    employeeId: id,
    email: mail,
    destinationId,
    employee,
    displayToken: firstMeaningfulToken(employee.name),
  };
}

export function buildOtpRecord({ employee, email, destinationId, otp, nowMs, displayToken, sends }) {
  const rosterName = String(employee.name || "").replace(/\s+/g, " ").trim();
  const key = nameKey(rosterName);
  return {
    otpHash: hashOtp(otp),
    destinationId,
    email,
    name: rosterName,
    nameKey: key,
    nameHash: sha256(key),
    displayToken: displayToken || firstMeaningfulToken(rosterName),
    expiresAt: nowMs + OTP_TTL_MS,
    attempts: 0,
    used: false,
    sentAt: nowMs,
    sends: (Number(sends) || 0) + 1,
  };
}

/** active | expired | exhausted | none. Does not send mail or change the record. */
export function otpAvailability(record, nowMs) {
  if (!record || record.used || !record.otpHash) return "none";
  if (Number(record.attempts) >= OTP_MAX_ATTEMPTS) return "exhausted";
  if (Number(record.expiresAt) <= Number(nowMs)) return "expired";
  return "active";
}

/** A code the employee can still type. Expired, used, or attempt-exhausted codes are not reused. */
export function reusableOtp(record, nowMs) {
  return otpAvailability(record, nowMs) === "active";
}

/**
 * May a fresh code replace this one? A live code must wait out the cooldown and stay under the send cap.
 * Records written before resend existed carry no sentAt; their expiry dates them.
 */
export function resendGate(record, nowMs) {
  if (!reusableOtp(record, nowMs)) return { ok: true, sends: 0 };
  const sends = Number(record.sends) || 1;
  if (sends >= OTP_MAX_SENDS) {
    const retryAfter = Math.ceil((Number(record.expiresAt) - Number(nowMs)) / 1000);
    return { ok: false, error: "resend_limit", retryAfter };
  }
  const sentAt = Number(record.sentAt) || Number(record.expiresAt) - OTP_TTL_MS;
  const waitMs = sentAt + OTP_RESEND_WAIT_MS - Number(nowMs);
  if (waitMs > 0) return { ok: false, error: "resend_wait", retryAfter: Math.ceil(waitMs / 1000) };
  return { ok: true, sends };
}

function judgeOtp(challenge, otp, nowMs) {
  if (!challenge) return { ok: false, error: "otp_missing" };
  if (challenge.used) return { ok: false, error: "otp_used" };
  if (Number(challenge.expiresAt) <= nowMs) return { ok: false, error: "otp_expired" };
  if (Number(challenge.attempts) >= OTP_MAX_ATTEMPTS) return { ok: false, error: "otp_attempts" };
  if (challenge.otpHash !== hashOtp(String(otp || "").trim())) {
    const attempts = Number(challenge.attempts) + 1;
    const burned = attempts >= OTP_MAX_ATTEMPTS;
    return {
      ok: false,
      error: burned ? "otp_attempts" : "otp_invalid",
      next: { ...challenge, attempts, used: burned },
    };
  }
  return { ok: true };
}

/**
 * One transaction: read vote, OTP, and tallies; write at most one vote and one tally bump.
 * runTransaction(fn) must retry or serialize so two callers cannot both create votes/{id}.
 */
export async function commitVerifiedVote(runTransaction, input) {
  const employeeId = canonicalEmployeeId(input.employeeId);
  const otp = String(input.otp || "").trim();
  const nowMs = Number(input.nowMs);
  const ip = String(input.ip || "");

  return runTransaction(async (tx) => {
    const voteSnap = await tx.get(`votes/${employeeId}`);
    const otpSnap = await tx.get(`voteOtps/${employeeId}`);
    const tallySnap = await tx.get("publicTallies/live");
    const challenge = otpSnap.exists ? otpSnap.data : null;
    const mail = validEmail(challenge && challenge.email);
    const mailPath = emailClaimPath(mail);
    const mailSnap = mailPath ? await tx.get(mailPath) : { exists: false };
    const legacySnap = mail ? await tx.queryOne("votes", "email", mail) : { exists: false };

    if (voteSnap.exists) {
      return {
        ok: false,
        error: "already_voted",
        warning: playfulWarning(challenge && challenge.displayToken),
      };
    }

    const gate = judgeOtp(challenge, otp, nowMs);
    if (!gate.ok) {
      if (gate.next) await tx.set(`voteOtps/${employeeId}`, gate.next);
      return { ok: false, error: gate.error };
    }

    if (mailSnap.exists || legacySnap.exists) return { ok: false, error: "email_taken" };

    const stamp = nowIso(new Date(nowMs));
    const record = {
      destination: challenge.destinationId,
      name: challenge.name,
      nameKey: challenge.nameKey,
      nameHash: challenge.nameHash,
      voted_at: stamp,
      updated_at: stamp,
      employee_id: employeeId,
      email: validEmail(challenge.email),
      ip,
    };
    await tx.create(`votes/${employeeId}`, record);
    await tx.create(mailPath, { email: record.email, employeeId });
    await tx.set(`voteOtps/${employeeId}`, { ...challenge, used: true });

    const counts = emptyCounts();
    const prev = tallySnap.exists && tallySnap.data ? tallySnap.data.counts || {} : {};
    DEST_IDS.forEach((id) => {
      counts[id] = Math.max(0, Number(prev[id]) || 0);
    });
    if (DEST_IDS.includes(challenge.destinationId)) counts[challenge.destinationId] += 1;
    const totalVotes = DEST_IDS.reduce((sum, id) => sum + counts[id], 0);
    await tx.set("publicTallies/live", { counts, totalVotes, updatedAt: stamp });
    return { ok: true, vote: record, counts, totalVotes };
  });
}

/** In-memory stand-in with the same one-at-a-time transaction lock. */
export function createMemoryDb() {
  const docs = new Map();
  let queue = Promise.resolve();
  const db = {
    docs,
    runTransaction(fn) {
      const job = queue.then(() => fn(memoryTx(docs)));
      queue = job.then(
        () => {},
        () => {}
      );
      return job;
    },
  };
  return db;
}

function memoryTx(docs) {
  return {
    async get(path) {
      if (!docs.has(path)) return { exists: false, data: null };
      return { exists: true, data: { ...docs.get(path) } };
    },
    async create(path, data) {
      if (docs.has(path)) {
        const err = new Error("already-exists");
        err.code = "already-exists";
        throw err;
      }
      docs.set(path, { ...data });
    },
    async set(path, data) {
      docs.set(path, { ...data });
    },
    async queryOne(collection, field, value) {
      const prefix = `${collection}/`;
      for (const [path, data] of docs) {
        if (path.startsWith(prefix) && data && data[field] === value) {
          return { exists: true, data: { ...data } };
        }
      }
      return { exists: false, data: null };
    },
  };
}
