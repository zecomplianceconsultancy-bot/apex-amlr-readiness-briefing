#!/usr/bin/env node
/**
 * Desktop launcher (started by start-windows.bat / start-mac.command).
 * Installs dependencies and builds the app when needed, starts it on this computer only
 * (127.0.0.1) and opens it in the browser. Uses only Node.js built-ins.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const isWin = process.platform === "win32";
const dataDir = path.resolve(root, process.env.DATA_DIR ?? "data");
const stampDir = path.join(dataDir, ".launcher");
mkdirSync(stampDir, { recursive: true });

const say = (msg) => console.log(`\x1b[36m[AI Workspace]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[AI Workspace] ${msg}\x1b[0m`);
  process.exit(1);
};

function run(cmd, args, extraEnv = {}) {
  // .cmd shims on Windows must run through the shell.
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: isWin, env: { ...process.env, ...extraEnv } });
  return r.status === 0;
}

function stamp(name) {
  const f = path.join(stampDir, name);
  return { read: () => (existsSync(f) ? readFileSync(f, "utf8") : ""), write: (v) => writeFileSync(f, v) };
}

/** Values from .env (if any) so user settings always win over launcher defaults. */
function dotenv() {
  const f = path.join(root, ".env");
  if (!existsSync(f)) return {};
  return Object.fromEntries(
    readFileSync(f, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]),
  );
}

function hashTree(entries) {
  const h = createHash("sha256");
  const walk = (p) => {
    if (!existsSync(p)) return;
    const s = statSync(p);
    if (s.isDirectory()) for (const c of readdirSync(p).sort()) walk(path.join(p, c));
    else h.update(`${path.relative(root, p)}:${s.size}:${s.mtimeMs}\n`);
  };
  entries.forEach((e) => walk(path.join(root, e)));
  return h.digest("hex");
}

function findChromeChannel() {
  const candidates = isWin
    ? [
        ["chrome", path.join(process.env["PROGRAMFILES"] ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe")],
        ["chrome", path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe")],
        ["chrome", path.join(process.env["LOCALAPPDATA"] ?? "", "Google/Chrome/Application/chrome.exe")],
        ["msedge", path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft/Edge/Application/msedge.exe")],
        ["msedge", path.join(process.env["PROGRAMFILES"] ?? "C:\\Program Files", "Microsoft/Edge/Application/msedge.exe")],
      ]
    : process.platform === "darwin"
      ? [
          ["chrome", "/Applications/Google Chrome.app"],
          ["chrome", path.join(os.homedir(), "Applications/Google Chrome.app")],
          ["msedge", "/Applications/Microsoft Edge.app"],
        ]
      : [
          ["chrome", "/opt/google/chrome/chrome"],
          ["chrome", "/usr/bin/google-chrome"],
        ];
  return candidates.find(([, p]) => existsSync(p))?.[0];
}

function freePort(start) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(freePort(start + 1)));
    srv.listen(start, "127.0.0.1", () => srv.close(() => resolve(start)));
  });
}

