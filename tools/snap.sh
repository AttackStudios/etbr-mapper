#!/bin/bash
# Screenshot jackpc + report game state, latest loader log lines and newest crash: tools/snap.sh <out.png>
source "$(dirname "$0")/pcenv.sh"
cd "$(dirname "$0")/.."
OUT="${1:-$HOME/.claude/jobs/a3c39b51/tmp/snap.png}"
pcssh 'del C:\Users\JackPC\ETBRMapper\screen.png & schtasks /Run /TN ETBRShot >nul' >/dev/null 2>&1
for i in 1 2 3 4 5 6 7 8; do pcssh 'if exist C:\Users\JackPC\ETBRMapper\screen.png echo yes' 2>/dev/null | grep -q yes && break; sleep 1; done
sleep 1; pcscp "$PC:ETBRMapper/screen.png" "$OUT"
pcssh 'tasklist /fi "imagename eq Backrooms-Win64-Shipping.exe" /nh & tasklist /fi "imagename eq CrashReportClient.exe" /nh' 2>/dev/null | LC_ALL=C grep -E "Backrooms|CrashReport" | LC_ALL=C cut -c1-40
pcssh 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\JackPC\ETBRMapper\tail.ps1 -n 10 -match "ETBR"' 2>/dev/null | LC_ALL=C cut -c30-200
pcssh 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\JackPC\ETBRMapper\crashlog.ps1' 2>/dev/null | LC_ALL=C grep -E "crash dir|ErrorMessage" | LC_ALL=C cut -c1-170
date +%H:%M
