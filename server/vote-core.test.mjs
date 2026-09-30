import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS,
  OTP_RESEND_WAIT_MS,
  OTP_TTL_MS,
  assessRoster,
  buildOtpRecord,
  canonicalEmployeeId,
  commitVerifiedVote,
  createMemoryDb,
  emailClaimPath,
  hashOtp,
  mailboxKey,
  namesMatch,
  playfulWarning,
  resendGate,
  reusableOtp,
} from "./vote-core.mjs";

const roster = JSON.parse(readFileSync(new URL("../data/employees.json", import.meta.url), "utf8"));
const masud = roster.employees.find((row) => row.id === "KS010");

test("employee id ignores case and spaces", () => {
  assert.equal(canonicalEmployeeId(" ks 010 "), "KS010");
  assert.equal(canonicalEmployeeId("ks010"), "KS010");
});

test("name match ignores Md. and needs one shared word", () => {
  assert.equal(namesMatch("masud", masud.name), true);
  assert.equal(namesMatch("Md.", masud.name), false);
  assert.equal(namesMatch("MD", "Md. Shariful Hoque Khan"), false);
  assert.equal(namesMatch("shariful", "Md. Shariful Hoque Khan"), true);
  assert.equal(namesMatch("rahim", masud.name), false);
});

test("unknown id or mismatched name does not look like a send", () => {
  const bad = assessRoster({
    employeeId: "KS010",
    name: "rahim",
    email: "a@b.com",
    destinationId: "coxstmartin",
    roster,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "name_not_found");

  const unknown = assessRoster({
    employeeId: "KS99999",
    name: "masud",
    email: "a@b.com",
    destinationId: "coxstmartin",
    roster,
  });
  assert.equal(unknown.ok, false);
  assert.deepEqual(unknown.errors, ["id_not_found"]);

  const both = assessRoster({
    employeeId: "KS99999",
    name: "rahim",
    email: "a@b.com",
    destinationId: "coxstmartin",
    roster,
  });
  assert.equal(both.ok, false);
  assert.deepEqual(both.errors, ["id_not_found", "name_not_found"]);
});

test("a live unused OTP is reused and an expired one is not", () => {
  const nowMs = 1_700_000_000_000;
  const live = {
    otpHash: "abc",
    expiresAt: nowMs + OTP_TTL_MS,
    attempts: 0,
    used: false,
  };
  assert.equal(reusableOtp(live, nowMs), true);
  assert.equal(reusableOtp({ ...live, expiresAt: nowMs - 1 }, nowMs), false);
  assert.equal(reusableOtp({ ...live, used: true }, nowMs), false);
  assert.equal(reusableOtp({ ...live, attempts: OTP_MAX_ATTEMPTS }, nowMs), false);
  assert.equal(reusableOtp(null, nowMs), false);
});

test("resend waits out the cooldown and stops at the send cap", () => {
  const nowMs = 1_700_000_000_000;
  const record = buildOtpRecord({
    employee: masud,
    email: "a@b.com",
    destinationId: "coxstmartin",
    otp: "123456",
    nowMs,
  });
  assert.equal(record.sends, 1);
  assert.equal(record.sentAt, nowMs);

  assert.deepEqual(resendGate(record, nowMs + 1000), { ok: false, error: "resend_wait", retryAfter: 59 });
  assert.deepEqual(resendGate(record, nowMs + OTP_RESEND_WAIT_MS), { ok: true, sends: 1 });

  const second = buildOtpRecord({
    employee: masud,
    email: "a@b.com",
    destinationId: "coxstmartin",
    otp: "654321",
    nowMs,
    sends: 1,
  });
  assert.equal(second.sends, 2);

  const capped = { ...record, sends: OTP_MAX_SENDS };
  const limit = resendGate(capped, nowMs + OTP_RESEND_WAIT_MS);
  assert.equal(limit.ok, false);
  assert.equal(limit.error, "resend_limit");
  assert.equal(limit.retryAfter, (OTP_TTL_MS - OTP_RESEND_WAIT_MS) / 1000);

  // Expired, used, or missing codes start a fresh count.
  assert.deepEqual(resendGate(capped, nowMs + OTP_TTL_MS), { ok: true, sends: 0 });
  assert.deepEqual(resendGate({ ...record, used: true }, nowMs), { ok: true, sends: 0 });
  assert.deepEqual(resendGate(null, nowMs), { ok: true, sends: 0 });

  // Records from before resend existed have no sentAt.
  const { sentAt, sends, ...legacy } = record;
  assert.equal(resendGate(legacy, nowMs + 1000).error, "resend_wait");
  assert.deepEqual(resendGate(legacy, nowMs + OTP_RESEND_WAIT_MS), { ok: true, sends: 1 });
});

test("already-voted warning uses the roster token", () => {
  const checked = assessRoster({
    employeeId: "ks010",
    name: "masud",
    email: "masud@example.com",
    destinationId: "sundarbans",
    roster,
  });
  assert.equal(checked.ok, true);
  assert.equal(playfulWarning(checked.displayToken), `মাসুদ তুমি কি ভালো হবা না?`);
});

function seedOtp(db, otp, extra = {}) {
  const checked = assessRoster({
    employeeId: "KS010",
    name: "masud",
    email: "masud@example.com",
    destinationId: "coxstmartin",
    roster,
  });
  const nowMs = extra.nowMs || 1_700_000_000_000;
  const record = buildOtpRecord({
    employee: checked.employee,
    email: checked.email,
    destinationId: checked.destinationId,
    otp,
    nowMs,
    displayToken: checked.displayToken,
  });
  db.docs.set(`voteOtps/${checked.employeeId}`, { ...record, ...extra.patch });
  return { employeeId: checked.employeeId, nowMs, otp };
}

test("wrong, expired, reused, and exhausted OTPs do not vote", async () => {
  const nowMs = 1_700_000_000_000;
  const db = createMemoryDb();
  const seeded = seedOtp(db, "123456", { nowMs });

  const wrong = await commitVerifiedVote(db.runTransaction.bind(db), {
    employeeId: seeded.employeeId,
    otp: "000000",
    ip: "203.0.113.8",
    nowMs,
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.error, "otp_invalid");
  assert.equal(db.docs.get(`voteOtps/${seeded.employeeId}`).attempts, 1);
  assert.equal(db.docs.has(`votes/${seeded.employeeId}`), false);

  const expired = await commitVerifiedVote(db.runTransaction.bind(db), {
    employeeId: seeded.employeeId,
    otp: "123456",
    ip: "203.0.113.8",
    nowMs: nowMs + OTP_TTL_MS + 1,
  });
  assert.equal(expired.error, "otp_expired");

  db.docs.get(`voteOtps/${seeded.employeeId}`).attempts = OTP_MAX_ATTEMPTS - 1;
  db.docs.get(`voteOtps/${seeded.employeeId}`).expiresAt = nowMs + OTP_TTL_MS;
  const burned = await commitVerifiedVote(db.runTransaction.bind(db), {
    employeeId: seeded.employeeId,
    otp: "000000",
    ip: "203.0.113.8",
    nowMs,
  });
  assert.equal(burned.error, "otp_attempts");
  assert.equal(db.docs.get(`voteOtps/${seeded.employeeId}`).used, true);

  const reused = await commitVerifiedVote(db.runTransaction.bind(db), {
    employeeId: seeded.employeeId,
    otp: "123456",
    ip: "203.0.113.8",
    nowMs,
  });
  assert.equal(reused.error, "otp_used");
  assert.equal(db.docs.has("publicTallies/live"), false);
});

test("two simultaneous verifies create one vote and one tally", async () => {
  const db = createMemoryDb();
  const seeded = seedOtp(db, "654321");
  const [a, b] = await Promise.all([
    commitVerifiedVote(db.runTransaction.bind(db), {
      employeeId: "ks 010",
      otp: seeded.otp,
      ip: "203.0.113.1",
      nowMs: seeded.nowMs + 10,
    }),
    commitVerifiedVote(db.runTransaction.bind(db), {
      employeeId: "KS010",
      otp: seeded.otp,
      ip: "203.0.113.2",
      nowMs: seeded.nowMs + 10,
    }),
  ]);
  const oks = [a, b].filter((row) => row.ok);
  assert.equal(oks.length, 1);
  assert.equal(db.docs.has("votes/KS010"), true);
  assert.equal(db.docs.get("votes/KS010").email, "masud@example.com");
  assert.equal(db.docs.get("votes/KS010").employee_id, "KS010");
  assert.equal(db.docs.get("publicTallies/live").counts.coxstmartin, 1);
  assert.equal(db.docs.get("publicTallies/live").totalVotes, 1);
  assert.equal(db.docs.get("voteOtps/KS010").used, true);
  assert.equal(hashOtp("654321"), db.docs.get("voteOtps/KS010").otpHash);
});

test("a stored email cannot be saved on another vote", async () => {
  const db = createMemoryDb();
  const seeded = seedOtp(db, "654321");
  const first = await commitVerifiedVote(db.runTransaction.bind(db), {
    employeeId: seeded.employeeId,
    otp: seeded.otp,
    ip: "203.0.113.1",
    nowMs: seeded.nowMs + 10,
  });
  assert.equal(first.ok, true);

  const other = assessRoster({
    employeeId: "KS004",
    name: "shariful",
    email: "Masud@Example.com",
    destinationId: "sundarbans",
    roster,
  });
  assert.equal(other.email, "masud@example.com");
  const record = buildOtpRecord({
    employee: other.employee,
    email: other.email,
    destinationId: other.destinationId,
    otp: "111111",
    nowMs: seeded.nowMs,
    displayToken: other.displayToken,
  });
  db.docs.set(`voteOtps/${other.employeeId}`, record);
  const second = await commitVerifiedVote(db.runTransaction.bind(db), {
    employeeId: other.employeeId,
    otp: "111111",
    ip: "203.0.113.2",
    nowMs: seeded.nowMs + 20,
  });
  assert.equal(second.ok, false);
  assert.equal(second.error, "email_taken");
  assert.equal(db.docs.has("votes/KS004"), false);
  assert.equal(db.docs.get("publicTallies/live").totalVotes, 1);

  const fresh = assessRoster({
    employeeId: "KS011",
    name: "anwarul",
    email: "anwarul@example.com",
    destinationId: "sylhet",
    roster,
  });
  db.docs.set(
    `voteOtps/${fresh.employeeId}`,
    buildOtpRecord({
      employee: fresh.employee,
      email: fresh.email,
      destinationId: fresh.destinationId,
      otp: "222222",
      nowMs: seeded.nowMs,
      displayToken: fresh.displayToken,
    })
  );
  const third = await commitVerifiedVote(db.runTransaction.bind(db), {
    employeeId: fresh.employeeId,
    otp: "222222",
    ip: "203.0.113.3",
    nowMs: seeded.nowMs + 30,
  });
  assert.equal(third.ok, true);
  assert.equal(db.docs.get("votes/KS011").email, "anwarul@example.com");
  assert.equal(db.docs.get("publicTallies/live").totalVotes, 2);
});

test("a plus-tag address is refused and does not count as another mailbox", async () => {
  const tagged = assessRoster({
    employeeId: "KS085",
    name: "nasim",
    email: "nasimsaker+1@gmail.com",
    destinationId: "sundarbans",
    roster,
  });
  assert.equal(tagged.ok, false);
  assert.equal(tagged.error, "email_alias");
  assert.equal(mailboxKey("NasimSaker+2@Gmail.com"), "nasimsaker@gmail.com");
  assert.equal(mailboxKey("monir.smh+tour@kazsystems.com"), "monir.smh@kazsystems.com");
  assert.equal(emailClaimPath("nasimsaker+1@gmail.com"), emailClaimPath("nasimsaker@gmail.com"));

  const db = createMemoryDb();
  const seeded = seedOtp(db, "654321");
  const first = await commitVerifiedVote(db.runTransaction.bind(db), {
    employeeId: seeded.employeeId,
    otp: seeded.otp,
    ip: "203.0.113.1",
    nowMs: seeded.nowMs + 10,
  });
  assert.equal(first.ok, true);
  assert.equal(db.docs.get("publicTallies/live").totalVotes, 1);

  const aliasEmployee = assessRoster({
    employeeId: "KS004",
    name: "shariful",
    email: "shariful@example.com",
    destinationId: "sundarbans",
    roster,
  });
  db.docs.set(
    `voteOtps/${aliasEmployee.employeeId}`,
    buildOtpRecord({
      employee: aliasEmployee.employee,
      email: "masud+bypass@example.com",
      destinationId: aliasEmployee.destinationId,
      otp: "111111",
      nowMs: seeded.nowMs,
      displayToken: aliasEmployee.displayToken,
    })
  );
  const aliasVote = await commitVerifiedVote(db.runTransaction.bind(db), {
    employeeId: aliasEmployee.employeeId,
    otp: "111111",
    ip: "203.0.113.2",
    nowMs: seeded.nowMs + 20,
  });
  assert.equal(aliasVote.ok, false);
  assert.equal(aliasVote.error, "email_taken");
  assert.equal(db.docs.has("votes/KS004"), false);
  assert.equal(db.docs.get("publicTallies/live").totalVotes, 1);

  const fresh = assessRoster({
    employeeId: "KS011",
    name: "anwarul",
    email: "anwarul@example.com",
    destinationId: "sylhet",
    roster,
  });
  db.docs.set(
    `voteOtps/${fresh.employeeId}`,
    buildOtpRecord({
      employee: fresh.employee,
      email: "anwarul+1@example.com",
      destinationId: fresh.destinationId,
      otp: "222222",
      nowMs: seeded.nowMs,
      displayToken: fresh.displayToken,
    })
  );
  const uncounted = await commitVerifiedVote(db.runTransaction.bind(db), {
    employeeId: fresh.employeeId,
    otp: "222222",
    ip: "203.0.113.3",
    nowMs: seeded.nowMs + 30,
  });
  assert.equal(uncounted.ok, false);
  assert.equal(uncounted.error, "email_alias");
  assert.equal(db.docs.has("votes/KS011"), false);
  assert.equal(db.docs.get("publicTallies/live").totalVotes, 1);
});