// Opening the browser is also something we only do with the user's permission (asked once).
const prefsFile = path.join(stampDir, "prefs.json");
function readPrefs() {
  try {
    return JSON.parse(readFileSync(prefsFile, "utf8"));
  } catch {
    return {};
  }
}
async function mayOpenBrowser(url) {
  const prefs = readPrefs();
  if (typeof prefs.openBrowser === "boolean") return prefs.openBrowser;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\n[AI Workspace] Mag de workspace bij het starten voortaan zelf je browser openen op ${url}? (j/n) `)).trim().toLowerCase();
  rl.close();
  const allowed = answer.startsWith("j") || answer.startsWith("y");
  writeFileSync(prefsFile, JSON.stringify({ ...prefs, openBrowser: allowed }, null, 2));
  say(allowed ? "Onthouden: browser wordt voortaan automatisch geopend." : "Onthouden: browser wordt niet automatisch geopend.");
  say(`Wijzigen kan door ${prefsFile} te verwijderen.`);
  return allowed;
}
async function offerBrowser(url) {
  if (await mayOpenBrowser(url)) openBrowser(url);
  else say(`Open zelf je browser op ${url}`);
}

function openBrowser(url) {
  const [cmd, args] = isWin ? ["cmd", ["/c", "start", "", url]] : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
  // Not fatal: the address is printed, the user can open it manually.
  p.on("error", () => say(`Open zelf je browser op ${url}`));
  p.unref();
}

// ---------------------------------------------------------------------------

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) fail(`Node.js ${process.versions.node} is te oud. Installeer Node.js LTS (20.9 of nieuwer) via https://nodejs.org`);

const userEnv = { ...dotenv(), ...process.env };
const extraEnv = {};

// 1. Dependencies
const deps = stamp("deps");
const depsHash = hashTree(["package-lock.json"]);
if (!existsSync(path.join(root, "node_modules")) || deps.read() !== depsHash) {
  say("Onderdelen installeren (eenmalig, duurt enkele minuten)…");
  if (!run("npm", ["ci", "--no-audit", "--no-fund"]) && !run("npm", ["install", "--no-audit", "--no-fund"])) fail("Installeren mislukt. Controleer je internetverbinding en probeer opnieuw.");
  deps.write(depsHash);
}

// 2. Browser for the AI tools
if (userEnv.BROWSER_CHANNEL === undefined) {
  const channel = findChromeChannel();
  if (channel) {
    extraEnv.BROWSER_CHANNEL = channel;
    say(`Browser voor AI-tools: ${channel === "chrome" ? "Google Chrome" : "Microsoft Edge"}`);
  } else {
    extraEnv.BROWSER_CHANNEL = "";
    const pw = stamp("playwright-chromium");
    if (pw.read() !== "ok") {
      say("Geen Chrome/Edge gevonden: ingebouwde Chromium downloaden (eenmalig)…");
      if (!run("npx", ["playwright", "install", "chromium"])) fail("Chromium downloaden mislukt.");
      pw.write("ok");
    }
  }
}

// 3. Only one instance per data folder: two servers on one embedded database would corrupt it.
const lockFile = path.join(stampDir, "running.json");
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
if (existsSync(lockFile)) {
  try {
    const lock = JSON.parse(readFileSync(lockFile, "utf8"));
    if (lock.pid && alive(lock.pid)) {
      const ok = await fetch(`${lock.url}/api/health`).then((r) => r.ok, () => false);
      if (ok) {
        say(`AI Workspace draait al: ${lock.url}`);
        await offerBrowser(lock.url);
        process.exit(0);
      }
    }
  } catch {
    // stale or unreadable lock: continue
  }
}

// 4. Daily backup of the data folder (database, files, key) while nothing is running.
function backup() {
  const dir = path.join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  const existing = readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(d)).sort();
  const newest = existing.at(-1);
  if (newest && Date.now() - statSync(path.join(dir, newest)).mtimeMs < 20 * 3600_000) return;
  if (!existsSync(path.join(dataDir, "db"))) return; // nothing to back up yet
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  const target = path.join(dir, stamp);
  say("Back-up maken van je gegevens…");
  for (const item of ["db", "files", "encryption.key"]) {
    const src = path.join(dataDir, item);
    if (existsSync(src)) cpSync(src, path.join(target, item), { recursive: true });
  }
  for (const old of [...existing, stamp].slice(0, -7)) rmSync(path.join(dir, old), { recursive: true, force: true });
}
try {
  backup();
} catch (err) {
  say(`Waarschuwing: back-up mislukt (${err.message}). De workspace start gewoon.`);
}

// 5. Build when sources changed
const port = await freePort(Number(userEnv.PORT) || 3000);
const origin = `http://127.0.0.1:${port}`;
extraEnv.APP_ORIGIN = userEnv.APP_ORIGIN ?? origin;
const build = stamp("build");
const buildHash = hashTree(["src", "drizzle", "package-lock.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs"]);
if (!existsSync(path.join(root, ".next", "BUILD_ID")) || build.read() !== buildHash) {
  say("App voorbereiden (eenmalig na installatie of update, ± 1 minuut)…");
  if (!run("npx", ["next", "build"], { ...extraEnv, NEXT_TELEMETRY_DISABLED: "1" })) fail("Voorbereiden mislukt.");
  build.write(buildHash);
}

// 6. Start (only reachable from this computer), log to data/logs, restart after a crash.
const logDir = path.join(dataDir, "logs");
mkdirSync(logDir, { recursive: true });
for (const f of readdirSync(logDir)) {
  const p = path.join(logDir, f);
  if (Date.now() - statSync(p).mtimeMs > 14 * 86400_000) unlinkSync(p);
}
const log = createWriteStream(path.join(logDir, `server-${new Date().toISOString().slice(0, 10)}.log`), { flags: "a" });

let child;
let stopping = false;
const crashes = [];
function startServer() {
  child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWin,
    env: { ...process.env, ...extraEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => {
      process.stdout.write(chunk);
      log.write(chunk);
    });
  }
  child.on("exit", (code) => {
    if (stopping) return;
    const now = Date.now();
    crashes.push(now);
    const recent = crashes.filter((t) => now - t < 10 * 60_000);
    if (recent.length > 3) {
      rmSync(lockFile, { force: true });
      fail(`De workspace stopte ${recent.length} keer binnen 10 minuten (laatste code ${code}). Zie ${logDir}`);
    }
    say(`Server gestopt (code ${code}); automatisch herstarten…`);
    setTimeout(startServer, 1500);
  });
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  say("Afsluiten…");
  rmSync(lockFile, { force: true });
  child?.kill("SIGTERM");
  setTimeout(() => process.exit(0), 5000).unref();
  child?.on("exit", () => process.exit(0));
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, shutdown);
process.on("exit", () => rmSync(lockFile, { force: true }));

say(`Starten op ${origin} …`);
startServer();
writeFileSync(lockFile, JSON.stringify({ pid: process.pid, url: origin }));

for (let i = 0; i < 120; i++) {
  const ok = await fetch(`${origin}/api/health`).then((r) => r.ok, () => false);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 500));
}
say(`AI Workspace draait: ${origin}`);
await offerBrowser(origin);
say(`Je gegevens staan in: ${dataDir}  (automatische back-ups in data/backups)`);
say("Laat dit venster open. Sluit het (of Ctrl+C) om te stoppen.");
