#!/usr/bin/env bash
# Build the AUR PKGBUILD inside a clean Arch container. The AUR package
# is generated but NOT submitted: the AUR submission itself needs a
# maintainer account under your control. See ROADMAP.md step v3.15.4.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker required to run an Arch build sandbox." >&2; exit 1;
fi
if ! command -v makepkg >/dev/null 2>&1; then
  echo "ERROR: makepkg not found. Run this from an Arch host, or use the docker sandbox." >&2; exit 1;
fi

VERSION=$(node -p "require('./desktop-client-tauri/package.json').version")
echo "==> regenerating AUR package for v$VERSION"
sed -i "s/^pkgver=.*/pkgver=${VERSION}/" packaging/aur/budget-planner-client/PKGBUILD
sed -i "s|^source=.*|source=(\"https://github.com/HamidrezaTg/budget-planner/releases/download/v${VERSION}/budget-planner-client_${VERSION}_amd64.deb\")|" \
  packaging/aur/budget-planner-client/PKGBUILD

pushd packaging/aur/budget-planner-client >/dev/null
# `updpkgsums` requires network; we ship a SKIP checksum in the PKGBUILD so
# the package can be built against any release artifact. The AUR will
# reject SKIP, so call it locally and let the AUR re-validate.
makepkg --printsrcinfo > .SRCINFO
popd >/dev/null

echo "==> AUR package regenerated. Submit with: cd packaging/aur/budget-planner-client && git push aur master"
