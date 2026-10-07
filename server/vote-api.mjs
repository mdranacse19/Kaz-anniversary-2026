/**
 * Employee OTP vote API, local server.
 * Secrets stay in .env. Production runs the same handlers from api/vote/*.mjs.
 *
 *   npm run vote-api
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handle, routes } from "./vote-handlers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

loadEnv(join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 8787);
const HOST = "127.0.0.1";

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}`);
  return handle(req, res, routes[url.pathname]);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`[vote-api] port ${PORT} is already in use. Stop the old server, then start this one again.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`[vote-api] http://${HOST}:${PORT}`);
});
