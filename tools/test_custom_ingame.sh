#!/bin/bash
# In-game test of text, custom entity and custom item (map already copied as ETBRTest).
cd "$(dirname "$0")/.."
alive() { ssh jackpc 'tasklist /fi "imagename eq CrashReportClient.exe" /nh' | grep -q CrashReport && echo "!!! CRASHED after $1" || echo "  ok after $1"; }
shot() { ssh jackpc 'del C:\Users\JackPC\ETBRMapper\screen.png & schtasks /Run /TN ETBRShot >nul'; until ssh jackpc 'if exist C:\Users\JackPC\ETBRMapper\screen.png echo yes' 2>/dev/null | grep -q yes; do sleep 1; done; sleep 2; scp -q jackpc:ETBRMapper/screen.png "$HOME/.claude/jobs/a3c39b51/tmp/$1"; echo "  shot $1"; }
./tools/ingame_test.sh "${1:-ETBRCus}" NOMAP 2>&1 | grep -E "now:"
true
WAIT=8 ./tools/devcmd.sh "etbr load ETBRTest" | grep -E "loaded|skip"
WAIT=5 ./tools/devcmd.sh "etbr start" "look -15 0" "ents" | grep -E "ent |ents:"; alive load
WAIT=1 ./tools/devcmd.sh "msgtest Hello from ETBR Mapper" | grep -E "msgtest"; shot text.png; alive msgtest
WAIT=3 ./tools/devcmd.sh "sig KillServer" "sig KillPlayer" "sig KillClient" | grep -E "sig|   "
WAIT=5 ./tools/devcmd.sh "ents" | grep -E "ent "
WAIT=5 ./tools/devcmd.sh "pickup" | grep -E "pickup|picked"; alive pickup
WAIT=4 ./tools/devcmd.sh "use" | grep -E "use"; alive use; shot custom.png
WAIT=4 ./tools/devcmd.sh "ents" | grep -E "ent "
