import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageInfo = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

export const SERVER_VERSION = packageInfo.version;
export const RELEASES_URL = 'https://github.com/HamidrezaTg/gulden/releases/latest';

let cached = null;
const CACHE_MS = 10 * 60 * 1000;

function versionParts(version) {
  const match = String(version)
    .replace(/^v/, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function isNewer(candidate, installed) {
  const next = versionParts(candidate);
  const current = versionParts(installed);
  if (!next || !current) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i] !== current[i]) return next[i] > current[i];
  }
  return false;
}

export async function getVersionStatus({ refresh = false } = {}) {
  if (!refresh && cached && Date.now() - cached.checked_at < CACHE_MS) return cached;

  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(
      'https://api.github.com/repos/HamidrezaTg/gulden/releases/latest',
      {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'gulden-server' },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const release = await response.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    if (!versionParts(latest)) throw new Error('GitHub returned an invalid release version');
    cached = {
      server_version: SERVER_VERSION,
      latest_version: latest,
      update_available: isNewer(latest, SERVER_VERSION),
      release_url: release.html_url || RELEASES_URL,
      checked_at: checkedAt,
      error: null,
    };
  } catch (error) {
    cached = {
      server_version: SERVER_VERSION,
      latest_version: cached?.latest_version || null,
      update_available: cached?.latest_version
        ? isNewer(cached.latest_version, SERVER_VERSION)
        : false,
      release_url: cached?.release_url || RELEASES_URL,
      checked_at: checkedAt,
      error: error.message,
    };
  }
  return cached;
}
