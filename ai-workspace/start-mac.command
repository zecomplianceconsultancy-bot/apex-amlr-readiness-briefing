#!/bin/bash
# Dubbelklik om AI Workspace te starten.
cd "$(dirname "$0")" || exit 1
# Vanuit Finder ontbreken Homebrew-paden soms in PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is nog niet geïnstalleerd."
  if command -v brew >/dev/null 2>&1; then
    echo "Node.js wordt nu geïnstalleerd via Homebrew..."
    brew install node || exit 1
  else
    echo "Installeer Node.js LTS via https://nodejs.org en dubbelklik daarna opnieuw op start-mac.command"
    open "https://nodejs.org"
    read -n 1 -s -r -p "Druk op een toets om te sluiten"
    exit 1
  fi
fi
node scripts/launcher.mjs || read -n 1 -s -r -p "Er ging iets mis. Druk op een toets om te sluiten"
