#!/usr/bin/env bash
# ============================================================
# Budget Planner — interactive installer (server .deb)
#
# Public repository: no authentication needed.
#   curl -fsSL https://raw.githubusercontent.com/HamidrezaTg/budget-planner/main/scripts/install.sh -o /tmp/bp-install.sh && bash /tmp/bp-install.sh
#
# Flags: --client (desktop client), --version X, --quiet (skip menu, defaults)
# ============================================================
set -euo pipefail

REPO="HamidrezaTg/budget-planner"
WANT_CLIENT=0
WANT_VERSION=""
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --client) WANT_CLIENT=1 ;;
    --quiet) QUIET=1 ;;
    --version) WANT_VERSION="$2"; shift ;;
    --version=*) WANT_VERSION="${1#*=}" ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

# if we are the buffered temp copy, remove it (safe: already loaded)
case "${0:-}" in /tmp/budget-planner-install.sh) rm -f "$0" ;; esac

# ---- release fetch: anonymous first, token only if the repo needs it ----
fetch_release() {
  local url="https://api.github.com/repos/$REPO/releases/latest"
  [ -n "$WANT_VERSION" ] && url="https://api.github.com/repos/$REPO/releases/tags/v$WANT_VERSION"
  if [ -n "${GH_TOKEN:-}" ]; then
    curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$url" 2>/dev/null
  else
    curl -fsSL -H "Accept: application/vnd.github+json" "$url" 2>/dev/null
  fi
}

acquire_token() {
  if [ -z "${GH_TOKEN:-}" ]; then
    if command -v gh >/dev/null 2>&1 && gh auth token >/dev/null 2>&1; then
      GH_TOKEN=$(gh auth token)
    else
      echo "The repository is not publicly reachable — authenticate with 'gh auth login'"
      echo "or provide a fine-grained token (Contents: read-only)."
      read -rsp "GitHub token: " GH_TOKEN
      echo
    fi
  fi
}

echo "==> fetching release info"
RELEASE_JSON=$(fetch_release || true)
if [ -z "$RELEASE_JSON" ]; then
  acquire_token
  RELEASE_JSON=$(fetch_release) || { echo "ERROR: could not fetch releases even with authentication." >&2; exit 1; }
fi

if [ "$(id -u)" -ne 0 ] && [ "${INSTALLER_NO_SUDO:-}" != "1" ]; then
  echo "==> re-running with sudo (your GitHub login travels along)"
  SELF="$0"
  if [ ! -f "$SELF" ]; then
    SELF="/tmp/budget-planner-install.sh"
    curl -fsSL "https://raw.githubusercontent.com/$REPO/main/scripts/install.sh?v=$(date +%s)" -o "$SELF"
  fi
  # Rebuild the command-line flags: the argument loop above consumed $@, so a
  # bare "$@" here would silently drop --client/--version/--quiet.
  REEXEC_ARGS=()
  [ "$WANT_CLIENT" = "1" ] && REEXEC_ARGS+=(--client)
  [ "$QUIET" = "1" ] && REEXEC_ARGS+=(--quiet)
  [ -n "$WANT_VERSION" ] && REEXEC_ARGS+=(--version "$WANT_VERSION")
  exec sudo -E GH_TOKEN="${GH_TOKEN:-}" bash "$SELF" "${REEXEC_ARGS[@]}"
fi

