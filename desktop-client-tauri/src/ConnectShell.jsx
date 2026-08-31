// Shared shell for the Tauri v2 and Capacitor (Android) clients. The
// Android shell is still a static HTML page that uses an inline
// `shell-picker.js` helper; in the desktop client this is mounted as a
// React app. The picker logic MUST match `mobile/www/shell-picker.js`
// so users see the same UX everywhere.
//
// Storage model: a JSON-encoded array of saved URLs in `localStorage`
// under the `bp-server-urls` key. Legacy single-URL entries in
// `bp-server-url` are migrated on first read.
import React, { useEffect, useState, useMemo, useCallback } from 'react';

const KEY = 'bp-server-urls';
const LEGACY_KEY = 'bp-server-url';

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function readSavedUrls() {
  const stored = localStorage.getItem(KEY);
  try {
    const parsed = JSON.parse(stored || '[]');
    if (stored !== null && Array.isArray(parsed))
      return parsed.map(normalizeUrl).filter((url) => /^https?:\/\/.+/i.test(url));
  } catch {}
  const legacy = normalizeUrl(localStorage.getItem(LEGACY_KEY));
  return legacy && /^https?:\/\/.+/i.test(legacy) ? [legacy] : [];
}

function saveUrls(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
  localStorage.removeItem(LEGACY_KEY);
}

function remember(list, url) {
  const cleaned = normalizeUrl(url);
  return [cleaned, ...list.filter((u) => u !== cleaned)].slice(0, 10);
}

function forget(list, url) {
  return list.filter((u) => u !== url);
}

async function probe(url) {
  // The desktop bundle does not run from the server origin, so the request
  // is cross-origin. The /.well-known endpoint sets `Access-Control-Allow-
  // Origin: *` (see server/index.js) so this works in production too.
  const response = await fetch(url + '/.well-known/budget-planner', {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Not a planner server');
  const info = await response.json();
  if (info.name !== 'Budget Planner' || info.api !== '/api') {
    throw new Error('Not a planner server');
  }
}

function inTauri() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

// In the Tauri desktop client the React app saves the URL through the
// `plannerClient` IPC bridge (see src-tauri/src/lib.rs). On Android the
// equivalent is `window.plannerClient` from the Capacitor preload; for
// web-only debug (running `npm run dev` inside this folder) we fall back
// to a plain localStorage navigation.
async function saveUrlToShell(url) {
  if (inTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_url', { url });
    return;
  }
  // Web debug: just remember locally and let the React app reload the
  // window into the planner.
  window.location.replace(url + '/');
}

async function getSavedUrlFromShell() {
  if (inTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const cfg = await invoke('get_config');
    return cfg?.url || null;
  }
  return null;
}

export default function ConnectShell() {
  const [urls, setUrls] = useState([]);
  const [active, setActive] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('setup');

  useEffect(() => {
    const stored = readSavedUrls();
    setUrls(stored);
    setActive(stored[0] || '');
    getSavedUrlFromShell().then((shell) => {
      if (shell && !stored.includes(shell)) {
        setUrls((prev) => remember(prev, shell));
        setActive(shell);
      }
    });
  }, []);

  const connect = useCallback(
    async (url) => {
      const cleaned = normalizeUrl(url);
      if (!/^https?:\/\/.+/i.test(cleaned)) {
        setError('Enter a full address starting with http:// or https://');
        return;
      }
      setBusy(true);
      setError('');
      try {
        await probe(cleaned);
        const next = remember(urls, cleaned);
        setUrls(next);
        setActive(cleaned);
        saveUrls(next);
        await saveUrlToShell(cleaned);
      } catch (e) {
        setError(
          `Could not reach ${cleaned}. Check the address and that this ` +
            'computer is on the same network (or VPN) as the server.'
        );
      } finally {
        setBusy(false);
      }
    },
    [urls]
  );

  const useUrl = useCallback(
    (url) => {
      setActive(url);
      setInput(url);
      connect(url);
    },
    [connect]
  );

  const remove = useCallback(
    (url) => {
      const next = forget(urls, url);
      setUrls(next);
      saveUrls(next);
      if (active === url) setActive(next[0] || '');
    },
    [urls, active]
  );

  const savedList = useMemo(() => urls, [urls]);

  return (
    <div className="shell">
      <div className="card">
        <span className="mark" aria-hidden="true">
          <i></i>
          <i></i>
          <i></i>
        </span>
        <h1>Budget Planner</h1>
        <p>
          This app is a client for your self-hosted planner. Enter the address
          of the machine running the server — for example
          {' '}<b>http://192.168.1.10:2026</b> (home network) or your Tailscale
          address. No backend runs inside this app.
        </p>
        {savedList.length > 0 && (
          <div className="saved">
            <div className="saved-label">Saved servers</div>
            {savedList.map((url) => (
              <div className="saved-row" key={url}>
                <button
                  type="button"
                  className={'ghost saved-use' + (active === url ? ' active' : '')}
                  onClick={() => useUrl(url)}
                  title={`Use ${url}`}
                >
                  {url}
                </button>
                <button
                  type="button"
                  className="ghost saved-forget"
                  onClick={() => remove(url)}
                  title={`Forget ${url}`}
                >
                  Forget
                </button>
              </div>
            ))}
          </div>
        )}
        <label htmlFor="server" className="field-label">Server address</label>
        <input
          id="server"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="http://192.168.1.10:2026"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && connect(input)}
        />
        {error && <div className="err" role="alert">{error}</div>}
        <button
          type="button"
          className="primary"
          disabled={busy || !input.trim()}
          onClick={() => connect(input)}
        >
          {busy ? 'Checking…' : 'Connect'}
        </button>
      </div>
    </div>
  );
}
