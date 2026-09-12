#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is required but was not found in PATH." >&2
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is required but was not found in PATH." >&2
    exit 1
fi

echo "Installing dependencies from package-lock.json..."
npm ci

echo "Testing, compiling, and packaging the Xenon VS Code extension..."
npm run package

echo
echo "Build completed. The VSIX package is in:"
for package in "$SCRIPT_DIR"/xenon-*.vsix; do
    if [ -f "$package" ]; then
        printf '  %s\n' "$package"
    fi
done
