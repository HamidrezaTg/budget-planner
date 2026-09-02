const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('Capacitor identity and LAN/VPN navigation policy are configured', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  assert.equal(config.appId, 'com.hamidreza.budgetplanner');
  assert.deepEqual(config.server.allowNavigation, ['*']);
  assert.equal(config.android.allowMixedContent, true);
  const androidManifest = fs.readFileSync(
    path.join(root, 'android/app/src/main/AndroidManifest.xml'),
    'utf8',
  );
  const androidNetworkPolicy = fs.readFileSync(
    path.join(root, 'android/app/src/main/res/xml/network_security_config.xml'),
    'utf8',
  );
  assert.match(androidManifest, /android:usesCleartextTraffic="true"/);
  assert.match(androidManifest, /android:networkSecurityConfig="@xml\/network_security_config"/);
  assert.match(androidNetworkPolicy, /cleartextTrafficPermitted="true"/);
});

test('iOS privacy manifest declares no tracking or collected data', () => {
  const manifest = fs.readFileSync(path.join(root, 'ios/App/App/PrivacyInfo.xcprivacy'), 'utf8');
  assert.match(manifest, /NSPrivacyTracking/);
  assert.match(manifest, /<false\s*\/>/);
  assert.match(manifest, /NSPrivacyCollectedDataTypes/);
  assert.match(manifest, /NSPrivacyAccessedAPITypes/);
  assert.match(
    fs.readFileSync(path.join(root, 'ios/App/App/Info.plist'), 'utf8'),
    /NSAllowsLocalNetworking[\s\S]*<true\s*\/>/,
  );
  assert.match(
    fs.readFileSync(path.join(root, 'ios/App/App/Info.plist'), 'utf8'),
    /NSAllowsArbitraryLoads[\s\S]*<false\s*\/>/,
  );
});
