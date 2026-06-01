#!/usr/bin/env bash
# Install the clv-broker-company skill into .claude/skills/ so Claude Code picks it up.
# Run from anywhere: `bash skills/clv-broker-company/install.sh`
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SRC_DIR/../.." && pwd)"
DEST_DIR="$REPO_ROOT/.claude/skills/clv-broker-company"

mkdir -p "$DEST_DIR"
cp "$SRC_DIR/SKILL.md" "$DEST_DIR/SKILL.md"
cp -r "$SRC_DIR/scripts" "$DEST_DIR/scripts"

echo "Installed clv-broker-company → $DEST_DIR"
echo "Restart Claude Code (or start a new session) to activate the skill."
