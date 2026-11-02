#!/bin/bash
# In-game test of the whole custom stack (map already copied as ETBRTest): performance, entity + kill, text, items, helper.
source "$(dirname "$0")/pcenv.sh"
cd "$(dirname "$0")/.."
J="$HOME/.claude/jobs/a3c39b51/tmp"
alive() { pcssh 'tasklist /fi "imagename eq Backrooms-Win64-Shipping.exe" /nh' | grep -q Backrooms && echo "  game running after $1" || echo "!!! GAME GONE after $1"; pcssh 'tasklist /fi "imagename eq CrashReportClient.exe" /nh' | grep -q CrashReport && echo "!!! CRASH REPORTER after $1"; }
shot() { pcssh 'del C:\Users\JackPC\ETBRMapper\screen.png & schtasks /Run /TN ETBRShot >nul' 2>/dev/null; until pcssh 'if exist C:\Users\JackPC\ETBRMapper\screen.png echo yes' 2>/dev/null | grep -q yes; do sleep 1; done; sleep 2; pcscp "$PC:ETBRMapper/screen.png" "$J/$1"; echo "  shot $1"; }
./tools/ingame_test.sh "${1:-ETBRCus}" NOMAP 2>&1 | grep -E "now:"
WAIT=7 ./tools/devcmd.sh "perf 5" | grep -E "perf:|tick error"; alive baseline
WAIT=6 ./tools/devcmd.sh "etbr load ETBRTest" | grep -E "loaded|skip|tick error"; alive load
WAIT=2 ./tools/devcmd.sh "etbr start" "look -15 0" "msgtest Hello from ETBR Mapper" | grep -E "started|msgtest done"; shot text.png; alive start
WAIT=7 ./tools/devcmd.sh "perf 5" "ents" | grep -E "perf:|ent |tick error"; alive perf
WAIT=3 ./tools/devcmd.sh "pickup" | grep -E "dev pickup|picked"; WAIT=2 ./tools/devcmd.sh "use" >/dev/null; shot custom.png; alive items
WAIT=12 ./tools/devcmd.sh "ents" | grep -E "ent |killed|kill:"; shot kill.png; alive kill
pcssh 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\JackPC\ETBRMapper\tail.ps1 -n 6 -match "killed|kill:|tick error|sound"' | LC_ALL=C cut -c30-180
pcscp tools/pc/helpercheck.ps1 "$PC:ETBRMapper/helpercheck.ps1"; pcssh 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\JackPC\ETBRMapper\helpercheck.ps1' 2>/dev/null | cut -c1-200
