#!/bin/bash
# Get into Level 0 and print the kill function signatures.
cd "$(dirname "$0")/.."
./tools/ingame_test.sh ETBRSig NOMAP 2>&1 | grep -E "now:"
WAIT=4 ./tools/devcmd.sh "sig KillServer" "sig KillPlayer" "sig KillClient" >/dev/null
ssh jackpc 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\JackPC\ETBRMapper\tail.ps1 -n 20 -match "sig|   "' | LC_ALL=C cut -c30-200
