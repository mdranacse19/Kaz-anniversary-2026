/**
 * Employee OTP vote API.
 * Secrets stay in .env. The HTTP response never includes the OTP.
 *
 *   npm run vote-api
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessRoster,
  buildOtpRecord,
  canonicalEmployeeId,
  commitVerifiedVote,
  generateOtp,
  otpAvailability,
  playfulWarning,
  reusableOtp,
} from "./vote-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";

loadEnv(join(ROOT, ".env"));

const roster = JSON.parse(readFileSync(join(ROOT, "data/employees.json"), "utf8"));

function loadEnv(path) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
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

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : "";
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        reject(Object.assign(new Error("too_large"), { code: "too_large" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error("invalid_json"), { code: "invalid_json" }));
      }
    });
    req.on("error", reject);
  });
}

let dbPromise = null;
async function firestore() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const projectId = process.env.FIREBASE_PROJECT_ID;
      const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
      const privateKey = process.env.FIREBASE_PRIVATE_KEY;
      if (!projectId || !clientEmail || !privateKey) {
        const err = new Error("firebase_not_configured");
        err.code = "firebase_not_configured";
        throw err;
      }
      const { default: admin } = await import("firebase-admin");
      if (!admin.apps.length) {
        admin.initializeApp({
          credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
        });
      }
      return admin.firestore();
    })();
  }
  return dbPromise;
}

function runTransaction(db) {
  return (fn) =>
    db.runTransaction(async (tx) => {
      const api = {
        async get(path) {
          const snap = await tx.get(db.doc(path));
          return { exists: snap.exists, data: snap.exists ? snap.data() : null };
        },
        async create(path, data) {
          tx.create(db.doc(path), data);
        },
        async set(path, data) {
          tx.set(db.doc(path), data);
        },
      };
      return fn(api);
    });
}

function mailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.MAIL_FROM);
}

function otpMailText(otp) {
  return [
    "KAZ Software অ্যানিভার্সারি ট্যুর ২০২৬",
    "",
    "ভোট নিশ্চিত করার কোড:",
    otp,
    "",
    "এই কোড ১০ মিনিটের জন্য। ওয়েবসাইটে গিয়ে এই কোডটি লিখে ভোট শেষ করুন।",
    "Do not share this OTP with anyone.",
    "",
    "KAZ Software",
  ].join("\n");
}

function otpMailHtml(otp) {
  const code = String(otp).replace(/[^\d]/g, "");
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ভোটের কোড</title>
</head>
<body style="margin:0;padding:0;background:#0a1210;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a1210;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#13201c;border:1px solid rgba(242,239,232,0.12);border-radius:16px;">
          <tr>
            <td style="padding:28px 24px 8px;font-family:Georgia,'Noto Serif Bengali',serif;color:#e9b44c;font-size:13px;letter-spacing:0.08em;">
              KAZ SOFTWARE
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 8px;font-family:Georgia,'Noto Serif Bengali',serif;color:#f2efe8;font-size:26px;line-height:1.35;">
              অ্যানিভার্সারি ট্যুর ২০২৬
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 20px;font-family:'Hind Siliguri',system-ui,sans-serif;color:#8ba39a;font-size:15px;line-height:1.6;">
              ভোট নিশ্চিত করতে নিচের কোডটি ওয়েবসাইটে লিখুন। কোডটি ১০ মিনিট পর্যন্ত কাজ করবে।
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a2c26;border-radius:12px;border:1px solid rgba(233,180,76,0.45);">
                <tr>
                  <td align="center" style="padding:22px 16px 6px;font-family:system-ui,sans-serif;color:#e9b44c;font-size:12px;letter-spacing:0.14em;">
                    আপনার কোড
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding:4px 16px 22px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#f2efe8;font-size:36px;letter-spacing:0.35em;font-weight:700;">
                    ${code}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;font-family:'Hind Siliguri',system-ui,sans-serif;color:#f2efe8;font-size:14px;line-height:1.6;">
              Do not share this OTP with anyone.
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 22px;border-top:1px solid rgba(242,239,232,0.12);font-family:system-ui,sans-serif;color:#8ba39a;font-size:12px;line-height:1.5;">
              KAZ Software · Anniversary Tour 2026<br />
              এই ইমেইলটি আপনার ভোটের জন্য পাঠানো হয়েছে।
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendOtpMail(to, otp) {
  const { default: nodemailer } = await import("nodemailer");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM,
    to,
    subject: "KAZ Anniversary Tour 2026 — ভোটের কোড",
    text: otpMailText(otp),
    html: otpMailHtml(otp),
  });
}

async function handleRequest(body) {
  const checked = assessRoster({
    employeeId: body.employeeId,
    name: body.name,
    email: body.email,
    destinationId: body.destinationId,
    roster,
  });
  if (!checked.ok) return { status: 400, body: checked };

  const db = await firestore();
  const voteSnap = await db.doc(`votes/${checked.employeeId}`).get();
  if (voteSnap.exists) {
    return {
      status: 409,
      body: {
        ok: false,
        error: "already_voted",
        warning: playfulWarning(checked.displayToken),
      },
    };
  }
  const nowMs = Date.now();
  const otpRef = db.doc(`voteOtps/${checked.employeeId}`);
  const otpSnap = await otpRef.get();
  const previous = otpSnap.exists ? otpSnap.data() : null;
  if (reusableOtp(previous, nowMs)) {
    return { status: 200, body: { ok: true, existing: true } };
  }
  if (!mailConfigured()) {
    return { status: 503, body: { ok: false, error: "mail_not_configured" } };
  }

  const otp = generateOtp();
  const record = buildOtpRecord({
    employee: checked.employee,
    email: checked.email,
    destinationId: checked.destinationId,
    otp,
    nowMs,
    displayToken: checked.displayToken,
  });
  await otpRef.set(record);
  try {
    await sendOtpMail(checked.email, otp);
  } catch (err) {
    if (previous) await otpRef.set(previous).catch(() => {});
    else await otpRef.delete().catch(() => {});
    console.error("[vote-api] mail failed", err && err.message ? err.message : err);
    return { status: 502, body: { ok: false, error: "mail_failed" } };
  }
  console.log("[vote-api] otp sent", checked.employeeId);
  return { status: 200, body: { ok: true, existing: false } };
}

async function handleStatus(body) {
  const employeeId = canonicalEmployeeId(body.employeeId);
  if (!employeeId) return { status: 400, body: { ok: false, error: "invalid_id" } };
  const db = await firestore();
  const voteSnap = await db.doc(`votes/${employeeId}`).get();
  if (voteSnap.exists) {
    return { status: 409, body: { ok: false, error: "already_voted" } };
  }
  const otpSnap = await db.doc(`voteOtps/${employeeId}`).get();
  const record = otpSnap.exists ? otpSnap.data() : null;
  return {
    status: 200,
    body: {
      ok: true,
      status: otpAvailability(record, Date.now()),
      destinationId: record && record.destinationId ? record.destinationId : null,
    },
  };
}

async function handleVerify(body, ip) {
  const employeeId = canonicalEmployeeId(body.employeeId);
  if (!employeeId) return { status: 400, body: { ok: false, error: "invalid_id" } };
  const db = await firestore();
  const result = await commitVerifiedVote(runTransaction(db), {
    employeeId,
    otp: body.otp,
    ip,
    nowMs: Date.now(),
  });
  return { status: result.ok ? 200 : 400, body: result };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }
  const url = new URL(req.url || "/", `http://${HOST}`);
  const routes = {
    "/api/vote/request": (body) => handleRequest(body),
    "/api/vote/verify": (body, req) => handleVerify(body, clientIp(req)),
    "/api/vote/status": (body) => handleStatus(body),
  };
  const route = routes[url.pathname];
  if (req.method !== "POST" || !route) {
    send(res, 404, { ok: false, error: "not_found" });
    return;
  }
  try {
    const body = await readBody(req);
    const result = await route(body, req);
    send(res, result.status, result.body);
  } catch (err) {
    const code = err && err.code ? err.code : "server";
    if (code === "firebase_not_configured") {
      send(res, 503, { ok: false, error: "firebase_not_configured" });
      return;
    }
    if (code === "invalid_json" || code === "too_large") {
      send(res, 400, { ok: false, error: code });
      return;
    }
    console.error("[vote-api]", err && err.message ? err.message : err);
    send(res, 500, { ok: false, error: "server" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[vote-api] http://${HOST}:${PORT}`);
});
