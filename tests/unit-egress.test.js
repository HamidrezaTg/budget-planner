import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDataDir, cleanup, loadDb } from './helpers.js';

const dir = freshDataDir();
await loadDb(dir);
const egress = await import('../server/services/egress.js');
const { egressConfig, setEgressConfig, validateAllowlistEntries, assertEgressAllowed } = egress;
after(() => {
  cleanup(dir);
});

test('egress policy defaults to allowing all outbound requests', () => {
  assert.deepEqual(egressConfig(), { mode: 'all', allowlist: [] });
  // Even odd URLs pass in 'all' mode — the policy is opt-in.
  assertEgressAllowed('https://anything.example.com/v1');
  assertEgressAllowed('http://169.254.169.254/latest');
});

test('allowlist mode blocks non-approved hosts and bad schemes', () => {
  setEgressConfig({ mode: 'allowlist', allowlist: ['ntfy.sh', '*.example.com'] });
  // Approved exact host
  assertEgressAllowed('https://ntfy.sh/mytopic');
  // Wildcard covers subdomains and the bare root
  assertEgressAllowed('https://api.example.com/v1');
  assertEgressAllowed('https://example.com/v1');
  assert.throws(() => assertEgressAllowed('https://evil.example.net/v1'), /allowlist/);
  assert.throws(() => assertEgressAllowed('http://192.168.1.1/'), /allowlist/);
  assert.throws(() => assertEgressAllowed('ftp://ntfy.sh'), /http or https/);
  assert.throws(() => assertEgressAllowed('not a url'), /invalid/i);
});

test('allowlist entries are validated and normalized', () => {
  assert.deepEqual(validateAllowlistEntries(['EXAMPLE.com', 'https://ntfy.sh/topic', '']), [
    'example.com',
    'ntfy.sh',
  ]);
  assert.throws(() => validateAllowlistEntries(['not a url!']), /Invalid allowlist entry/);
  assert.throws(() => validateAllowlistEntries(['*.']), /Invalid allowlist entry/);
  // Duplicates collapse
  assert.deepEqual(validateAllowlistEntries(['a.com', 'a.com']), ['a.com']);
});

test('egress config persists in the master database', () => {
  setEgressConfig({ mode: 'all', allowlist: [] });
  assert.equal(egressConfig().mode, 'all');
  setEgressConfig({ mode: 'allowlist', allowlist: ['ntfy.sh'] });
  assert.deepEqual(egressConfig(), { mode: 'allowlist', allowlist: ['ntfy.sh'] });
  // Reset for other tests / runtime defaults
  setEgressConfig({ mode: 'all', allowlist: [] });
});
