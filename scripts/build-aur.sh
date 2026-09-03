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
PKG_DIR="$(pwd)/packaging/aur/budget-planner-client"
sed -i "s/^pkgver=.*/pkgver=${VERSION}/" "$PKG_DIR/PKGBUILD"
sed -i "s|^source=.*|source=(\"${ASSET_URL}\")|" "$PKG_DIR/PKGBUILD"
sed -i "s/^sha256sums=.*/sha256sums=('${CHECKSUM}')/" "$PKG_DIR/PKGBUILD"

run_makepkg() {
  rm -rf "$PKG_DIR/src" "$PKG_DIR/pkg"
  rm -f "$PKG_DIR"/*.pkg.tar.*
  rm -f "$PKG_DIR"/*.deb
  makepkg --printsrcinfo > "$PKG_DIR/.SRCINFO"
  makepkg --cleanbuild --clean --force --syncdeps --noconfirm
  rm -rf "$PKG_DIR/src" "$PKG_DIR/pkg"
  rm -f "$PKG_DIR"/*.pkg.tar.*
  rm -f "$PKG_DIR"/*.deb
}

run_makepkg_in_container() {
  docker run --rm --pull=always \
    -v "$PKG_DIR:/work" \
    -w /work \
    ghcr.io/archlinux/archlinux@sha256:4171fc4d45f9006fd88b49b4209bd6c614fbc3142e147f070f5cb79e6c10c615 \
    bash -euc '
      pacman -Sy --noconfirm --needed base-devel curl gtk3 libsoup3 webkit2gtk-4.1 libappindicator librsvg hicolor-icon-theme desktop-file-utils xdg-utils >/dev/null
      useradd --create-home builder
      rm -rf /work/src /work/pkg
      rm -f /work/*.pkg.tar.*
      rm -f /work/*.deb
      chown -R builder:builder /work
      runuser -u builder -- makepkg --printsrcinfo > /work/.SRCINFO
      runuser -u builder -- makepkg --cleanbuild --clean --force --noconfirm
      rm -rf /work/src /work/pkg
      rm -f /work/*.pkg.tar.*
      rm -f /work/*.deb
    '
}

if [[ "${AUR_USE_CONTAINER:-0}" == '1' ]]; then
  command -v docker >/dev/null 2>&1 || {
    echo "ERROR: AUR_USE_CONTAINER=1 requires docker." >&2
    exit 1
  }
  run_makepkg_in_container
elif command -v makepkg >/dev/null 2>&1; then
  pushd "$PKG_DIR" >/dev/null
  run_makepkg
  popd >/dev/null
elif command -v docker >/dev/null 2>&1; then
  run_makepkg_in_container
else
  echo "ERROR: makepkg or docker is required to validate the AUR package." >&2
  exit 1
fi

echo "==> AUR package regenerated and built successfully. Submit with: cd packaging/aur/budget-planner-client && git push aur master"
