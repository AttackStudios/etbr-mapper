#!/bin/bash
# Baseline: start a fresh Level 0 game and screenshot WITHOUT touching anything (no load/teleport/look).
set -u
SAVE="${1:-ETBRBase}"
PC="${ETBR_PC:-jackpc}"; KEY="$HOME/.ssh/tidepool_win"; J="$HOME/.claude/jobs/a3c39b51/tmp"
cd "$(dirname "$0")/.."
s() { ssh -i "$KEY" "$PC" "$@" 2>/dev/null; }
state_world() { WAIT=3 ./tools/devcmd.sh "state" 2>/dev/null | grep -o "world=World [^ ]*" | tail -1; }
shot() { s 'del C:\Users\JackPC\ETBRMapper\screen.png & schtasks /Run /TN ETBRShot >nul'; until s 'if exist C:\Users\JackPC\ETBRMapper\screen.png echo yes' | grep -q yes; do sleep 1; done; sleep 2; scp -q -i "$KEY" "$PC:ETBRMapper/screen.png" "$J/$1"; echo "shot $1"; }
s 'taskkill /f /im CrashReportClient.exe >nul 2>&1 & taskkill /f /im Backrooms-Win64-Shipping.exe >nul 2>&1'
s 'schtasks /Run /TN ETBRGameRun' >/dev/null
for i in $(seq 1 25); do state_world | grep -q MainMenu && break; sleep 5; done; echo "menu ok"
WAIT=2 ./tools/devcmd.sh "ue open Lobby" >/dev/null
for i in $(seq 1 15); do state_world | grep -q Lobby.Lobby && break; sleep 4; done; echo "lobby ok"
printf 'click 1106 520\nwait 300\ntype %s\nkey {ENTER}\nwait 400\nclick 1106 744\n' "$SAVE" > "$J/click.txt"
scp -q -i "$KEY" "$J/click.txt" "$PC:ETBRMapper/click.txt"; s 'schtasks /Run /TN ETBRClick' >/dev/null
for i in $(seq 1 30); do w=$(state_world); echo "$w" | grep -q "Level0.Level0" && break; sleep 5; done; echo "now: $w"
sleep 5; shot base_5s.png
sleep 25; shot base_30s.png
