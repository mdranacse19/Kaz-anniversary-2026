import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  assessRoster,
  buildOtpRecord,
  canonicalEmployeeId,
  commitVerifiedVote,
  createMemoryDb,
  hashOtp,
  namesMatch,
  playfulWarning,
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
