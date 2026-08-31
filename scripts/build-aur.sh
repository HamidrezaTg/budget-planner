#!/usr/bin/env bash
# Build the AUR PKGBUILD inside a clean Arch container. The AUR package
# is generated but NOT submitted: the AUR submission itself needs a
# maintainer account under your control. See ROADMAP.md step v3.15.4.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./desktop-client-tauri/package.json').version")
echo "==> regenerating AUR package for v$VERSION"
ASSET_URL="https://github.com/HamidrezaTg/budget-planner/releases/download/v${VERSION}/budget-planner-client_${VERSION}_amd64.deb"
ASSET=$(mktemp)
trap 'rm -f "$ASSET"' EXIT
curl --fail --location --retry 2 --silent --show-error "$ASSET_URL" -o "$ASSET"
CHECKSUM=$(sha256sum "$ASSET" | cut -d' ' -f1)
sed -i "s/^pkgver=.*/pkgver=${VERSION}/" packaging/aur/budget-planner-client/PKGBUILD
sed -i "s|^source=.*|source=(\"${ASSET_URL}\")|" packaging/aur/budget-planner-client/PKGBUILD
sed -i "s/^sha256sums=.*/sha256sums=('${CHECKSUM}')/" packaging/aur/budget-planner-client/PKGBUILD

pushd packaging/aur/budget-planner-client >/dev/null
if command -v makepkg >/dev/null 2>&1; then
  makepkg --printsrcinfo > .SRCINFO
elif command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "$(pwd):/work" \
    -w /work \
    archlinux:latest \
    bash -euc 'pacman -Sy --noconfirm base-devel >/dev/null; useradd --create-home builder; chown -R builder:builder /work; runuser -u builder -- makepkg --printsrcinfo > .SRCINFO'
else
  echo "ERROR: makepkg or docker is required to generate .SRCINFO." >&2
  exit 1
fi
popd >/dev/null

echo "==> AUR package regenerated. Submit with: cd packaging/aur/budget-planner-client && git push aur master"
