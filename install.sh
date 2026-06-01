#!/usr/bin/env bash
set -euo pipefail

GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BOLD="\033[1m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}🦙 tallow-ollama-cloud-extension installer${RESET}"
echo ""

# Determine install target
if [ -n "${1:-}" ]; then
    TARGET="$1/extensions/ollama-cloud"
    echo -e "→ Installing into project: ${YELLOW}$1${RESET}"
else
    TARGET="${HOME}/.tallow/extensions/ollama-cloud"
    echo -e "→ Installing globally into: ${YELLOW}${TARGET}${RESET}"
fi

mkdir -p "$TARGET"

# Detect where the extension files are (repo checkout vs downloaded tarball)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="${SCRIPT_DIR}/extensions/ollama-cloud"
if [ -d "$EXT_DIR" ]; then
    cp "$EXT_DIR/extension.json" "$EXT_DIR/index.ts" "$TARGET/"
else
    echo "❌ Could not find extension files at $EXT_DIR"
    exit 1
fi

echo ""
echo -e "${GREEN}✓${RESET} Extension installed to: ${TARGET}"
echo ""
echo -e "  ${BOLD}Next steps:${RESET}"
echo "  1. Start tallow:  tallow"
echo "  2. Login:         /login ollama-cloud"
echo "     → Get your key at https://ollama.com/settings/keys"
echo "  3. Pick a model:  /model"
echo "     → Select any ollama-cloud/... model"
echo "  4. Refresh models: /ollama-refresh  (whenever you want the latest list)"
echo ""
