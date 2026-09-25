#!/usr/bin/env node
/**
 * Rebuild publicTallies/live from all votes destinations (Firestore REST).
 *
 * Deploy order:
 * 1. While votes still allow public/signed-in list OR after TEMP signed-in read rules:
 *      node scripts/rebuild-public-tallies-rest.mjs
 * 2. Publish owner-only votes rules from firestore.rules
 *
 * TEMP list rule (only if rebuild fails with 403):
 *   match /votes/{voterId} {
 *     allow read: if request.auth != null;
 *     allow create, update, delete: if request.auth != null && request.auth.uid == voterId;
 *   }
 */
const API_KEY = "AIzaSyCRufJhoag5eJjLksTCCaIQ6pVVtxQtz9w";
const PROJECT = "kaz-software-8007a";
const DEST_IDS = ["sundarbans", "sylhet", "sajekkaptai", "nepal", "bandarban", "coxstmartin"];

function emptyCounts() {
  return DEST_IDS.reduce((acc, id) => {
    acc[id] = 0;
    return acc;
  }, {});
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

function fieldString(v) {
  return { stringValue: String(v) };
}
function fieldInt(v) {
  return { integerValue: String(v) };
}

async function main() {
  const signUp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnSecureToken: true }),
    }
  );
  const auth = await signUp.json();
  if (!auth.idToken) {
    console.error("Anonymous sign-in failed:", auth);
    process.exit(1);
  }
  console.log("Signed in as", auth.localId);

  const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
  const headers = {
    Authorization: `Bearer ${auth.idToken}`,
    "Content-Type": "application/json",
  };

  const counts = emptyCounts();
  let skipped = 0;
  let docs = 0;
  let pageToken = "";
  do {
    const url =
      `${base}/votes?pageSize=300` + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url, { headers });
    const body = await res.json();
    if (!res.ok) {
      console.error("List votes failed:", res.status, JSON.stringify(body, null, 2));
      console.error(
        "\nPublish TEMP signed-in read on votes, re-run this script, then publish owner-only rules.\n"
      );
      process.exit(1);
    }
    for (const doc of body.documents || []) {
      docs += 1;
      const dest = doc.fields?.destination?.stringValue;
      if (DEST_IDS.includes(dest)) counts[dest] += 1;
      else skipped += 1;
    }
    pageToken = body.nextPageToken || "";
  } while (pageToken);

  const totalVotes = DEST_IDS.reduce((s, id) => s + counts[id], 0);
  const stamp = nowIso();
  const fields = {
    totalVotes: fieldInt(totalVotes),
    updatedAt: fieldString(stamp),
    rebuiltAt: fieldString(stamp),
    counts: {
      mapValue: {
        fields: Object.fromEntries(DEST_IDS.map((id) => [id, fieldInt(counts[id])])),
      },
    },
  };

  const patch = await fetch(`${base}/publicTallies/live`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields }),
  });
  const patchBody = await patch.json();
  if (!patch.ok) {
    console.error("Write tallies failed:", patch.status, JSON.stringify(patchBody, null, 2));
    process.exit(1);
  }

  console.log("Wrote publicTallies/live:");
  console.log(JSON.stringify({ counts, totalVotes, updatedAt: stamp, voteDocs: docs, skipped }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
