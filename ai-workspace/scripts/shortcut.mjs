#!/usr/bin/env node
/** "snelkoppeling-maken.bat": puts the AI Workspace icon on the desktop and in "Apex tools". */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createShortcuts } from "./lib/shortcut.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apexDir = process.argv[2]; // optional: your own "Apex tools" folder
const r = createShortcuts(root, apexDir);
if (!r.ok) {
  console.error(`Snelkoppeling maken mislukt: ${r.error}`);
  process.exit(1);
}
if (r.created) console.log(`Map aangemaakt: ${r.created}`);
for (const dir of r.placed) console.log(`Icoon "AI Workspace" geplaatst in: ${dir}`);
