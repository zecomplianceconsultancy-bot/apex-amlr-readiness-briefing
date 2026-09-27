#!/usr/bin/env node
/**
 * Desktop launcher (started by start-windows.bat / start-mac.command).
 * Installs dependencies and builds the app when needed, starts it on this computer only
 * (127.0.0.1) and opens it in the browser. Uses only Node.js built-ins.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import { createInterface } from "node:readline/promises";
import { createShortcuts } from "./lib/shortcut.mjs";
import { readZip } from "./lib/zip.mjs";
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

/** On Windows, npm/npx are .cmd shims that must run via cmd.exe; our arguments contain no spaces. */
function command(cmd, args) {
  return isWin ? ["cmd.exe", ["/d", "/s", "/c", [cmd, ...args].join(" ")]] : [cmd, args];
}

function run(cmd, args, extraEnv = {}) {
  const [c, a] = command(cmd, args);
  const r = spawnSync(c, a, { stdio: "inherit", env: { ...process.env, ...extraEnv } });
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
          ["msedge", "/opt/microsoft/msedge/msedge"],
        ];
  return candidates.find(([, p]) => existsSync(p))?.[0];
}

/** Does anything answer on this port, over IPv4 or IPv6 ("localhost" may be either)? */
function answers(port, host) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(400, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}
function canBind(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}
/** First port from `start` that no other program uses (other local apps often sit on 3000). */
async function freePort(start) {
  for (let port = start; port < start + 50; port++) {
    if ((await canBind(port)) && !(await answers(port, "127.0.0.1")) && !(await answers(port, "::1"))) return port;
  }
  fail(`Geen vrije poort gevonden vanaf ${start}.`);
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
  if (await mayOpenBrowser(url)) return openBrowser(url);
  // Not opened automatically: ask each time, so opening is always the user's own choice.
  if (await ask(`[AI Workspace] Nu openen in je browser? (j/n) `)) openBrowser(url);
  else say(`Open zelf je browser op ${url}`);
}

/** Windows: offer once to put the "AI Workspace" icon on the desktop and in "Apex tools". */
async function offerShortcut() {
  const prefs = readPrefs();
  if (!isWin || typeof prefs.shortcut === "boolean" || !process.stdin.isTTY) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`\n[AI Workspace] Icoon "AI Workspace" op je bureaublad en in je map "Apex tools" zetten? (j/n) `)).trim().toLowerCase();
  rl.close();
  const wanted = answer.startsWith("j") || answer.startsWith("y");
  writeFileSync(prefsFile, JSON.stringify({ ...readPrefs(), shortcut: wanted }, null, 2));
  if (!wanted) return say("Geen icoon. Later alsnog? Dubbelklik op snelkoppeling-maken.bat.");
  const r = createShortcuts(root);
  if (!r.ok) return say(`Icoon maken lukte niet (${r.error}). Probeer snelkoppeling-maken.bat.`);
  if (r.created) say(`Map aangemaakt: ${r.created}`);
  for (const dir of r.placed) say(`Icoon geplaatst in: ${dir}`);
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


// 0. Updates: a newer ai-workspace*.zip in Downloads (or dragged onto the start file) is
//    installed after the user agrees. data/ and .env are never touched.
const PROTECTED = [/^data\//, /^\.env$/, /^node_modules\//, /^\.next\//];
const MANAGED_DIRS = ["src", "drizzle", "scripts", "docs", "tests", "public"];

function versionOf(json) {
  try {
    return JSON.parse(json).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function newer(a, b) {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}
const localRelease = existsSync(path.join(root, "release.json")) ? readFileSync(path.join(root, "release.json"), "utf8") : "{}";
const localVersion = versionOf(localRelease);

function inspectZip(file) {
  try {
    if (statSync(file).size > 100 * 1024 * 1024) return null;
    const zip = readZip(readFileSync(file));
    const rel = zip.entries.find((e) => /^[^/]+\/release\.json$/.test(e.name));
    if (!rel) return null;
    const json = zip.read(rel).toString("utf8");
    return { file, zip, prefix: rel.name.split("/")[0] + "/", version: versionOf(json), notes: JSON.parse(json).notes ?? [] };
  } catch {
    return null;
  }
}

function findUpdate(explicit) {
  if (explicit) return inspectZip(explicit);
  const dirs = [
    process.env.AIW_UPDATE_DIR,
    path.join(os.homedir(), "Downloads"),
    path.join(os.homedir(), "OneDrive", "Downloads"),
    path.dirname(root),
  ].filter((d) => d && existsSync(d));
  let best = null;
  for (const dir of new Set(dirs)) {
    for (const f of readdirSync(dir)) {
      if (!/^ai-workspace.*\.zip$/i.test(f)) continue;
      const found = inspectZip(path.join(dir, f));
      if (found && newer(found.version, localVersion) && (!best || newer(found.version, best.version))) best = found;
    }
  }
  return best;
}

function applyUpdate(update) {
  const incoming = new Set();
  for (const e of update.zip.entries) {
    if (!e.name.startsWith(update.prefix) || e.name.endsWith("/")) continue;
    const rel = e.name.slice(update.prefix.length);
    // Never write outside the app folder or over user data.
    if (!rel || rel.includes("..") || path.isAbsolute(rel) || PROTECTED.some((re) => re.test(rel))) continue;
    incoming.add(rel.split("/").join(path.sep));
    const target = path.join(root, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, update.zip.read(e));
    if (!isWin && e.mode & 0o111) chmodSync(target, 0o755);
  }
  // Remove source files that no longer exist in the new version.
  let removed = 0;
  const prune = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) prune(full);
      else if (!incoming.has(path.relative(root, full))) {
        unlinkSync(full);
        removed++;
      }
    }
  };
  MANAGED_DIRS.forEach((d) => prune(path.join(root, d)));
  return { written: incoming.size, removed };
}