# Parse the release JSON with grep/sed only — no Node required, so the script
# still works on machines that have not installed Node yet (Node is only a
# server dependency, never needed for the desktop client).
TAG=$(printf '%s' "$RELEASE_JSON" | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
[ -n "$TAG" ] || { echo "ERROR: release not found." >&2; exit 1; }
echo "==> release: $TAG"

if [ "$WANT_CLIENT" = "1" ]; then
  [ "$(dpkg --print-architecture)" = "amd64" ] || { echo "ERROR: the desktop client is amd64-only." >&2; exit 1; }
  PATTERN="budget-planner-client_.*_amd64\.deb"
else
  PATTERN="budget-planner_[0-9.]*_all\.deb"
fi

ASSET_NAME=$(printf '%s' "$RELEASE_JSON" | grep -oE '"name"[[:space:]]*:[[:space:]]*"'"$PATTERN"'"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
[ -n "$ASSET_NAME" ] || { echo "ERROR: no matching .deb asset in release $TAG." >&2; exit 1; }
echo "==> asset: $ASSET_NAME"

# ---- Node.js >= 22 is mandatory for the server --------------------------
if [ "$WANT_CLIENT" != "1" ]; then
  NODE_OK=0
  if command -v node >/dev/null 2>&1; then
    MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
    [ "$MAJOR" -ge 22 ] && NODE_OK=1
  fi
  if [ "$NODE_OK" != "1" ]; then
    CURRENT="$(command -v node >/dev/null 2>&1 && node -v || echo 'not installed')"
    echo
    echo "  Node.js >= 22 is REQUIRED (the server uses the built-in node:sqlite)."
    echo "  Found: $CURRENT — the service will not start with an older Node."
    echo
    if [ "$QUIET" = "1" ]; then
      echo "==> --quiet: installing Node 22 via NodeSource automatically"
      yn=y
    else
      read -rp "  Install Node 22 via NodeSource now? [Y/n] " yn
      yn="${yn:-y}"
    fi
    case "$yn" in
      y|Y)
        curl -fsSL "https://deb.nodesource.com/setup_22.x" | bash - > /dev/null
        apt-get install -y nodejs > /dev/null
        echo "  $(node -v) installed."
        ;;
      *)
        echo "  Aborting — install Node 22 manually, then re-run this installer." >&2
        exit 1
        ;;
    esac
  fi
fi

# ---- interactive configuration (skipped with --quiet or when piped) -----
DEFAULTS_FILE="${BP_DEFAULTS_FILE:-/etc/default/budget-planner}"
PORT=2026
BIND_IP=""
ADMIN_NAME=""
ADMIN_PW=""

# sudo does not always keep a tty; remember interactivity from the caller
if [ -t 0 ]; then export BP_WANT_MENU=1; fi

