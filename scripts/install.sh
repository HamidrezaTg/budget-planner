#!/usr/bin/env bash
# ============================================================
# Budget Planner — one-line installer for the SERVER (.deb)
#
# Works with a PRIVATE GitHub repository: you authenticate with
# a fine-grained personal access token (Contents: read-only).
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

# ---- token (resolved as the invoking user — root's gh is usually not logged in)
if [ -z "${GH_TOKEN:-}" ]; then
  # convenience: reuse a GitHub CLI login if present (gh auth login)
  if command -v gh >/dev/null 2>&1 && gh auth token >/dev/null 2>&1; then
    GH_TOKEN=$(gh auth token)
  else
    echo "This repository is private — authenticate with 'gh auth login' or provide a"
    echo "fine-grained token (Contents: read-only)."
    read -rsp "GitHub token: " GH_TOKEN
    echo
  fi
fi
AUTH=("Authorization: Bearer $GH_TOKEN")

if [ "$(id -u)" -ne 0 ] && [ "${INSTALLER_NO_SUDO:-}" != "1" ]; then
  echo "==> re-running with sudo (your GitHub login travels along)"
  exec sudo -E GH_TOKEN="$GH_TOKEN" bash "$0" "$@"
fi

gh_api() {
  curl -fsSL -H "${AUTH[0]}" -H "Accept: application/vnd.github+json" "$@"
}

# ---- pick release -----------------------------------------------------
if [ -n "$WANT_VERSION" ]; then
  echo "==> fetching release $WANT_VERSION"
  RELEASE_JSON=$(gh_api "https://api.github.com/repos/$REPO/releases/tags/v$WANT_VERSION")
else
  echo "==> fetching latest release"
  RELEASE_JSON=$(gh_api "https://api.github.com/repos/$REPO/releases/latest") || {
    echo "ERROR: could not fetch releases. Check your token (needs 'Contents: read' on $REPO)." >&2
    exit 1
  }
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
curl -fSL -H "${AUTH[0]}" -H "Accept: application/octet-stream" \
  -o "$OUT" "https://api.github.com/repos/$REPO/releases/assets/$ASSET_ID"
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
