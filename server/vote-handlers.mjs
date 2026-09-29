/**
 * Employee OTP vote handlers, shared by the local server (server/vote-api.mjs)
 * and the Vercel functions (api/vote/*.mjs).
 * Secrets come from the environment. The HTTP response never includes the OTP.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEST_NAMES,
  OTP_RESEND_WAIT_MS,
  OTP_TTL_MS,
  assessRoster,
  buildOtpRecord,
  canonicalEmployeeId,
  commitVerifiedVote,
  emailClaimPath,
  generateOtp,
  otpAvailability,
  playfulWarning,
  resendGate,
  reusableOtp,
} from "./vote-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const roster = JSON.parse(readFileSync(join(ROOT, "data/employees.json"), "utf8"));

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

function invalidJson() {
  return Object.assign(new Error("invalid_json"), { code: "invalid_json" });
}

// Vercel parses the body before the handler runs; the local server leaves the stream.
function requestBody(req) {
  let parsed;
  try {
    parsed = req.body;
  } catch {
    return Promise.reject(invalidJson());
  }
  if (parsed === undefined) return readBody(req);
  if (parsed === null || parsed === "") return Promise.resolve({});
  if (typeof parsed === "string" || Buffer.isBuffer(parsed)) {
    try {
      return Promise.resolve(JSON.parse(parsed.toString("utf8")));
    } catch {
      return Promise.reject(invalidJson());
    }
  }
  return Promise.resolve(parsed);
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
        reject(invalidJson());
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
      // Hosting dashboards store the key with literal \n escapes.
      const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
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
        async queryOne(collection, field, value) {
          const snap = await tx.get(db.collection(collection).where(field, "==", value).limit(1));
          if (snap.empty) return { exists: false, data: null };
          return { exists: true, data: snap.docs[0].data() };
        },
      };
      return fn(api);
    });
}

function mailConfigured() {
  return !!(process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN && process.env.MAIL_FROM);
}

function otpMailText(otp, destinationId) {
  const destination = DEST_NAMES[destinationId];
  return [
    "KAZ Software অ্যানিভার্সারি ট্রিপ ২০২৬",
    "",
    "আপনার ভোটের কোড:",
    otp,
    "",
    destination ? `আপনার পছন্দ: ${destination}` : "",
    "কোডটি ১০ মিনিট কাজ করবে, একবারই ব্যবহার করা যাবে।",
    "ওয়েবসাইটে গিয়ে কোডটি লিখলেই ভোট নিশ্চিত হবে।",
    "",
    "Do not share this OTP with anyone.",
    "আপনি ভোট দিতে না চেয়ে থাকলে এই ইমেইলটি উপেক্ষা করুন।",
    "",
    "KAZ Software",
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

/* Mail clients drop <style>, web fonts, and most CSS: tables and inline styles only. */
function otpMailHtml(otp, destinationId) {
  const code = String(otp).replace(/[^\d]/g, "");
  const destination = DEST_NAMES[destinationId] || "";
  const sans = "'Hind Siliguri','Noto Sans Bengali','Segoe UI',Helvetica,Arial,sans-serif";
  const serif = "'Noto Serif Bengali',Georgia,'Times New Roman',serif";
  const mono = "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace";
  const route = destination
    ? `<tr>
                  <td style="padding:18px 22px 0;font-family:${sans};font-size:13px;line-height:1.5;color:#1f4d40;">
                    ঢাকা &nbsp;&rarr;&nbsp; <strong style="font-weight:600;">${destination}</strong>
                  </td>
                </tr>`
    : "";
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>ভোটের কোড</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;font-size:1px;line-height:1px;">
    কোডটি ১০ মিনিট কাজ করবে। ওয়েবসাইটে লিখলেই ভোট নিশ্চিত হবে।
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="background:#ffffff;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:520px;background:#ffffff;border:1px solid #dfe5e2;border-radius:14px;">
          <tr>
            <td height="5" bgcolor="#e9b44c" style="height:5px;line-height:5px;font-size:0;background:#e9b44c;border-radius:13px 13px 0 0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:22px 28px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-family:${sans};font-size:15px;font-weight:700;color:#1f4d40;">KAZ Software</td>
                  <td align="right" style="font-family:${sans};font-size:13px;color:#5b6b65;">অ্যানিভার্সারি ট্রিপ ২০২৬</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:26px 28px 0;font-family:${serif};font-size:27px;line-height:1.3;color:#10201b;">
              আপনার ভোটের কোড
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0;font-family:${sans};font-size:15px;line-height:1.65;color:#44534d;">
              কোডটি ওয়েবসাইটে লিখলেই আপনার ভোট নিশ্চিত হবে।
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f8f6" style="background:#f3f8f6;border:1px solid #c9dcd5;border-radius:12px;">
                ${route}
                <tr>
                  <td align="center" style="padding:${destination ? "14px" : "26px"} 12px 22px 22px;font-family:${mono};font-size:40px;line-height:1.2;font-weight:700;letter-spacing:10px;color:#10201b;">
                    ${code}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 22px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr><td height="1" style="height:1px;line-height:1px;font-size:0;border-top:1px dashed #9fbdb2;">&nbsp;</td></tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 22px 14px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-family:${sans};font-size:13px;line-height:1.5;color:#44534d;">মেয়াদ <strong style="color:#10201b;font-weight:600;">১০ মিনিট</strong></td>
                        <td align="right" style="font-family:${sans};font-size:13px;line-height:1.5;color:#44534d;">একবারই ব্যবহার করা যাবে</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="3" bgcolor="#e9b44c" style="width:3px;background:#e9b44c;font-size:0;line-height:0;">&nbsp;</td>
                  <td style="padding:2px 0 2px 12px;font-family:${sans};font-size:14px;line-height:1.6;color:#10201b;">
                    Do not share this OTP with anyone.<br />
                    <span style="color:#44534d;">কোডটি কাউকে জানাবেন না। KAZ-এর কেউ এই কোড চাইবে না।</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 24px;font-family:${sans};font-size:12px;line-height:1.6;color:#5b6b65;">
              আপনি ভোট দিতে না চেয়ে থাকলে এই ইমেইলটি উপেক্ষা করুন। কোড ছাড়া কোনো ভোট গণনা হয় না।
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendOtpMail(to, otp, destinationId) {
  const base = (process.env.MAILGUN_API_BASE || "https://api.mailgun.net").replace(/\/$/, "");
  const domain = process.env.MAILGUN_DOMAIN;
  const body = new URLSearchParams({
    from: process.env.MAIL_FROM,
    to,
    subject: "KAZ Anniversary Tour 2026 — ভোটের কোড",
    text: otpMailText(otp, destinationId),
    html: otpMailHtml(otp, destinationId),
  });
  const response = await fetch(`${base}/v3/${encodeURIComponent(domain)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${process.env.MAILGUN_API_KEY}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`mailgun ${response.status}`);
  }
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
  const mailSnap = await db.doc(emailClaimPath(checked.email)).get();
  const legacyMail = await db.collection("votes").where("email", "==", checked.email).limit(1).get();
  if (mailSnap.exists || !legacyMail.empty) {
    return { status: 409, body: { ok: false, error: "email_taken" } };
  }
  const nowMs = Date.now();
  const otpRef = db.doc(`voteOtps/${checked.employeeId}`);
  const otpSnap = await otpRef.get();
  const previous = otpSnap.exists ? otpSnap.data() : null;
  const gate = resendGate(previous, nowMs);
  if (reusableOtp(previous, nowMs)) {
    if (!body.resend) {
      return {
        status: 200,
        body: {
          ok: true,
          existing: true,
          destinationId: previous.destinationId || null,
          resendAfter: gate.ok ? 0 : gate.retryAfter,
          expiresIn: Math.max(0, Math.ceil((Number(previous.expiresAt) - nowMs) / 1000)),
        },
      };
    }
    if (!gate.ok) return { status: 429, body: gate };
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
    sends: gate.sends,
  });
  await otpRef.set(record);
  try {
    await sendOtpMail(checked.email, otp, checked.destinationId);
  } catch (err) {
    if (previous) await otpRef.set(previous).catch(() => {});
    else await otpRef.delete().catch(() => {});
    console.error("[vote-api] mail failed", err && err.message ? err.message : err);
    return { status: 502, body: { ok: false, error: "mail_failed" } };
  }
  console.log("[vote-api] otp sent", checked.employeeId);
  return {
    status: 200,
    body: {
      ok: true,
      existing: false,
      resendAfter: OTP_RESEND_WAIT_MS / 1000,
      expiresIn: OTP_TTL_MS / 1000,
    },
  };
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

export { otpMailHtml, otpMailText };

export const routes = {
  "/api/vote/request": (body) => handleRequest(body),
  "/api/vote/verify": (body, req) => handleVerify(body, clientIp(req)),
  "/api/vote/status": (body) => handleStatus(body),
};

export async function handle(req, res, route) {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }
  if (req.method !== "POST" || !route) {
    send(res, 404, { ok: false, error: "not_found" });
    return;
  }
  try {
    const body = await requestBody(req);
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
}
