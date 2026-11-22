#!/usr/bin/env bash
# Build release.json from the tarballs in a directory.
# Usage: release-manifest.sh ASSETS_DIR CHANNEL VERSION COMMIT BUILT_AT
set -Eeuo pipefail
assets_dir=${1:?usage: release-manifest.sh ASSETS_DIR CHANNEL VERSION COMMIT BUILT_AT}
channel=${2:?channel is required}
version=${3:?version is required}
commit=${4:-unknown}
built_at=${5:-$(date -u +%FT%TZ)}
[[ -d "$assets_dir" ]] || { echo "Not a directory: $assets_dir" >&2; exit 2; }
python3 - "$assets_dir" "$channel" "$version" "$commit" "$built_at" <<'PY'
import hashlib
import json
import os
import sys

assets_dir, channel, version, commit, built_at = sys.argv[1:6]
assets = {}
for name in sorted(os.listdir(assets_dir)):
    if not name.endswith('.tar.gz'):
        continue
    digest = hashlib.sha256()
    with open(os.path.join(assets_dir, name), 'rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    assets[name] = digest.hexdigest()
if not assets:
    raise SystemExit('No .tar.gz assets found in ' + assets_dir)
manifest = {
    'channel': channel,
    'version': version,
    'commit': commit,
    'builtAt': built_at,
    'assets': assets,
}
target = os.path.join(assets_dir, 'release.json')
with open(target, 'w', encoding='utf-8', newline='\n') as handle:
    json.dump(manifest, handle, indent=2, sort_keys=True)
    handle.write('\n')
print(target)
PY
