/**
 * Static build for Vercel: copies only the public site into dist/.
 * data/, server/, scripts/ and .env never reach the output.
 *
 *   npm run build
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");
const PUBLIC = ["index.html", "assets", "css", "js"];
const PRIVATE = ["data", "server", "scripts", "api", ".env"];

function measure(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return { files: 1, bytes: stat.size };
  return readdirSync(path).reduce(
    (sum, name) => {
      const child = measure(join(path, name));
      return { files: sum.files + child.files, bytes: sum.bytes + child.bytes };
    },
    { files: 0, bytes: 0 }
  );
}

function size(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const started = Date.now();
const missing = PUBLIC.filter((name) => !existsSync(join(ROOT, name)));
if (missing.length) {
  console.error(`\n✖ Build failed: missing ${missing.join(", ")}\n`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

console.log("\nKAZ Anniversary Tour 2026 · build\n");
let total = { files: 0, bytes: 0 };
for (const name of PUBLIC) {
  cpSync(join(ROOT, name), join(OUT, name), { recursive: true });
  const part = measure(join(OUT, name));
  total = { files: total.files + part.files, bytes: total.bytes + part.bytes };
  const label = part.files === 1 ? "1 file" : `${part.files} files`;
  console.log(`  ✓ ${name.padEnd(12)} ${label.padStart(9)} ${size(part.bytes).padStart(10)}`);
}

const leaked = PRIVATE.filter((name) => existsSync(join(OUT, name)));
if (leaked.length) {
  console.error(`\n✖ Build failed: private paths in dist/: ${leaked.join(", ")}\n`);
  process.exit(1);
}

console.log(`\n✔ Built dist/ · ${total.files} files · ${size(total.bytes)} · ${Date.now() - started} ms`);
console.log("  Private paths kept out: data/, server/, scripts/, .env\n");
