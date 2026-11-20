#!/usr/bin/env bash
# Non-destructive, developer/CI source verification. Does not require sudo.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
echo '=== YRM Panel: source and contract verification ==='
python3 - <<'PY'
import ast
from pathlib import Path
for file in Path('scripts').glob('*.py'):
    ast.parse(file.read_text(encoding='utf-8'), filename=str(file))
print('PASS: Python helper syntax')
PY
for file in scripts/*.sh; do bash -n "$file"; done
echo 'PASS: Bash syntax'
for pattern in 'test_beta*.py' 'test_release.py' 'test_ui_contracts.py' 'test_taskbar_contracts.py'; do
  PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p "$pattern"
done
if command -v node >/dev/null 2>&1; then
  while IFS= read -r -d '' file; do node --check "$file"; done < <(find YrmPanel/wwwroot/js -name '*.js' -type f -print0)
  echo 'PASS: JavaScript syntax'
else echo 'SKIP: JavaScript syntax (Node.js not installed)'; fi
if command -v dotnet >/dev/null 2>&1; then
  dotnet build YrmPanel/YrmPanel.csproj -c Release
  if [[ "$(uname -s)" == Linux ]]; then
    dotnet run --project tests/FileCopySmoke/FileCopySmoke.csproj -c Release
  fi
else echo 'SKIP: .NET compile and File Copy smoke (SDK missing)'; fi
echo 'Source verification finished. Host integration and UI appearance are separate.'