async function ask(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(question)).trim().toLowerCase();
  rl.close();
  return answer.startsWith("j") || answer.startsWith("y");
}

const explicitZip = process.argv.slice(2).find((a) => a.toLowerCase().endsWith(".zip"));
const update = findUpdate(explicitZip);
if (explicitZip && !update) say(`${explicitZip} is geen geldige AI Workspace-update; ik start de huidige versie.`);

const userEnv = { ...dotenv(), ...process.env };
const extraEnv = {};

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
        if (update) say(`Er staat een update klaar (versie ${update.version}). Sluit eerst het andere zwarte venster en start dan opnieuw om te installeren.`);
        say(`AI Workspace draait al: ${lock.url}`);
        if (readPrefs().openBrowser === true) openBrowser(lock.url);
        else if (await ask(`[AI Workspace] Nu openen in je browser? (j/n) `)) openBrowser(lock.url);
        else say(`Open zelf je browser op ${lock.url}`);
        process.exit(0);
      }
    }
  } catch {
    // stale or unreadable lock: continue
  }
}


if (update) {
  const isNewer = newer(update.version, localVersion);
  say(`${isNewer ? "Nieuwe versie gevonden" : "Update-bestand"}: ${update.version} (je hebt ${localVersion}) — ${path.basename(update.file)}`);
  for (const n of update.notes) say(`  • ${n}`);
  if (!isNewer) say("Let op: dit is niet nieuwer dan je huidige versie.");
  // Dragging the ZIP onto the start file is itself the user's go-ahead.
  const go = explicitZip ? true : await ask("[AI Workspace] Nu installeren? Je gegevens blijven behouden. (j/n) ");
  if (go) {
    const { written, removed } = applyUpdate(update);
    say(`Update geïnstalleerd: versie ${update.version} (${written} bestanden bijgewerkt, ${removed} oude bestanden opgeruimd).`);
    // Continue with the new version of this launcher, not the old code still in memory.
    const args = process.argv.slice(2).filter((a) => !a.toLowerCase().endsWith(".zip"));
    const next = spawnSync(process.execPath, [path.join(root, "scripts", "launcher.mjs"), ...args], { stdio: "inherit" });
    process.exit(next.status ?? 1);
  } else {
    say("Update overgeslagen; je kunt hem later installeren door opnieuw te starten.");
  }
}

await offerShortcut();

// 1. Dependencies
const deps = stamp("deps");
// Content hash (not mtime): an update rewrites files, but dependencies only change with the lock file.
const depsHash = createHash("sha256").update(readFileSync(path.join(root, "package-lock.json"))).digest("hex");
if (!existsSync(path.join(root, "node_modules")) || deps.read() !== depsHash) {
  say("Onderdelen installeren (eenmalig, duurt enkele minuten)…");
  if (!run("npm", ["ci", "--no-audit", "--no-fund"]) && !run("npm", ["install", "--no-audit", "--no-fund"])) fail("Installeren mislukt. Controleer je internetverbinding en probeer opnieuw.");
  deps.write(depsHash);
}

// 2. Browser control is off by default (sites block controlled browsers). Only when it is
//    switched on in .env and neither Edge nor Chrome exists is the built-in Chromium fetched.
const browserControl = String(userEnv.ENABLE_BROWSER_PROVIDER ?? "").toLowerCase() === "true";
if (browserControl && (userEnv.BROWSER_DEFAULT === "chromium" || !findChromeChannel())) {
  const pw = stamp("playwright-chromium");
  if (pw.read() !== "ok") {
    say("Geen Edge of Chrome gevonden: ingebouwde Chromium downloaden (eenmalig)…");
    if (!run("npx", ["playwright", "install", "chromium"])) fail("Chromium downloaden mislukt.");
    pw.write("ok");
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
// A fixed, uncommon port that is remembered, so the address (and a bookmark) stays the same.
const DEFAULT_PORT = 3777;
const wantedPort = Number(userEnv.PORT) || readPrefs().port || DEFAULT_PORT;
const port = await freePort(wantedPort);
if (port !== wantedPort) say(`Poort ${wantedPort} is in gebruik door een ander programma; de workspace gebruikt nu ${port}.`);
if (!userEnv.PORT && readPrefs().port !== port) writeFileSync(prefsFile, JSON.stringify({ ...readPrefs(), port }, null, 2));
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
  const [c, a] = command("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(port)]);
  child = spawn(c, a, {
    stdio: ["ignore", "pipe", "pipe"],
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
const bar = "=".repeat(60);
console.log(`\n\x1b[32m${bar}\n    AI Workspace staat klaar op:\n    \x1b[1m${origin}\x1b[22m\n    Typ precies dit adres in je browser (niet "localhost").\n${bar}\x1b[0m\n`);
await offerBrowser(origin);
say(`Je gegevens staan in: ${dataDir}  (automatische back-ups in data/backups)`);
say("Laat dit venster open. Sluit het (of Ctrl+C) om te stoppen.");
