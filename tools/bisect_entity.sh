#!/bin/bash
# Bisect which entity feature crashes the game: build with all off, then enable one at a time.
cd "$(dirname "$0")/.."
./tools/ingame_test.sh ETBRBis NOMAP 2>&1 | grep -E "now:|alive"
WAIT=2 ./tools/devcmd.sh "entdbg move off" "entdbg anim off" "entdbg vel off" "entdbg speed off" >/dev/null
WAIT=8 ./tools/devcmd.sh "etbr load ETBRTest" | grep loaded
WAIT=6 ./tools/devcmd.sh "etbr start" "ents" | grep -E "started|ent "
for f in speed vel move anim; do
  WAIT=6 ./tools/devcmd.sh "entdbg $f on" "ents" | grep -E "entdbg|ent "
  if ssh jackpc 'tasklist /fi "imagename eq Backrooms-Win64-Shipping.exe" /nh' | grep -q Backrooms; then echo "  alive after $f"; else echo "  DEAD after $f"; break; fi
done
