#!/usr/bin/env bash
set -euo pipefail

# Usage: scripts/publish-cli.sh [patch|minor|major|<version>]
# Bumps packages/cli, builds (bundles core inline), strips workspace dep, publishes.

BUMP="${1:-patch}"
shift || true   # consume bump arg so "$@" = remaining flags (e.g. --otp=…)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/packages/cli"

if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
  echo "error: working tree dirty — commit or stash first" >&2
  exit 1
fi

cd "$ROOT"
npm run build -w @plan-review/browser-app
npm run build -w @plan-review/core

cd "$CLI"
npm version "$BUMP"
npm run build

# Strip workspace-only dep before publish, restore after.
cp package.json package.json.bak
trap 'mv package.json.bak package.json' EXIT
npm pkg delete dependencies.@plan-review/core

npm publish "$@"   # forwards e.g. --otp=… --tag=…

trap - EXIT
mv package.json.bak package.json

cd "$ROOT"
git push --follow-tags
echo "published plan-review@$(node -p "require('$CLI/package.json').version")"
