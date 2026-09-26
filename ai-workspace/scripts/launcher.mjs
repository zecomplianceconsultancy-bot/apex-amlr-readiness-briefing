#!/usr/bin/env node
/**
 * Desktop launcher (started by start-windows.bat / start-mac.command).
 * Installs dependencies and builds the app when needed, starts it on this computer only
 * (127.0.0.1) and opens it in the browser. Uses only Node.js built-ins.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const isWin = process.platform === "win32";
const stampDir = path.join(root, "data", ".launcher");
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

// 3. Build
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

// 4. Start (only reachable from this computer) and open the browser
say(`Starten op ${origin} …`);
const child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(port)], {
  stdio: ["ignore", "inherit", "inherit"],
  shell: isWin,
  env: { ...process.env, ...extraEnv, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

for (let i = 0; i < 120; i++) {
  try {
    const res = await fetch(`${origin}/login`, { redirect: "manual" });
    if (res.status < 500) break;
  } catch {
    // not up yet
  }
  await new Promise((r) => setTimeout(r, 500));
}
openBrowser(origin);
say(`AI Workspace draait: ${origin}`);
say(`Je gegevens staan in: ${path.join(root, "data")}  (maak hier back-ups van)`);
say("Laat dit venster open. Sluit het (of Ctrl+C) om te stoppen.");
