#!/bin/bash
# Full in-game smoke test on jackpc: redeploy loader → launch → Lobby → start Level 0 → build map → teleport → screenshot.
#   tools/ingame_test.sh <SaveName> <mapName> [extra dev commands...]
set -u
SAVE="${1:-ETBRTest}"; MAP="${2:-ETBRTest}"; shift 2 || true
PC="${ETBR_PC:-jackpc}"; KEY="$HOME/.ssh/tidepool_win"; J="$HOME/.claude/jobs/a3c39b51/tmp"
cd "$(dirname "$0")/.."
s() { ssh -i "$KEY" "$PC" "$@" 2>/dev/null; }
state_world() { WAIT=3 ./tools/devcmd.sh "state" 2>/dev/null | grep -o "world=World [^ ]*" | tail -1; }
s 'taskkill /f /im CrashReportClient.exe >nul 2>&1 & taskkill /f /im Backrooms-Win64-Shipping.exe >nul 2>&1'
rm -rf "$J/payload/ETBRLoader" && cp -R loader/ETBRLoader "$J/payload/" && rm -rf "$J/payload/ETBRLoader/maps"
tar -czf "$J/payload.tgz" -C "$J" payload && scp -q -i "$KEY" "$J/payload.tgz" "$PC:ETBRMapper/payload.tgz"
s 'C:\Users\JackPC\ETBRMapper\redeploy-loader.cmd' | grep -E "DONE"
s 'schtasks /Run /TN ETBRGameRun' >/dev/null
for i in $(seq 1 25); do state_world | grep -q MainMenu && break; sleep 5; done; echo "menu ok"
WAIT=2 ./tools/devcmd.sh "ue open Lobby" >/dev/null
for i in $(seq 1 15); do state_world | grep -q Lobby.Lobby && break; sleep 4; done; echo "lobby ok"
printf 'click 1106 520\nwait 300\ntype %s\nkey {ENTER}\nwait 400\nclick 1106 744\n' "$SAVE" > "$J/click.txt"
scp -q -i "$KEY" "$J/click.txt" "$PC:ETBRMapper/click.txt"; s 'schtasks /Run /TN ETBRClick' >/dev/null
for i in $(seq 1 30); do w=$(state_world); echo "$w" | grep -q "Level0.Level0" && break; sleep 5; done; echo "now: $w"
WAIT=10 ./tools/devcmd.sh "etbr load $MAP" | grep -E "loaded|skip|still starting"
WAIT=4 ./tools/devcmd.sh "ue r.SetRes 1280x720w" "etbr start" "look -15 0" "$@" "state" | grep -E "started|state:|spawned"
s 'del C:\Users\JackPC\ETBRMapper\screen.png & schtasks /Run /TN ETBRShot >nul'
until s 'if exist C:\Users\JackPC\ETBRMapper\screen.png echo yes' | grep -q yes; do sleep 1; done; sleep 2
scp -q -i "$KEY" "$PC:ETBRMapper/screen.png" "$J/ingame.png" && echo "screenshot: $J/ingame.png"
s 'tasklist /fi "imagename eq CrashReportClient.exe" /nh' | grep -q CrashReport && echo "!!! GAME CRASHED" || echo "game alive"
# remove the throwaway save this run created (only GENSAVE files written in the last 8 minutes)
s 'powershell -NoProfile -Command "Get-ChildItem $env:LOCALAPPDATA\EscapeTheBackrooms\Saved\SaveGames -Filter MULTIPLAYER_GENSAVE*.sav | Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-8) } | Remove-Item -Verbose"' 2>&1 | grep -c Remove | sed 's/^/test saves removed: /'
