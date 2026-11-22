#!/usr/bin/env bash
# Verify a release manifest and every asset it lists.
# Usage: verify-release.sh RELEASE_JSON ASSETS_DIR [MINISIGN_PUBKEY...]
# With at least one public key the detached signature is mandatory. With no
# keys the hashes are still verified, so this script is usable during the
# checksum-only rollout and in tests that use an ephemeral key.
set -Eeuo pipefail
manifest=${1:?usage: verify-release.sh RELEASE_JSON ASSETS_DIR [PUBKEY...]}
assets_dir=${2:?usage: verify-release.sh RELEASE_JSON ASSETS_DIR [PUBKEY...]}
shift 2
[[ -s "$manifest" ]] || { echo "Missing release manifest: $manifest" >&2; exit 1; }
[[ -d "$assets_dir" ]] || { echo "Not a directory: $assets_dir" >&2; exit 1; }

keys=()
for key in "$@"; do [[ -n "$key" ]] && keys+=("$key"); done
if ((${#keys[@]})); then
  signature="$manifest.minisig"
  [[ -s "$signature" ]] || { echo 'Missing release signature.' >&2; exit 1; }
  command -v minisign >/dev/null 2>&1 || { echo 'minisign is required to verify this release.' >&2; exit 1; }
  trusted=0
  for key in "${keys[@]}"; do
    if minisign -V -q -P "$key" -m "$manifest" -x "$signature" >/dev/null 2>&1; then
      trusted=1
      break
    fi
  done
  ((trusted == 1)) || { echo 'The release signature does not match a trusted key.' >&2; exit 1; }
  echo 'PASS: release signature'
else
  echo 'NOTICE: no public key supplied; verifying asset hashes only.'
fi

python3 - "$manifest" "$assets_dir" <<'PY'
import hashlib
import json
import os
import sys

manifest, assets_dir = sys.argv[1:3]
with open(manifest, encoding='utf-8') as handle:
    data = json.load(handle)
assets = data.get('assets') or {}
if not isinstance(assets, dict) or not assets:
    raise SystemExit('The release manifest contains no assets.')
failed = False
for name, expected in sorted(assets.items()):
    path = os.path.join(assets_dir, name)
    if not os.path.isfile(path):
        print(f'FAIL: missing asset {name}', file=sys.stderr)
        failed = True
        continue
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        print(f'FAIL: checksum mismatch for {name}', file=sys.stderr)
        failed = True
    else:
        print(f'PASS: {name}')
if failed:
    raise SystemExit(1)
PY
