#!/bin/bash
# In-game: winding, 3D text, message zone, item pick-up + use.
source "$(dirname "$0")/pcenv.sh"
cd "$(dirname "$0")/.."
J="$HOME/.claude/jobs/a3c39b51/tmp"
python3 tools/make_winding_test.py "$J/testcube01.json" "$J/Winding.etbrmap"
pcscp "$J/Winding.etbrmap" "$PC:ETBRMapper/ETBRTest.etbrmap"
./tools/ingame_test.sh "${1:-ETBRWind}" NOMAP 2>&1 | grep -E "now:"
WAIT=4 ./tools/devcmd.sh "etbr load ETBRTest" | grep -E "loaded|skip|tick error"
WAIT=2 ./tools/devcmd.sh "etbr start" "look -5 0" | grep -E "started"
./tools/snap.sh "$J/w1.png" >/dev/null
WAIT=3 ./tools/devcmd.sh "pickup" | grep -E "dev pickup|picked"
WAIT=1 ./tools/devcmd.sh "use" >/dev/null
./tools/snap.sh "$J/w2.png" | LC_ALL=C grep -E "Backrooms|CrashReport|tick error|custom:"
