#!/usr/bin/env bash
# ============================================================
# Budget Planner — interactive installer (server .deb)
#
# Public repository: no authentication needed.
#   bash <(curl -fsSL https://github.com/HamidrezaTg/budget-planner/releases/latest/download/budget-planner-install.sh)
#
# Flags: --client (desktop client), --version X, --quiet (skip menu, defaults),
#        --ocr none|pdf|full, --data-dir /absolute/path,
#        --restore-server-data /path/to/server-data
# ============================================================
set -euo pipefail

REPO="HamidrezaTg/budget-planner"
WANT_CLIENT=0
WANT_VERSION=""
QUIET=0
OCR_MODE=""
DATA_DIR="/var/lib/budget-planner"
DATA_DIR_SET=0
RESTORE_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --client) WANT_CLIENT=1 ;;
    --quiet) QUIET=1 ;;
    --version) [ $# -ge 2 ] || { echo "ERROR: --version requires a value" >&2; exit 1; }; WANT_VERSION="$2"; shift ;;
    --version=*) WANT_VERSION="${1#*=}" ;;
    --ocr) [ $# -ge 2 ] || { echo "ERROR: --ocr requires none, pdf, or full" >&2; exit 1; }; OCR_MODE="$2"; shift ;;
    --ocr=*) OCR_MODE="${1#*=}" ;;
    --data-dir) [ $# -ge 2 ] || { echo "ERROR: --data-dir requires an absolute path" >&2; exit 1; }; DATA_DIR="$2"; DATA_DIR_SET=1; shift ;;
    --data-dir=*) DATA_DIR="${1#*=}"; DATA_DIR_SET=1 ;;
    --restore-server-data) [ $# -ge 2 ] || { echo "ERROR: --restore-server-data requires a directory" >&2; exit 1; }; RESTORE_DIR="$2"; shift ;;
    --restore-server-data=*) RESTORE_DIR="${1#*=}" ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

