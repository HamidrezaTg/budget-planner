#!/usr/bin/env bash
# ============================================================
# Budget Planner — one-line installer for the SERVER (.deb)
#
# Works without authentication against the public repository. If the
# repository is private, it falls back to 'gh auth login' or a fine-grained
# personal access token (Contents: read-only).
#
# Usage:
#   GH_TOKEN=github_pat_xxxx bash -c "$(curl -fsSL \
#     -H 'Authorization: Bearer github_pat_xxxx' \
#     https://raw.githubusercontent.com/HamidrezaTg/budget-planner/main/scripts/install.sh)"
#
# or, after downloading the file:
#   GH_TOKEN=github_pat_xxxx ./install.sh
#
# Flags:
#   --client    install the Linux desktop client instead of the server
#   --version X install a specific release instead of the latest
# ============================================================
set -euo pipefail

REPO="HamidrezaTg/budget-planner"
WANT_CLIENT=0
WANT_VERSION=""

for arg in "$@"; do
  case "$arg" in
    --client) WANT_CLIENT=1 ;;
    --version) WANT_VERSION="set" ;; # consumed below with value
    --version=*) WANT_VERSION="${arg#*=}" ;;
    *) if [ "$WANT_VERSION" = "set" ]; then WANT_VERSION="$arg"; fi ;;
  esac
done

# ---- release fetch: anonymous first (repo is public), token only if needed
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
  # private-repo fallback: GitHub CLI login or a fine-grained token
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

# if we are the buffered temp copy, remove it (safe: already loaded)
case "${0:-}" in /tmp/budget-planner-install.sh) rm -f "$0" ;; esac

if [ "$(id -u)" -ne 0 ] && [ "${INSTALLER_NO_SUDO:-}" != "1" ]; then
  echo "==> re-running with sudo (your GitHub login travels along)"
  # $0 is unreliable when piped (bash -c "$(curl …)") — make sure we have a
  # real file for the privileged re-exec.
  SELF="$0"
  if [ ! -f "$SELF" ]; then
    SELF="/tmp/budget-planner-install.sh"
    curl -fsSL "https://raw.githubusercontent.com/$REPO/main/scripts/install.sh?v=$(date +%s)" -o "$SELF"
  fi
  exec sudo -E GH_TOKEN="${GH_TOKEN:-}" bash "$SELF" "$@"
fi

TAG=$(echo "$RELEASE_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).tag_name||'')})" 2>/dev/null || true)
if [ -z "$TAG" ]; then
  echo "ERROR: release not found." >&2
  exit 1
fi
echo "==> release: $TAG"

# ---- pick asset -------------------------------------------------------
if [ "$WANT_CLIENT" = "1" ]; then
  [ "$(dpkg --print-architecture)" = "amd64" ] || { echo "ERROR: the desktop client is amd64-only." >&2; exit 1; }
  PATTERN="budget-planner-client_.*_amd64\.deb"
else
  PATTERN="budget-planner_[0-9.]*_all\.deb"
fi

ASSET_ID=$(echo "$RELEASE_JSON" | node -e "
  let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const re=/$PATTERN/;
    const a=(JSON.parse(d).assets||[]).find(x=>re.test(x.name));
    console.log(a?a.id:'');
  })")
ASSET_NAME=$(echo "$RELEASE_JSON" | node -e "
  let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
    const re=/$PATTERN/;
    const a=(JSON.parse(d).assets||[]).find(x=>re.test(x.name));
    console.log(a?a.name:'');
  })")
if [ -z "$ASSET_ID" ]; then
  echo "ERROR: no matching .deb asset in release $TAG." >&2
  exit 1
fi
echo "==> asset: $ASSET_NAME"

# ---- node dependency --------------------------------------------------
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJOR=$(node -p "process.versions.node.split('.')[0]")
  [ "$MAJOR" -ge 22 ] && NEED_NODE=0
fi
if [ "$NEED_NODE" = "1" ] && [ "$WANT_CLIENT" != "1" ]; then
  echo "==> Node.js >= 22 is required. Install Node 22 via NodeSource now?"
  read -rp "Run 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs'? [y/N] " yn
  if [ "${yn:-n}" = "y" ]; then
    curl -fsSL "https://deb.nodesource.com/setup_22.x" | bash -
    apt-get install -y nodejs
  else
    echo "Install Node 22 manually, then re-run this installer." >&2
    exit 1
  fi
fi

# ---- download + install ----------------------------------------------
OUT="/tmp/$ASSET_NAME"
echo "==> downloading $ASSET_NAME"
if [ -n "${GH_TOKEN:-}" ]; then
  curl -fSL -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/octet-stream" \
    -o "$OUT" "https://api.github.com/repos/$REPO/releases/assets/$ASSET_ID"
else
  curl -fSL -H "Accept: application/octet-stream" \
    -o "$OUT" "https://api.github.com/repos/$REPO/releases/assets/$ASSET_ID"
fi
[ "$(stat -c%s "$OUT")" -gt 10000 ] || { echo "ERROR: download too small — token or asset problem." >&2; exit 1; }

echo "==> installing $ASSET_NAME"
apt-get install -y "$OUT"
rm -f "$OUT"

echo
echo "============================================================="
if [ "$WANT_CLIENT" = "1" ]; then
  echo " Desktop client installed — find 'Budget Planner' in your"
  echo " application menu and enter your server address on first launch."
else
  echo " Budget Planner server installed and running (systemd)."
  echo "   URL:      http://<this-machine-ip>:2026"
  echo "   Data dir: /var/lib/budget-planner   (SQLite — back it up!)"
  echo "   Service:  systemctl status budget-planner"
  echo
  echo " Open the URL from any phone/PC on your network, create your"
  echo " account (first account = admin), and you're in."
fi
echo "============================================================="
