#!/usr/bin/env bash
set -euo pipefail

# Build all packages in dependency order:
#   core → browser-app → cli → vscode-extension

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

packages=(
  "@plan-review/core"
  "@plan-review/browser-app"
  "plan-review"
  "plan-review-vscode"
)

for pkg in "${packages[@]}"; do
  echo "── building $pkg"
  npm run build -w "$pkg"
done

echo "── all packages built"
