#!/bin/sh
# Install dsh-attention-notify as a DSH skill and (unless SKIP_PLUGIN=1) a plugin.
#
#   sh install.sh
#
# Environment:
#   DSH_HOME      DSH home (default: $HOME/.dsh)
#   DSH_PROFILE   profile that receives the plugin (default: desktop)
#   REPO          repository to clone
#   SKIP_PLUGIN   set to 1 to install only the skill
#
# The always-on-top card is a Windows feature; on macOS and Linux the plugin
# still loads and falls back to OS notifications plus the in-app card.
set -eu

REPO="${REPO:-https://github.com/Misaki-asahi/dsh-attention-notify.git}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
DSH_PROFILE="${DSH_PROFILE:-desktop}"
NAME="dsh-attention-notify"
TARGET="$DSH_HOME/skills/$NAME"

command -v git >/dev/null 2>&1 || { echo "git is required to install this skill." >&2; exit 1; }

echo "skill directory: $TARGET"
if [ -d "$TARGET/.git" ]; then
  echo "existing checkout: fast-forwarding"
  git -C "$TARGET" pull --ff-only
elif [ -e "$TARGET" ]; then
  echo "$TARGET already exists and is not a git checkout. Move it away first, then rerun." >&2
  exit 1
else
  mkdir -p "$DSH_HOME/skills"
  git clone --depth 1 "$REPO" "$TARGET"
fi

if [ "${SKIP_PLUGIN:-0}" = "1" ]; then
  echo "plugin step skipped (SKIP_PLUGIN=1)"
elif command -v dsh >/dev/null 2>&1; then
  echo "installing the plugin into profile '$DSH_PROFILE'"
  dsh plugin --profile "$DSH_PROFILE" add "$TARGET"
else
  echo "dsh is not on PATH; run: dsh plugin --profile $DSH_PROFILE add \"$TARGET\""
fi

cat <<EOF

Next: reload the host half once (the client half hot-reloads by itself):
  plugin_manager action=set_bundle target=$NAME enabled=false
  plugin_manager action=set_bundle target=$NAME enabled=true
or restart DSH.

Verify:
  node "$TARGET/tests/render.test.mjs"

Note: the always-on-top card is Windows-only; elsewhere the plugin falls back
to OS notifications plus the in-app card.
EOF
