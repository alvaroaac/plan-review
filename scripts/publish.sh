#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
echo "Publishing plan-review v${VERSION}"
echo ""

# 1. Tests
echo "==> Running tests..."
npm test
echo ""

# 2. Typecheck
echo "==> Typechecking..."
npx tsc --noEmit
npx tsc --project tsconfig.browser.json --noEmit
echo ""

# 3. Build
echo "==> Building..."
npm run build
echo ""

# 4. Dry run
echo "==> Dry run (check contents)..."
npm publish --dry-run
echo ""

read -p "Publish v${VERSION} to npm? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# 5. Git tag
git tag -a "v${VERSION}" -m "v${VERSION}"
git push origin "v${VERSION}"

# 6. Publish
npm publish

echo ""
echo "Published plan-review@${VERSION}"
echo "Install: npm install -g plan-review"
