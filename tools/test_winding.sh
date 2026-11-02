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
echo "--- prompt sign (w1)"; ./tools/snap.sh "$J/w1.png" >/dev/null
echo "--- pick up + use (w2)"; WAIT=3 ./tools/devcmd.sh "pickup" | grep -E "dev pickup|picked"
WAIT=1 ./tools/devcmd.sh "use" >/dev/null; ./tools/snap.sh "$J/w2.png" >/dev/null
echo "--- drop (w3)"; WAIT=2 ./tools/devcmd.sh "drop" | grep -E "dev drop"; ./tools/snap.sh "$J/w3.png" >/dev/null
echo "--- message zone (w4)"; WAIT=1 ./tools/devcmd.sh "tpto 0 500 200100" >/dev/null
./tools/snap.sh "$J/w4.png" | LC_ALL=C grep -E "Backrooms|CrashReport|tick error|custom:|crash dir"
