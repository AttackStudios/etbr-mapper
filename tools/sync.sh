#!/bin/bash
# Push one or more project folders to jackpc:C:\Users\JackPC\ETBRMapper\<folder>
#   tools/sync.sh extractor editor ...
set -e
cd "$(dirname "$0")/.."
source "$(dirname "$0")/pcenv.sh"
for d in "$@"; do
  tar --no-xattrs -czf "/tmp/etbr_sync_$d.tgz" --exclude node_modules --exclude bin --exclude obj --exclude dist "$d"
  scp -q -i "$KEY" "/tmp/etbr_sync_$d.tgz" "$PC:ETBRMapper/_sync_$d.tgz"
  ssh -i "$KEY" "$PC" "cd /d C:\\Users\\JackPC\\ETBRMapper && tar -xzf _sync_$d.tgz && del _sync_$d.tgz"
  rm -f "/tmp/etbr_sync_$d.tgz"
  echo "synced $d"
done
