#!/bin/bash
# Shared connection helpers: use the home LAN address when reachable, else Tailscale.
KEY="$HOME/.ssh/tidepool_win"
if [ -z "${ETBR_PC:-}" ]; then
  if ssh -o ConnectTimeout=3 -o BatchMode=yes -i "$KEY" jackpc@192.168.1.34 'exit' >/dev/null 2>&1; then ETBR_PC=jackpc@192.168.1.34; else ETBR_PC=jackpc; fi
  export ETBR_PC
fi
PC="$ETBR_PC"
pcssh() { ssh -o ConnectTimeout=10 -i "$KEY" "$PC" "$@"; }
pcscp() { scp -q -i "$KEY" "$@"; }