if [ "$WANT_CLIENT" != "1" ] && [ "$QUIET" != "1" ] && { [ -t 0 ] || [ "${BP_WANT_MENU:-}" = "1" ]; }; then
  RECONFIGURE=""
  if [ -f "$DEFAULTS_FILE" ] && grep -q '^PORT=' "$DEFAULTS_FILE" 2>/dev/null; then
    read -rp "Existing configuration found. Reconfigure? [y/N] " reconf
    RECONFIGURE="$reconf"
  fi
  if [ ! -f "$DEFAULTS_FILE" ] || [ "${RECONFIGURE:-n}" = "y" ] || [ "${RECONFIGURE:-n}" = "Y" ]; then
    EXISTING_TS=""
    command -v tailscale >/dev/null 2>&1 && EXISTING_TS=$(tailscale ip -4 -1 2>/dev/null || true)

    echo
    echo "  Where will you use Budget Planner from?"
    echo "   1) Everywhere — LAN and Tailscale (recommended)"
    echo "   2) This machine only (localhost)"
    [ -n "$EXISTING_TS" ] && echo "   3) Tailscale devices only"
    read -rp "  Choice [1]: " choice
    choice="${choice:-1}"
    case "$choice" in
      2) BIND_IP="127.0.0.1" ;;
      3) if [ -n "$EXISTING_TS" ]; then BIND_IP="$EXISTING_TS"; else BIND_IP="0.0.0.0"; fi ;;
      *) BIND_IP="0.0.0.0" ;;
    esac

    read -rp "  Port [2026]: " port_in
    PORT="${port_in:-2026}"
    case "$PORT" in ''|*[!0-9]*) PORT=2026 ;; esac
    [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || PORT=2026

    echo
    read -rp "  Create the first admin account now? [Y/n] " mkadmin
    if [ "${mkadmin:-y}" != "n" ] && [ "${mkadmin:-y}" != "N" ]; then
      while true; do
        read -rp "  Admin username (letters/numbers, 2-32 chars): " ADMIN_NAME
        ADMIN_NAME=$(echo "$ADMIN_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_.-')
        [ "${#ADMIN_NAME}" -ge 2 ] && break
        echo "  Username must be at least 2 valid characters."
      done
      while [ -z "$ADMIN_PW" ]; do
        read -rsp "  Admin password (min 8 chars): " ADMIN_PW; echo
        [ "${#ADMIN_PW}" -ge 8 ] || { echo "  Too short."; ADMIN_PW=""; }
      done
    fi
  fi
fi

# ---- download + install -------------------------------------------------
OUT="/tmp/$ASSET_NAME"
echo "==> downloading $ASSET_NAME"
DL_URL="https://github.com/$REPO/releases/download/$TAG/$ASSET_NAME"
if [ -n "${GH_TOKEN:-}" ]; then
  curl -fSL -H "Authorization: Bearer $GH_TOKEN" -o "$OUT" "$DL_URL"
else
  curl -fSL -o "$OUT" "$DL_URL"
fi
[ "$(stat -c%s "$OUT")" -gt 10000 ] || { echo "ERROR: download too small — asset problem." >&2; exit 1; }

echo "==> installing $ASSET_NAME"
apt-get install -y "$OUT"
rm -f "$OUT"

if [ "$WANT_CLIENT" = "1" ]; then
  echo
  echo "============================================================="
  echo " Desktop client installed — find 'Budget Planner' in your"
  echo " application menu and enter your server address on first launch."
  echo "============================================================="
  exit 0
fi

# ---- write chosen configuration ----------------------------------------
if [ -n "$BIND_IP" ] || [ "$PORT" != "2026" ]; then
  {
    echo "PORT=$PORT"
    [ -n "$BIND_IP" ] && echo "BIND_IP=$BIND_IP"
  } > "$DEFAULTS_FILE"
  systemctl restart budget-planner
fi

# ---- optional admin creation -------------------------------------------
if [ -n "$ADMIN_NAME" ] && [ -n "$ADMIN_PW" ]; then
  echo "==> creating admin account"
  if sudo -u budget env DATA_DIR=/var/lib/budget-planner \
      BP_USER="$ADMIN_NAME" BP_PW="$ADMIN_PW" \
      node /opt/budget-planner/server/cli-add-user.mjs; then
    ADMIN_DONE=yes
  else
    echo "  (Could not create the account here — create it in the browser instead.)"
  fi
fi

# ---- verify + summary ---------------------------------------------------
sleep 1
if systemctl is-active --quiet budget-planner; then
  STATE="running"
else
  STATE="NOT RUNNING — check: journalctl -u budget-planner -n 30"
fi

LAN_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
TS_IP=""
command -v tailscale >/dev/null 2>&1 && TS_IP=$(tailscale ip -4 -1 2>/dev/null || true)

echo
echo "============================================================="
echo " Budget Planner server: $STATE"
echo "   Data dir: /var/lib/budget-planner   (SQLite — back it up!)"
[ "$STATE" = "running" ] || { echo "============================================================="; exit 0; }
echo
[ -n "${ADMIN_DONE:-}" ] && echo "   Admin account: $ADMIN_NAME (log in with it right away)" \
                     || echo "   First step: open the URL below and create your account"
echo "   This machine:  http://localhost:$PORT"
[ -n "$LAN_IP" ] && [ "$BIND_IP" != "127.0.0.1" ] && echo "   Home network:  http://$LAN_IP:$PORT"
[ -n "$TS_IP" ] && [ "$BIND_IP" != "127.0.0.1" ] && echo "   Tailscale:     http://$TS_IP:$PORT"
echo
echo "   Backup: copy /var/lib/budget-planner (or Settings -> Backup)"
echo "============================================================="
