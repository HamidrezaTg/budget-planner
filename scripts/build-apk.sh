#!/usr/bin/env bash
# Build the Android APK — a pure CLIENT for your self-hosted Budget Planner.
# The app contains no backend: on first launch it asks for the server address
# (e.g. https://budget.example.ts.net), remembers it, and
# loads the planner from there.
#
# Output: dist/budget-planner-android.apk
#
# Release signing: export BP_ANDROID_KEYSTORE, BP_ANDROID_KEYSTORE_PASSWORD and
# BP_ANDROID_KEY_ALIAS (plus optional BP_ANDROID_KEY_PASSWORD) before running.
# With them set this builds a SIGNED release APK. Without them, only an explicitly
# requested debug APK is produced for local testing. Keystore material stays outside
# git and is passed to Gradle for one invocation.
set -euo pipefail
cd "$(dirname "$0")/../mobile"

# ---- Version stamping (single source: root package.json) ----
ROOT_VERSION=$(node -p "require('../package.json').version")
VERSION_CODE=$(node -p "
  const [maj, min, pat] = '$ROOT_VERSION'.split('.').map(Number);
  maj * 10000 + min * 100 + (pat || 0);
")
sed -i \
  -e "s/^        versionCode .*/        versionCode ${VERSION_CODE}/" \
  -e "s/^        versionName \".*\"/        versionName \"${ROOT_VERSION}\"/" \
  android/app/build.gradle
# Verify the stamp actually landed (a formatting change upstream would
# otherwise leave the version stale, silently).
grep -q "versionCode ${VERSION_CODE}" android/app/build.gradle || { echo "ERROR: version stamping failed" >&2; exit 1; }
grep -q "versionName \"${ROOT_VERSION}\"" android/app/build.gradle || { echo "ERROR: versionName stamping failed" >&2; exit 1; }
echo "==> stamped version ${ROOT_VERSION} (code ${VERSION_CODE})"

grep -q 'android:usesCleartextTraffic="false"' android/app/src/main/AndroidManifest.xml || {
  echo "ERROR: AndroidManifest.xml must disable cleartext traffic for native HTTPS policy" >&2
  exit 1
}
grep -q 'android:networkSecurityConfig="@xml/network_security_config"' android/app/src/main/AndroidManifest.xml || {
  echo "ERROR: AndroidManifest.xml is missing the HTTPS network security policy" >&2
  exit 1
}
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
  echo "==> gradle assembleRelease (release signing configured)"
  ( cd android && ./gradlew assembleRelease --no-daemon -q )
  cp android/app/build/outputs/apk/release/app-release.apk ../dist/budget-planner-android.apk
  test -s ../dist/budget-planner-android.apk
else
  # A debug-key build must NEVER land under the release filename: users
  # sideload updates by filename, and the public debug key would let anyone
  # craft a signed "update" for them. Only an explicit opt-in overrides this.
  if [ "${BP_ALLOW_DEBUG_APK:-0}" != "1" ]; then
    echo "ERROR: no signing environment (BP_ANDROID_KEYSTORE...) and BP_ALLOW_DEBUG_APK!=1." >&2
    echo "       Refusing to produce a debug-key APK as dist/budget-planner-android.apk." >&2
    exit 1
  fi
  echo "==> gradle assembleDebug (BP_ALLOW_DEBUG_APK=1 — local test build only)"
  ( cd android && ./gradlew assembleDebug --no-daemon -q )
  cp android/app/build/outputs/apk/debug/app-debug.apk ../dist/budget-planner-android-debug.apk
fi

if [ "$SIGNED_RELEASE" = true ]; then
  echo "==> done: dist/budget-planner-android.apk (signed release)"
else
  echo "==> done: dist/budget-planner-android-debug.apk (debug key — do not distribute)"
fi
echo "    install:  adb install dist/<apk>"
echo "    (or copy to the phone and open it — allow 'unknown sources')"
