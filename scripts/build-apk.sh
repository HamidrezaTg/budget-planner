#!/usr/bin/env bash
# Build the Android APK that wraps the Budget Planner server URL.
#
#   ./scripts/build-apk.sh [server-url]
#     default server-url: http://<this machine's LAN IP>:2026
#
# Output: mobile/android/app/build/outputs/apk/debug/app-debug.apk
#         copied to dist/budget-planner-android.apk
#
# The app loads your planner server over the network (home LAN or Tailscale) —
# it is a native shell around the same PWA, so installs without app stores.
set -euo pipefail
cd "$(dirname "$0")/../mobile"

SERVER_URL="${1:-}"
if [ -z "$SERVER_URL" ]; then
  LAN_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
  SERVER_URL="http://${LAN_IP:-192.168.1.50}:2026"
fi
echo "==> APK will load: $SERVER_URL (override: ./scripts/build-apk.sh http://yourip:2026)"

node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('capacitor.config.json', 'utf8'));
cfg.server.url = process.argv[1];
cfg.server.cleartext = true;
fs.writeFileSync('capacitor.config.json', JSON.stringify(cfg, null, 2) + '\n');
" "$SERVER_URL"

grep -q usesCleartextTraffic android/app/src/main/AndroidManifest.xml || \
  sed -i 's/<application$/<application\n        android:usesCleartextTraffic="true"/' android/app/src/main/AndroidManifest.xml
npx cap sync android > /dev/null

# ---- Android SDK bootstrap (only if missing) ----
if [ -z "${ANDROID_HOME:-}" ] && [ ! -d "$HOME/Android/Sdk/cmdline-tools" ]; then
  echo "==> Android SDK not found — downloading cmdline-tools (~150 MB)"
  mkdir -p "$HOME/Android/Sdk/cmdline-tools"
  ZIP="$HOME/Android/Sdk/cmdline-tools.zip"
  curl -fL --retry 2 -o "$ZIP" \
    https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q -o "$ZIP" -d "$HOME/Android/Sdk/cmdline-tools"
  mv "$HOME/Android/Sdk/cmdline-tools/cmdline-tools" "$HOME/Android/Sdk/cmdline-tools/latest"
  rm "$ZIP"
fi
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"

if [ ! -d "$ANDROID_HOME/platforms/android-35" ]; then
  echo "==> installing SDK platform 35 + build-tools (accepts licenses automatically)"
  yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null 2>&1 || true
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platforms;android-35" "build-tools;35.0.0" "platform-tools" > /dev/null
fi
echo "sdk.dir=$ANDROID_HOME" > local.properties

echo "==> gradle assembleDebug (first run downloads gradle + dependencies)"
( cd android && ./gradlew assembleDebug --no-daemon -q )

mkdir -p ../dist
cp android/app/build/outputs/apk/debug/app-debug.apk ../dist/budget-planner-android.apk
echo "==> done: dist/budget-planner-android.apk"
echo "    install on phone:  adb install dist/budget-planner-android.apk"
echo "    (or copy the APK to the phone and open it — allow 'unknown sources')"
