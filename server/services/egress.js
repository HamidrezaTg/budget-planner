// Outbound-request policy (SSRF guard). The server fetches two kinds of
// admin/user-configured URLs: AI provider endpoints (chat + online OCR) and
// ntfy notification servers. A malicious or mistaken URL could otherwise turn
// the server into a probe against the LAN or cloud metadata services.
//
// Policy is global and administrator-controlled, stored in master_settings:
//   egress_mode      'all' (default — current behavior) | 'allowlist'
//   egress_allowlist newline/comma-separated hostnames; '*.example.com'
//                    matches the domain and all its subdomains
// In 'allowlist' mode every outbound fetch must target an allowlisted host —
// including localhost/Ollama, which the admin then adds explicitly.
import { getMasterSetting, setMasterSetting } from '../db.js';

export function egressConfig() {
  const mode = getMasterSetting('egress_mode') === 'allowlist' ? 'allowlist' : 'all';
  const allowlist = (getMasterSetting('egress_allowlist') ?? '')
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return { mode, allowlist };
}

// Validate and normalize raw allowlist entries. A full URL is accepted and
// reduced to its hostname (admins paste endpoints); anything else must be a
// bare hostname. Throws with a user-facing message so the settings API can
// surface it directly.
export function validateAllowlistEntries(entries) {
  const clean = [];
  for (const raw of entries ?? []) {
    let entry = String(raw).trim().toLowerCase().replace(/\.+$/, '');
    if (!entry) continue;
    if (entry.includes('://')) {
      try {
        const parsed = new URL(entry);
        entry = parsed.hostname.toLowerCase();
      } catch {
        throw new Error(`Invalid allowlist entry "${raw}" — not a valid URL or hostname`);
      }
    }
    if (entry.startsWith('*.')) {
      const root = entry.slice(2);
      if (!/^[a-z0-9.-]+$/.test(root) || !root.includes('.'))
        throw new Error(`Invalid allowlist entry "${raw}" — use a hostname like *.example.com`);
      clean.push(`*.${root}`);
    } else if (/^[a-z0-9.-]+$/.test(entry) && !entry.includes('/') && !entry.includes(':')) {
      clean.push(entry);
    } else {
      throw new Error(
        `Invalid allowlist entry "${raw}" — use a bare hostname (example.com or *.example.com)`,
      );
    }
  }
  return [...new Set(clean)].sort();
}

export function setEgressConfig({ mode, allowlist }) {
  setMasterSetting('egress_mode', mode === 'allowlist' ? 'allowlist' : 'all');
  setMasterSetting('egress_allowlist', (allowlist ?? []).join('\n'));
}

function hostAllowed(host, allowlist) {
  return allowlist.some((entry) =>
    entry.startsWith('*.')
      ? host === entry.slice(2) || host.endsWith(`.${entry.slice(2)}`)
      : host === entry,
  );
}

// Throws when the current policy forbids an outbound request to rawUrl.
export function assertEgressAllowed(rawUrl) {
  const { mode, allowlist } = egressConfig();
  if (mode !== 'allowlist') return;
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new Error('Outbound request URL is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Outbound requests must use http or https');
  const host = url.hostname.toLowerCase();
  if (!hostAllowed(host, allowlist))
    throw new Error(
      `Outbound requests to ${host} are blocked by the egress allowlist. An administrator can add it in Settings.`,
    );
}
