#!/usr/bin/env node
/**
 * Rebuild publicTallies/live from votes, using the Admin SDK in .env.
 * Addresses with a +tag in the local part stay stored but are not counted.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyCounts, nowIso, voteCountsTowardTally } from "../server/vote-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

loadEnv(join(ROOT, ".env"));

function loadEnv(path) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    value = value.replace(/\\n/g, "\n");
    if (process.env[key] == null || process.env[key] === "") process.env[key] = value;
  }
}

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "");
if (!projectId || !clientEmail || !privateKey) {
  console.error("Firebase admin credentials are missing from .env");
  process.exit(1);
}

const { default: admin } = await import("firebase-admin");
admin.initializeApp({
  credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
});
const db = admin.firestore();

const snap = await db.collection("votes").get();
const counts = emptyCounts();
let counted = 0;
let skipped = 0;
snap.forEach((doc) => {
  const data = doc.data() || {};
  if (voteCountsTowardTally(data.email, data.destination)) {
    counts[data.destination] += 1;
    counted += 1;
  } else {
    skipped += 1;
  }
});
const totalVotes = Object.values(counts).reduce((sum, n) => sum + n, 0);
const stamp = nowIso();
await db.doc("publicTallies/live").set({
  counts,
  totalVotes,
  updatedAt: stamp,
  rebuiltAt: stamp,
});
console.log(JSON.stringify({ projectId, counted, skipped, totalVotes, counts }, null, 2));
