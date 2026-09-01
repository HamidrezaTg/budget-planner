// Shared logic for the multi-server saved-URL picker used by both the
// Capacitor (Android) shell and the Tauri v2 desktop shell.
//
// The Android shell imports this script and uses the helpers directly;
// the Tauri v2 shell re-implements the same contract inside
// `desktop-client-tauri/src/ConnectShell.jsx` so the React bundle can
// drive the UI without needing to load a third script.
//
// Keep the two implementations in sync. The minimal contract is:
//   - normalizeUrl(url) — strip whitespace and trailing slashes
//   - readSavedUrls()    — returns up to 10 saved URLs, legacy-migrated
//   - remember(list, url), forget(list, url)
//   - probe(url)         — fetch `/.well-known/budget-planner` and verify
(function (global) {
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
        return parsed.map(normalizeUrl).filter((url) => /^https:\/\/.+/i.test(url));
    } catch {}
    const legacy = normalizeUrl(localStorage.getItem(LEGACY_KEY));
    return legacy && /^https:\/\/.+/i.test(legacy) ? [legacy] : [];
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
    if (!/^https:\/\/.+/i.test(url)) throw new Error('HTTPS is required');
    const response = await fetch(url + '/.well-known/budget-planner', {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Not a planner server');
    const info = await response.json();
    if (info.name !== 'Budget Planner' || info.api !== '/api') {
      throw new Error('Not a planner server');
    }
    return info;
  }

  global.BudgetPlannerShell = {
    KEY,
    LEGACY_KEY,
    normalizeUrl,
    readSavedUrls,
    saveUrls,
    remember,
    forget,
    probe,
  };
})(window);
