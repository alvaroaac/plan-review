#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/publish-vscode.sh [patch|minor|major|<version>]
# Bumps packages/vscode-extension, builds, packages, publishes via vsce.

BUMP="${1:-patch}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/packages/vscode-extension"

if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "error: working tree dirty — commit or stash first" >&2
  exit 1
fi

cd "$ROOT"
npm run build -w @plan-review/core
npm run build -w @plan-review/browser-app

cd "$EXT"
npm version "$BUMP"
npm run build
npx vsce publish --no-dependencies

cd "$ROOT"
git push --follow-tags
echo "published plan-review-vscode@$(node -p "require('$EXT/package.json').version")"
