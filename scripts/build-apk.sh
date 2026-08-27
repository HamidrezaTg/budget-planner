#!/usr/bin/env bash
# Build the Android APK — a pure CLIENT for your self-hosted Budget Planner.
# The app contains no backend: on first launch it asks for the server address
# (e.g. http://192.168.1.10:2026 or your Tailscale URL), remembers it, and
# loads the planner from there.
#
# Output: dist/budget-planner-android.apk
#
# Release signing (optional): export BP_ANDROID_KEYSTORE, BP_ANDROID_KEYSTORE_PASSWORD
# and BP_ANDROID_KEY_ALIAS (plus optional BP_ANDROID_KEY_PASSWORD) before running.
# With them set this builds a SIGNED release APK; without them it falls back to a
# debug-key build for local testing only. The keystore file itself is never read
# into git or CI state beyond what gradle needs for one invocation.
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

mkdir -p ../dist

SIGNED_RELEASE=false
if [ -n "${BP_ANDROID_KEYSTORE:-}" ] && [ -f "$BP_ANDROID_KEYSTORE" ] \
   && [ -n "${BP_ANDROID_KEYSTORE_PASSWORD:-}" ] && [ -n "${BP_ANDROID_KEY_ALIAS:-}" ]; then
  SIGNED_RELEASE=true
fi

if [ "$SIGNED_RELEASE" = true ]; then
  echo "==> gradle assembleRelease (signed with ${BP_ANDROID_KEYSTORE})"
  ( cd android && ./gradlew assembleRelease --no-daemon -q )
  cp android/app/build/outputs/apk/release/app-release.apk ../dist/budget-planner-android.apk
else
  echo "==> gradle assembleDebug (no BP_ANDROID_KEYSTORE configured — local test build)"
  ( cd android && ./gradlew assembleDebug --no-daemon -q )
  cp android/app/build/outputs/apk/debug/app-debug.apk ../dist/budget-planner-android.apk
fi

echo "==> done: dist/budget-planner-android.apk"
echo "    install:  adb install dist/budget-planner-android.apk"
echo "    (or copy to the phone and open it — allow 'unknown sources')"
