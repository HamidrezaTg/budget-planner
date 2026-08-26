#!/usr/bin/env bash
# Build the Android APK — a pure CLIENT for your self-hosted Budget Planner.
# The app contains no backend: on first launch it asks for the server address
# (e.g. http://192.168.1.10:2026 or your Tailscale URL), remembers it, and
# loads the planner from there.
#
# Output: dist/budget-planner-android.apk
set -euo pipefail
cd "$(dirname "$0")/../mobile"

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
  echo "==> installing SDK platform 35 + build-tools"
  yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null 2>&1 || true
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" "platforms;android-35" "build-tools;35.0.0" "platform-tools" > /dev/null
fi
echo "sdk.dir=$ANDROID_HOME" > local.properties

echo "==> gradle assembleDebug"
( cd android && ./gradlew assembleDebug --no-daemon -q )

mkdir -p ../dist
cp android/app/build/outputs/apk/debug/app-debug.apk ../dist/budget-planner-android.apk
echo "==> done: dist/budget-planner-android.apk"
echo "    install:  adb install dist/budget-planner-android.apk"
echo "    (or copy to the phone and open it — allow 'unknown sources')"