case "$OCR_MODE" in ''|none|pdf|full) ;; *) echo "ERROR: --ocr must be none, pdf, or full" >&2; exit 1 ;; esac
case "$DATA_DIR" in /*) ;; *) echo "ERROR: --data-dir must be an absolute path" >&2; exit 1 ;; esac
[ -z "$RESTORE_DIR" ] || case "$RESTORE_DIR" in /*) ;; *) echo "ERROR: --restore-server-data must be an absolute path" >&2; exit 1 ;; esac

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

# Resolve the tag before privilege escalation. Process substitution gives bash
# a /dev/fd path, which root cannot reliably reopen after sudo. The tag lets us
# cache the exact release installer instead of falling back to mutable main.
TAG=$(printf '%s' "$RELEASE_JSON" | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
[ -n "$TAG" ] || { echo "ERROR: release not found." >&2; exit 1; }

if [ "$(id -u)" -ne 0 ] && [ "${INSTALLER_NO_SUDO:-}" != "1" ]; then
  echo "==> re-running with sudo (your GitHub login travels along)"
  SELF="$0"
  SELF_IS_STREAM=0
  case "$SELF" in
    /dev/fd/*|/proc/*/fd/*) SELF_IS_STREAM=1 ;;
  esac
  if [ "$SELF_IS_STREAM" = "1" ] || [ ! -f "$SELF" ]; then
    SAFE_TAG=${TAG//[^A-Za-z0-9._-]/_}
    SELF="/tmp/budget-planner-install-${SAFE_TAG}.sh"
    echo "==> caching the exact ${TAG} installer for sudo"
    if [ -n "${GH_TOKEN:-}" ]; then
      curl -fsSL -H "Authorization: Bearer $GH_TOKEN" \
        -o "$SELF" "https://github.com/$REPO/releases/download/$TAG/budget-planner-install.sh"
    else
      curl -fsSL -o "$SELF" \
        "https://github.com/$REPO/releases/download/$TAG/budget-planner-install.sh"
    fi
    chmod 700 "$SELF"
  fi
  # Rebuild the command-line flags: the argument loop above consumed $@, so a
  # bare "$@" here would silently drop --client/--version/--quiet.
  REEXEC_ARGS=()
  [ "$WANT_CLIENT" = "1" ] && REEXEC_ARGS+=(--client)
  [ "$QUIET" = "1" ] && REEXEC_ARGS+=(--quiet)
  [ -n "$WANT_VERSION" ] && REEXEC_ARGS+=(--version "$WANT_VERSION")
  [ -n "$OCR_MODE" ] && REEXEC_ARGS+=(--ocr "$OCR_MODE")
  [ "$DATA_DIR" != "/var/lib/budget-planner" ] && REEXEC_ARGS+=(--data-dir "$DATA_DIR")
  [ -n "$RESTORE_DIR" ] && REEXEC_ARGS+=(--restore-server-data "$RESTORE_DIR")
  exec sudo -E GH_TOKEN="${GH_TOKEN:-}" bash "$SELF" "${REEXEC_ARGS[@]}"
fi

echo "==> release: $TAG"

if [ "$WANT_CLIENT" = "1" ]; then
  [ "$(dpkg --print-architecture)" = "amd64" ] || { echo "ERROR: the desktop client is amd64-only." >&2; exit 1; }
  PATTERN="budget-planner-client_.*_amd64\.deb"
else
  PATTERN="budget-planner-server_[0-9.]*_all\.deb"
fi

ASSET_NAME=$(printf '%s' "$RELEASE_JSON" | grep -oE '"name"[[:space:]]*:[[:space:]]*"'"$PATTERN"'"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
[ -n "$ASSET_NAME" ] || [ "$WANT_CLIENT" = "1" ] || {
  # Keep old releases installable while all new releases use the explicit
  # server name. The exact asset is still verified against its release checksum.
  PATTERN="budget-planner_[0-9.]*_all\.deb"
  ASSET_NAME=$(printf '%s' "$RELEASE_JSON" | grep -oE '"name"[[:space:]]*:[[:space:]]*"'"$PATTERN"'"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')
}
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
[ -n "$OCR_MODE" ] || OCR_MODE="full"

if [ -f "$DEFAULTS_FILE" ]; then
  configured_port=$(grep -E '^PORT=' "$DEFAULTS_FILE" | tail -1 | cut -d= -f2- || true)
  case "${configured_port:-}" in ''|*[!0-9]*) ;; *) PORT="$configured_port" ;; esac
  configured_bind=$(grep -E '^BIND_IP=' "$DEFAULTS_FILE" | tail -1 | cut -d= -f2- || true)
  [ -n "${configured_bind:-}" ] && BIND_IP="$configured_bind"
  configured_data_dir=$(grep -E '^DATA_DIR=' "$DEFAULTS_FILE" | tail -1 | cut -d= -f2- || true)
  case "${configured_data_dir:-}" in /*) [ "$DATA_DIR_SET" = "0" ] && DATA_DIR="$configured_data_dir" ;; esac
fi

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

    read -rp "  Data directory [$DATA_DIR]: " data_dir_in
    DATA_DIR="${data_dir_in:-$DATA_DIR}"
    case "$DATA_DIR" in
      /*) ;;
      *) echo "  Data directory must be absolute; keeping $DATA_DIR"; DATA_DIR="/var/lib/budget-planner" ;;
    esac

    if [ -z "$RESTORE_DIR" ]; then
      read -rp "  Complete server-data directory to restore (blank for fresh setup): " RESTORE_DIR
    fi

    echo
    echo "  Local OCR tools (CSV/XLSX imports work without them):"
    echo "   1) Full OCR — PDF and JPG/PNG (recommended)"
    echo "   2) PDF text extraction only"
    echo "   3) None"
    read -rp "  Choice [1]: " ocr_choice
    case "${ocr_choice:-1}" in
      2) OCR_MODE="pdf" ;;
      3) OCR_MODE="none" ;;
      *) OCR_MODE="full" ;;
    esac

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

# Verify the downloaded artifact against the release's SHA256SUMS.txt.
SUMS="/tmp/bp-SHA256SUMS.txt"
SUMS_URL="https://github.com/$REPO/releases/download/$TAG/SHA256SUMS.txt"
rm -f "$SUMS"
if [ -n "${GH_TOKEN:-}" ]; then
  curl -fsSL -H "Authorization: Bearer $GH_TOKEN" -o "$SUMS" "$SUMS_URL" || true
else
  curl -fsSL -o "$SUMS" "$SUMS_URL" || true
fi
if [ -s "$SUMS" ]; then
  EXPECTED=$(grep -E "^[0-9a-f]{64}[[:space:]]+${ASSET_NAME}\$" "$SUMS" | awk '{print $1}')
  ACTUAL=$(sha256sum "$OUT" | awk '{print $1}')
  if [ -z "$EXPECTED" ]; then
    echo "ERROR: $ASSET_NAME not listed in SHA256SUMS.txt — refusing to install." >&2
    echo "       (Set INSTALLER_SKIP_CHECKSUM=1 to override this check.)" >&2
    rm -f "$OUT" "$SUMS"
    [ "${INSTALLER_SKIP_CHECKSUM:-0}" = "1" ] || exit 1
  elif [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "ERROR: checksum mismatch for $ASSET_NAME" >&2
    echo "  expected: $EXPECTED" >&2
    echo "  actual:   $ACTUAL" >&2
    rm -f "$OUT" "$SUMS"
    exit 1
  else
    echo "==> checksum verified"
  fi
  rm -f "$SUMS"
else
  echo "ERROR: could not download SHA256SUMS.txt for $TAG — refusing to install unverified." >&2
  echo "       (Set INSTALLER_SKIP_CHECKSUM=1 to override this check.)" >&2
  [ "${INSTALLER_SKIP_CHECKSUM:-0}" = "1" ] || exit 1
fi

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
mkdir -p "$(dirname "$DEFAULTS_FILE")"
touch "$DEFAULTS_FILE"
set_default() {
  local key="$1" value="$2" tmp
  tmp=$(mktemp)
  grep -vE "^${key}=" "$DEFAULTS_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$DEFAULTS_FILE"
}
set_default PORT "$PORT"
[ -n "$BIND_IP" ] && set_default BIND_IP "$BIND_IP"
set_default DATA_DIR "$DATA_DIR"

# The packaged service is sandboxed to its default directory. A drop-in keeps
# that protection while allowing an explicitly selected custom path.
if [ "$DATA_DIR" != "/var/lib/budget-planner" ]; then
  install -d -m 700 -o budget -g budget "$DATA_DIR"
  install -d -m 755 /etc/systemd/system/budget-planner.service.d
  cat > /etc/systemd/system/budget-planner.service.d/data-dir.conf <<EOF
[Service]
ReadWritePaths=
ReadWritePaths=/var/lib/budget-planner
ReadWritePaths=$DATA_DIR
EOF
fi

case "$OCR_MODE" in
  pdf) echo "==> installing optional PDF extraction support"; apt-get install -y poppler-utils ;;
  full) echo "==> installing optional PDF and image OCR support"; apt-get install -y poppler-utils tesseract-ocr ;;
  none) echo "==> skipping optional OCR packages" ;;
esac

systemctl daemon-reload

restore_server_data() {
  local source="$1" target="$2" stage backup
  case "$source" in /*) ;; *) echo "ERROR: restore source must be an absolute path" >&2; exit 1 ;; esac
  [ -d "$source" ] || { echo "ERROR: restore source is not a directory: $source" >&2; exit 1; }
  [ -f "$source/master.db" ] || { echo "ERROR: restore source needs master.db" >&2; exit 1; }
  [ -d "$source/users" ] || { echo "ERROR: restore source needs a users/ directory" >&2; exit 1; }
  [ "$(realpath "$source")" != "$(realpath -m "$target")" ] || { echo "ERROR: restore source and target must differ" >&2; exit 1; }
  [ ! -L "$source/master.db" ] && [ ! -L "$source/users" ] || { echo "ERROR: restore source cannot contain symlinks at its root" >&2; exit 1; }
  for db_file in "$source"/users/*.db; do
    [ -e "$db_file" ] || continue
    [ ! -L "$db_file" ] || { echo "ERROR: restore source contains a symlink: $db_file" >&2; exit 1; }
  done

  # Open every database read-only and run SQLite's integrity check before any
  # live directory is moved. This requires no sqlite3 command-line package.
  node --input-type=module - "$source" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const source = process.argv[2];
const files = [path.join(source, 'master.db'), ...fs.readdirSync(path.join(source, 'users')).filter((name) => name.endsWith('.db')).map((name) => path.join(source, 'users', name))];
for (const file of files) {
  const database = new DatabaseSync(file, { readOnly: true });
  const result = database.prepare('PRAGMA integrity_check').get();
  database.close();
  if (result?.integrity_check !== 'ok') throw new Error(`SQLite integrity check failed: ${file}`);
}
NODE

  stage="${target}.restore.$RANDOM"
  backup="${target}.before-restore.$(date +%Y%m%d-%H%M%S)"
  [ ! -e "$stage" ] || { echo "ERROR: temporary restore path already exists: $stage" >&2; exit 1; }
  install -d -m 700 -o budget -g budget "$stage"
  cp -a "$source"/. "$stage"/
  chown -R budget:budget "$stage"
  chmod 700 "$stage"
  if [ -e "$target" ]; then
    mv "$target" "$backup"
    echo "==> existing data retained at $backup"
  fi
  mv "$stage" "$target"
}

if [ -n "$RESTORE_DIR" ]; then
  if [ "$QUIET" != "1" ] && [ -t 0 ]; then
    read -rp "Type RESTORE to replace the selected data directory after validation: " restore_confirm
    [ "$restore_confirm" = "RESTORE" ] || { echo "Restore cancelled."; exit 1; }
  fi
  echo "==> stopping service for complete server-data restore"
  systemctl stop budget-planner || true
  restore_server_data "$RESTORE_DIR" "$DATA_DIR"
fi

systemctl restart budget-planner

# ---- optional admin creation -------------------------------------------
if [ -n "$ADMIN_NAME" ] && [ -n "$ADMIN_PW" ]; then
  echo "==> creating admin account"
  if sudo -u budget env DATA_DIR="$DATA_DIR" \
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
echo "   Data dir: $DATA_DIR   (SQLite — back it up!)"
[ "$STATE" = "running" ] || { echo "============================================================="; exit 0; }
echo
[ -n "${ADMIN_DONE:-}" ] && echo "   Admin account: $ADMIN_NAME (log in with it right away)" \
                     || echo "   First step: open the URL below and create your account"
echo "   This machine:  http://localhost:$PORT"
[ -n "$LAN_IP" ] && [ "$BIND_IP" != "127.0.0.1" ] && echo "   Home network:  http://$LAN_IP:$PORT"
[ -n "$TS_IP" ] && [ "$BIND_IP" != "127.0.0.1" ] && echo "   Tailscale:     http://$TS_IP:$PORT"
echo
echo "   Backup: copy $DATA_DIR (or Settings -> Backup)"
echo "============================================================="
