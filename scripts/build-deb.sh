#!/usr/bin/env bash
# Build a Debian package: budget-planner_<version>_all.deb
# Result: dist/budget-planner_<version>_all.deb
# The package ships server + built client + production node_modules and a
# systemd service running as the system user 'budget' with data in
# /var/lib/budget-planner.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "==> staging budget-planner $VERSION"

# application files
mkdir -p "$STAGE/opt/budget-planner" "$STAGE/DEBIAN" "$STAGE/lib/systemd/system" "$STAGE/etc/default"
cp -r server "$STAGE/opt/budget-planner/server"
cp -r client/dist "$STAGE/opt/budget-planner/client-dist-tmp"
mkdir -p "$STAGE/opt/budget-planner/client"
mv "$STAGE/opt/budget-planner/client-dist-tmp" "$STAGE/opt/budget-planner/client/dist"
cp package.json package-lock.json "$STAGE/opt/budget-planner/"

# production-only dependencies (all pure JS → Architecture: all)
echo "==> npm ci --omit=dev"
( cd "$STAGE/opt/budget-planner" && npm ci --omit=dev --no-audit --no-fund --loglevel=error )

# deb control files + service + defaults (version stamped from package.json)
for f in control postinst prerm postrm; do
  cp "packaging/$f" "$STAGE/DEBIAN/$f"
  chmod 755 "$STAGE/DEBIAN/$f"
done
sed -i "s/^Version: .*/Version: $VERSION/" "$STAGE/DEBIAN/control"
cp packaging/budget-planner.service "$STAGE/lib/systemd/system/"
cp packaging/budget-planner.default "$STAGE/etc/default/budget-planner"
chmod 644 "$STAGE/etc/default/budget-planner"

mkdir -p dist
echo "==> dpkg-deb --build"
dpkg-deb --root-owner-group --build "$STAGE" "dist/budget-planner_${VERSION}_all.deb"
ls -lh "dist/budget-planner_${VERSION}_all.deb"
echo "==> install with:  sudo apt install ./dist/budget-planner_${VERSION}_all.deb"
