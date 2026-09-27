/**
 * Desktop icon for the workspace (Windows): "AI Workspace" on the desktop and in the user's
 * "Apex tools" folder. Uses PowerShell + WScript.Shell, which every Windows has; no downloads.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const psString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * PowerShell script that creates the shortcuts. `apexDir` (optional) is where the user keeps
 * "Apex tools"; otherwise an existing folder named like "Apex tools" is looked up next to the
 * desktop and documents (also on OneDrive), and created on the desktop when there is none.
 */
export function shortcutScript(root, apexDir) {
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = ${psString(root)}
$target = Join-Path $root 'start-windows.bat'
$icon = Join-Path $root 'assets\\ai-workspace.ico'
$desktop = [Environment]::GetFolderPath('Desktop')
$apex = ${apexDir ? psString(apexDir) : "$null"}
if (-not $apex) {
  $places = @($desktop, [Environment]::GetFolderPath('MyDocuments'), $env:USERPROFILE)
  if ($env:OneDrive) { $places += @($env:OneDrive, (Join-Path $env:OneDrive 'Bureaublad'), (Join-Path $env:OneDrive 'Desktop'), (Join-Path $env:OneDrive 'Documenten'), (Join-Path $env:OneDrive 'Documents')) }
  foreach ($p in ($places | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique)) {
    $found = Get-ChildItem -LiteralPath $p -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^apex[ _-]*tools$' } | Select-Object -First 1
    if ($found) { $apex = $found.FullName; break }
  }
}
if (-not $apex) { $apex = Join-Path $desktop 'Apex tools' }
if (-not (Test-Path -LiteralPath $apex)) { New-Item -ItemType Directory -Path $apex -Force | Out-Null; Write-Output "NEW:$apex" }
$shell = New-Object -ComObject WScript.Shell
foreach ($dir in @($desktop, $apex)) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'AI Workspace.lnk'))
  $lnk.TargetPath = $target
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = "$icon,0"
  $lnk.Description = 'AI Workspace starten'
  $lnk.Save()
  Write-Output "OK:$dir"
}
`;
}

/** Creates the shortcuts; returns the folders they were placed in and a newly created folder, if any. */
export function createShortcuts(root, apexDir) {
  if (process.platform !== "win32") return { ok: false, error: "Snelkoppelingen maken kan alleen op Windows." };
  const script = shortcutScript(path.resolve(root), apexDir);
  // -EncodedCommand (UTF-16LE, base64): no quoting problems with spaces, quotes or accents in paths.
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { encoding: "utf8" });
  const lines = (r.stdout ?? "").split(/\r?\n/);
  const placed = lines.filter((l) => l.startsWith("OK:")).map((l) => l.slice(3));
  const created = lines.find((l) => l.startsWith("NEW:"))?.slice(4);
  if (r.status !== 0 || placed.length === 0) return { ok: false, error: (r.stderr || r.error?.message || "onbekende fout").trim().split(/\r?\n/)[0] };
  return { ok: true, placed, created };
}
