#!/bin/bash
# Send dev commands to the running game (needs dev.enable on the PC) and print new [ETBR] log lines.
#   tools/devcmd.sh "etbr load ETBRTest" "state"   [WAIT=seconds]
PC="${ETBR_PC:-jackpc@192.168.1.34}"; KEY="$HOME/.ssh/tidepool_win"
MODS='C:\Program Files (x86)\Steam\steamapps\common\EscapeTheBackrooms\EscapeTheBackrooms\Binaries\Win64\ue4ss'
tmp=$(mktemp); printf '%s\r\n' "$@" > "$tmp"
before=$(ssh -i "$KEY" "$PC" "powershell -NoProfile -Command \"(Get-Content -LiteralPath '$MODS\\UE4SS.log').Count\"" 2>/dev/null | tr -d '\r')
scp -q -i "$KEY" "$tmp" "$PC:ETBRMapper/devcmd.txt"; rm -f "$tmp"
ssh -i "$KEY" "$PC" "copy /y C:\\Users\\JackPC\\ETBRMapper\\devcmd.txt \"$MODS\\Mods\\ETBRLoader\\devcmd.txt\" >nul" 2>/dev/null
sleep "${WAIT:-4}"
ssh -i "$KEY" "$PC" "powershell -NoProfile -Command \"Get-Content -LiteralPath '$MODS\\UE4SS.log' | Select-Object -Skip $before | Select-String -Pattern 'ETBR|Error|error' | ForEach-Object { \$_.Line }\"" 2>/dev/null | LC_ALL=C cut -c30-260
