import { useCallback, useEffect, useState } from 'react';
import { api, currentMonth, setCurrency } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';
import { useTheme } from '../components/Theme.jsx';

export default function Settings({ me }) {
  const { confirm, toast } = useDialogs();
  const [cfg, setCfg] = useState(null);
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  const [customUrl, setCustomUrl] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [profileName, setProfileName] = useState('');
  const [users, setUsers] = useState([]);
  const [sharedRecipients, setSharedRecipients] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [msg, setMsg] = useState(null);

  const [currency, setCurrencyState] = useState('EUR');
  const [fx, setFx] = useState(null);
  const [fxEdits, setFxEdits] = useState({});
  const [fxBusy, setFxBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [dataMsg, setDataMsg] = useState(null);
  const { theme, setTheme } = useTheme();
  const [rename, setRename] = useState({ username: me?.username || '', current_password: '' });
  const [renameMsg, setRenameMsg] = useState(null);
  const [shares, setShares] = useState([]);
  const [shareForm, setShareForm] = useState({ month: currentMonth(), expires_in_days: '30' });
  const [newShare, setNewShare] = useState(null);
  const [ntfy, setNtfy] = useState(null);
  const [ntfyForm, setNtfyForm] = useState({
    enabled: false,
    server: 'https://ntfy.sh',
    topic: '',
    token: '',
  });
  const [versionInfo, setVersionInfo] = useState(null);
  const [versionBusy, setVersionBusy] = useState(false);

  const checkVersion = useCallback(async (refresh = false) => {
    setVersionBusy(true);
    try {
      setVersionInfo(await api.get(`/settings/version${refresh ? '?refresh=1' : ''}`));
    } catch (error) {
      setVersionInfo({ error: error.message });
    } finally {
      setVersionBusy(false);
    }
  }, []);

  useEffect(() => {
    if (me?.username)
      setRename((previous) => ({ ...previous, username: previous.username || me.username }));
  }, [me?.username]);

  useEffect(() => {
    api
      .get('/settings')
      .then((s) => {
        setCfg(s);
        setProvider(s.provider || '');
        setModel(s.model || '');
        setCustomUrl(s.base_url || '');
        setProfiles(s.profiles || []);
        setProfileName(s.profile_name || '');
        setCurrencyState(s.currency || 'EUR');
        if (s.provider && s.model) setModels([s.model]);
      })
      .catch((e) => setMsg({ ok: false, text: e.message }));
    api
      .get('/settings/fx')
      .then(setFx)
      .catch(() => {});
    api
      .get('/shares')
      .then(setShares)
      .catch(() => {});
    api
      .get('/settings/ntfy')
      .then((settings) => {
        setNtfy(settings);
        setNtfyForm((previous) => ({ ...previous, ...settings }));
      })
      .catch(() => {});
    checkVersion(true);
  }, [checkVersion]);

  useEffect(() => {
    if (!me?.admin) return;
    api
      .get('/auth/users')
      .then(setUsers)
      .catch(() => {});
  }, [me?.admin]);

  const providerDef = cfg?.providers?.find((p) => p.id === provider);
  const needsKey = providerDef ? !providerDef.no_key : true;
  const activeProfile = profiles.find((p) => p.active);

  const refreshSettings = async () => {
    const s = await api.get('/settings');
    setCfg(s);
    setProfiles(s.profiles || []);
    setProvider(s.provider || '');
    setModel(s.model || '');
    setCustomUrl(s.base_url || '');
    setProfileName(s.profile_name || '');
    if (s.provider && s.model) setModels([s.model]);
  };

  const chooseProfile = async (value) => {
    if (!value) return;
    const [owner, ...idParts] = value.split(':');
    try {
      await api.put('/settings/ai-profiles/active', {
        owner_user_id: Number(owner),
        profile_id: idParts.join(':'),
      });
      await refreshSettings();
      setApiKey('');
      setMsg({ ok: true, text: 'Active AI profile changed.' });
    } catch (error) {
      setMsg({ ok: false, text: error.message });
    }
  };

  const createNewProfile = async () => {
    try {
      const created = await api.post('/settings/ai-profiles', {
        name: profileName || 'New profile',
        provider,
        model,
        api_key: apiKey || undefined,
        ...(provider === 'custom' ? { base_url: customUrl } : {}),
      });
      await refreshSettings();
      setApiKey('');
      setMsg({ ok: true, text: `Created ${created.name}.` });
    } catch (error) {
      setMsg({ ok: false, text: error.message });
    }
  };

  useEffect(() => {
    if (!me?.admin || !activeProfile?.own) return;
    api
      .get(`/settings/ai-profiles/${activeProfile.id}/shares`)
      .then((r) => setSharedRecipients((r.shares || []).map((share) => share.username)))
      .catch(() => setSharedRecipients([]));
  }, [activeProfile?.id, activeProfile?.own, me?.admin]);

  const saveProfileShares = async () => {
    if (!activeProfile?.own) return;
    try {
      await api.put(`/settings/ai-profiles/${activeProfile.id}/shares`, {
        usernames: sharedRecipients,
      });
      setMsg({ ok: true, text: 'AI profile sharing updated.' });
    } catch (error) {
      setMsg({ ok: false, text: error.message });
    }
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setMsg(null);
    try {
      const r = await api.post('/settings/models', {
        provider,
        api_key: apiKey || undefined,
        base_url: provider === 'custom' ? customUrl : undefined,
      });
      setModels(r.models);
      if (!r.models.length) setMsg({ ok: false, text: 'The provider returned no models.' });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setLoadingModels(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setMsg(null);
    try {
      const updated = await api.put('/settings', {
        name: profileName,
        provider,
        model,
        currency,
        ...(provider === 'custom' ? { base_url: customUrl } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      });
      setCfg(updated);
      setProfiles(updated.profiles || []);
      setCurrency(currency);
      setApiKey('');
      // rates were stored relative to the old base currency
      api
        .get('/settings/fx')
        .then(setFx)
        .catch(() => {});
      setMsg({
        ok: true,
        text: updated.rates_cleared
          ? 'Saved. Exchange rates were cleared because the display currency changed — fetch or re-enter them below.'
          : 'Saved.',
      });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  };

  const test = async () => {
    setMsg(null);
    try {
      const r = await api.post('/settings/test');
      setMsg({ ok: r.ok, text: r.ok ? `AI replied: "${r.reply}"` : r.error });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  };

  const removeActiveProfile = async () => {
    if (!activeProfile?.own) return;
    const ok = await confirm({
      title: `Delete ${activeProfile.name}?`,
      message: 'This removes the profile and revokes any sharing grants.',
      danger: true,
      confirmLabel: 'Delete profile',
    });
    if (!ok) return;
    try {
      await api.del(`/settings/ai-profiles/${activeProfile.id}`);
      await refreshSettings();
      setMsg({ ok: true, text: 'AI profile deleted.' });
    } catch (error) {
      setMsg({ ok: false, text: error.message });
    }
  };

  const loadFx = () =>
    api
      .get('/settings/fx')
      .then(setFx)
      .catch(() => {});

  const saveFxRate = async (month, cur) => {
    const key = `${month}|${cur}`;
    const value = fxEdits[key];
    if (value === undefined || value === '') return;
    try {
      await api.put('/settings/fx', { month, currency: cur, rate: Number(value) });
      setFxEdits((p) => ({ ...p, [key]: undefined }));
      loadFx();
      toast(`Saved ${cur} rate for ${month}.`, 'ok');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const deleteFxRate = async (month, cur) => {
    const ok = await confirm({
      title: 'Delete this exchange rate?',
      message: `The ${cur} rate for ${month} will be removed. Transactions for that month will be counted 1:1 until you add a new rate.`,
      danger: true,
      confirmLabel: 'Delete rate',
    });
    if (!ok) return;
    try {
      await api.del('/settings/fx', { month, currency: cur });
      loadFx();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const fetchFx = async (overwrite) => {
    setFxBusy(true);
    try {
      const r = await api.post('/settings/fx/fetch', { overwrite });
      loadFx();
      if (r.filled > 0 && r.failed.length === 0) {
        toast(`Imported ${r.filled} monthly rate(s) from the ECB.`, 'ok');
      } else if (r.filled > 0) {
        toast(
          `${r.filled} imported, ${r.failed.length} failed — see failed months below.`,
          'error',
        );
      } else if (r.attempted === 0) {
        toast('Nothing to fetch — all rates present.', 'ok');
      } else {
        toast(r.failed[0]?.error || 'Could not reach the rate service.', 'error');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setFxBusy(false);
    }
  };

  const createShare = async (e) => {
    e.preventDefault();
    try {
      const share = await api.post('/shares', {
        month: shareForm.month,
        expires_in_days: Number(shareForm.expires_in_days),
      });
      setNewShare(`${window.location.origin}/share/${share.token}`);
      setShares((previous) => [share, ...previous]);
    } catch (err) {
      setDataMsg({ ok: false, text: err.message });
    }
  };

  const revokeShare = async (share) => {
    try {
      await api.del(`/shares/${share.id}`);
      setShares((previous) =>
        previous.map((item) =>
          item.id === share.id ? { ...item, revoked_at: new Date().toISOString() } : item,
        ),
      );
    } catch (err) {
      setDataMsg({ ok: false, text: err.message });
    }
  };

  const saveNtfy = async (e) => {
    e.preventDefault();
    try {
      const saved = await api.put('/settings/ntfy', ntfyForm);
      setNtfy(saved);
      setNtfyForm((previous) => ({ ...previous, token: '' }));
      toast('ntfy settings saved.', 'ok');
    } catch (err) {
      setDataMsg({ ok: false, text: err.message });
    }
  };

  const testNtfy = async () => {
    try {
      await api.post('/settings/ntfy/test');
      toast('Test notification sent.', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next !== pw.repeat) {
      setPwMsg({ ok: false, text: 'New passwords do not match' });
      return;
    }
    try {
      await api.post('/auth/change-password', {
        current_password: pw.current,
        new_password: pw.next,
      });
      setPw({ current: '', next: '', repeat: '' });
      setPwMsg({ ok: true, text: 'Password changed.' });
    } catch (err) {
      setPwMsg({ ok: false, text: err.message });
    }
  };

  const renameAccount = async (e) => {
    e.preventDefault();
    setRenameMsg(null);
    try {
      await api.patch('/auth/me', rename);
      // The server replaces the session cookie under the new username.
      window.location.reload();
    } catch (err) {
      setRenameMsg({ ok: false, text: err.message });
    }
  };

  const deleteSpending = async () => {
    const ok = await confirm({
      title: 'Delete all spending data?',
      message:
        'Every transaction will be removed. Your budgets, rules, funds, income sources and commitments are kept. This cannot be undone.',
      danger: true,
      confirmLabel: 'Delete spending data',
    });
    if (!ok) return;
    try {
      const r = await api.del('/settings/spending');
      setDataMsg({ ok: true, text: `Deleted ${r.deleted} transaction(s). Budget kept intact.` });
    } catch (err) {
      setDataMsg({ ok: false, text: err.message });
    }
  };

  const restoreBackup = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ok = await confirm({
      title: 'Restore this backup?',
      message: `"${file.name}" will REPLACE your current database. A copy of the current data is kept as .pre-restore. You will need to reload the page afterwards.`,
      danger: true,
      confirmLabel: 'Restore',
    });
    if (!ok) return;
    try {
      const r = await api.upload('/settings/restore', file);
      setDataMsg({
        ok: true,
        text: `Restored ${r.transactions} transaction(s), ${r.categories} categories. Reload the page to see the restored data.`,
      });
    } catch (err) {
      setDataMsg({ ok: false, text: err.message });
    }
  };

  if (!cfg) return <div className="loading">Loading…</div>;

  return (
    <div className="settings-grid">
      <h1 className="settings-title">Settings</h1>

      <div className="card settings-card version-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Server status</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>Version</h2>
          </div>
          <button
            className="btn ghost small"
            onClick={() => checkVersion(true)}
            disabled={versionBusy}
          >
            {versionBusy ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
        {!versionInfo ? (
          <p className="muted tiny">Checking the installed server version…</p>
        ) : versionInfo.error && !versionInfo.server_version ? (
          <p className="error tiny">Could not read the server version: {versionInfo.error}</p>
        ) : (
          <div className="version-status">
            <div>
              <span className="muted tiny">Installed server</span>
              <strong>v{versionInfo.server_version}</strong>
            </div>
            <div>
              <span className="muted tiny">Latest release</span>
              <strong>
                {versionInfo.latest_version ? `v${versionInfo.latest_version}` : 'Unavailable'}
              </strong>
            </div>
            {versionInfo.update_available ? (
              <div className="version-update">
                <span className="warn">Update available</span>
                <a href={versionInfo.release_url} target="_blank" rel="noreferrer">
                  View release
                </a>
              </div>
            ) : (
              <div className="good">
                {versionInfo.error ? 'Update check unavailable' : 'You are up to date'}
              </div>
            )}
          </div>
        )}
        {versionInfo?.error && versionInfo.server_version && (
          <p className="muted tiny">Last check could not reach GitHub: {versionInfo.error}</p>
        )}
      </div>

      {/* Appearance */}
      <div className="card settings-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Look & feel</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>Appearance</h2>
          </div>
        </div>
        <div className="settings-section">
          <p className="muted tiny">
            Theme — Light or dark mode. Applies to the web client and the Android app.
          </p>
          <div className="pill-row" role="group" aria-label="Theme">
            {[
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
              ['midnight', 'Midnight'],
              ['forest', 'Forest'],
            ].map(([value, label]) => (
              <button
                key={value}
                className={`btn ${theme === value ? 'primary' : 'ghost'}`}
                onClick={() => setTheme(value)}
                aria-pressed={theme === value}
                title={`Use the ${label.toLowerCase()} theme`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-section">
          <label className="muted tiny" htmlFor="settings-currency">
            Display currency
          </label>
          <select
            id="settings-currency"
            value={currency}
            onChange={(e) => {
              setCurrencyState(e.target.value);
              setCurrency(e.target.value);
            }}
            title="Format all amounts in this currency"
            style={{ width: 120 }}
          >
            {['EUR', 'USD', 'GBP', 'CHF'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <p className="muted tiny">
            Changes the display format only. Exchange rates for foreign transactions are managed
            below.
          </p>
        </div>
      </div>

      <div className="card settings-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Identity</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>Change username</h2>
          </div>
        </div>
        <p className="muted tiny">
          Use 2–32 lowercase letters, numbers, or underscores. Your data stays with the account.
        </p>
        <form className="settings-section" onSubmit={renameAccount}>
          <label className="muted tiny">
            New username
            <input
              value={rename.username}
              maxLength={32}
              onChange={(e) => setRename({ ...rename, username: e.target.value })}
              autoComplete="username"
              required
            />
          </label>
          <label className="muted tiny">
            Current password
            <input
              type="password"
              value={rename.current_password}
              onChange={(e) => setRename({ ...rename, current_password: e.target.value })}
              autoComplete="current-password"
              required
            />
          </label>
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <button
              className="btn primary"
              type="submit"
              disabled={!rename.username.trim() || !rename.current_password}
            >
              Change username
            </button>
            {renameMsg && <span className={renameMsg.ok ? 'good' : 'error'}>{renameMsg.text}</span>}
          </div>
        </form>
      </div>

      {/* Account */}
      <div className="card settings-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">You</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>Account</h2>
          </div>
        </div>
        <form onSubmit={changePassword}>
          <div className="settings-section">
            <p className="muted tiny">
              Change your password. All existing sessions, including this device, will be signed out
              after the change.
            </p>
          </div>
          <div className="form-grid">
            <label>
              Current password
              <input
                type="password"
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
              />
            </label>
            <label>
              New password
              <input
                type="password"
                value={pw.next}
                onChange={(e) => setPw({ ...pw, next: e.target.value })}
              />
            </label>
            <label>
              Repeat new password
              <input
                type="password"
                value={pw.repeat}
                onChange={(e) => setPw({ ...pw, repeat: e.target.value })}
              />
            </label>
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button
              className="btn primary"
              disabled={!pw.current || !pw.next}
              title="Update your password"
            >
              Change password
            </button>
            {pwMsg && <span className={pwMsg.ok ? 'good' : 'error'}>{pwMsg.text}</span>}
          </div>
        </form>
      </div>

      {/* Data */}
      <div className="card settings-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Storage</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>Data</h2>
          </div>
        </div>
        <div className="settings-section">
          <div className="btn-row" style={{ flexWrap: 'wrap' }}>
            <a
              className="btn"
              href="/api/settings/backup"
              title="Download your database file — store it somewhere safe"
            >
              Download full backup (.db)
            </a>
            <label
              className="btn file-btn"
              title="Replace your data with a backup file (a .pre-restore copy is kept)"
            >
              Restore backup (.db)
              <input type="file" accept=".db" onChange={restoreBackup} hidden />
            </label>
            <button
              className="btn danger"
              title="Delete every transaction. Keeps budgets, rules, funds, income sources and commitments."
              onClick={deleteSpending}
            >
              Delete all spending data
            </button>
          </div>
          <p className="muted tiny">
            Backup downloads your complete database file. Restore replaces your current data with a
            backup file (a .pre-restore copy is kept). To migrate to a new server: install there,
            create an account, then restore your backup file.
          </p>
          {dataMsg && <div className={dataMsg.ok ? 'good' : 'error'}>{dataMsg.text}</div>}
        </div>
        <div className="settings-section">
          <h3>Read-only sharing</h3>
          <p className="muted tiny">
            Create a private link showing only the selected month's planned categories. The token is
            shown once, so copy it before leaving this page.
          </p>
          <form className="inline-form" onSubmit={createShare}>
            <input
              type="month"
              value={shareForm.month}
              onChange={(e) => setShareForm({ ...shareForm, month: e.target.value })}
              required
            />
            <input
              type="number"
              min="1"
              max="365"
              value={shareForm.expires_in_days}
              onChange={(e) => setShareForm({ ...shareForm, expires_in_days: e.target.value })}
              title="Days until the link expires"
              style={{ width: 90 }}
            />
            <button className="btn primary" type="submit">
              Create link
            </button>
          </form>
          {newShare && (
            <p className="good tiny" style={{ overflowWrap: 'anywhere' }}>
              New link: <code>{newShare}</code>
            </p>
          )}
          {shares.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shares.map((share) => (
                  <tr key={share.id}>
                    <td>{share.month}</td>
                    <td>{new Date(share.expires_at).toLocaleDateString()}</td>
                    <td>{share.revoked_at ? 'Revoked' : 'Active'}</td>
                    <td>
                      {!share.revoked_at && (
                        <button className="btn danger small" onClick={() => revokeShare(share)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Android notifications */}
      <div className="card settings-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Android notifications</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>ntfy</h2>
          </div>
          {ntfy?.has_token && <span className="muted tiny">Token saved</span>}
        </div>
        <form className="settings-section" onSubmit={saveNtfy}>
          <label className="check-label">
            <input
              type="checkbox"
              checked={ntfyForm.enabled}
              onChange={(e) => setNtfyForm({ ...ntfyForm, enabled: e.target.checked })}
            />
            Send daily warning summaries
          </label>
          <label className="muted tiny">
            Server
            <input
              value={ntfyForm.server}
              onChange={(e) => setNtfyForm({ ...ntfyForm, server: e.target.value })}
              placeholder="https://ntfy.sh"
            />
          </label>
          <label className="muted tiny">
            Topic
            <input
              value={ntfyForm.topic}
              onChange={(e) => setNtfyForm({ ...ntfyForm, topic: e.target.value })}
              placeholder="my-budget-alerts"
            />
          </label>
          <label className="muted tiny">
            Access token (optional)
            <input
              type="password"
              value={ntfyForm.token}
              onChange={(e) => setNtfyForm({ ...ntfyForm, token: e.target.value })}
              placeholder={ntfy?.has_token ? 'Leave blank to keep saved token' : 'tk_…'}
            />
          </label>
          <div className="btn-row">
            <button className="btn primary" type="submit">
              Save ntfy
            </button>
            <button className="btn" type="button" onClick={testNtfy} disabled={!ntfy?.topic}>
              Send test
            </button>
          </div>
          <p className="muted tiny">
            Subscribe to the topic in the ntfy Android app. The server sends at most one warning
            summary per day after a successful delivery.
          </p>
        </form>
      </div>

      {/* AI connection */}
      <div className="card settings-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Assistant</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>AI connection</h2>
          </div>
        </div>
        <div className="settings-section">
          <p className="muted tiny">
            Profiles keep provider credentials separate. Shared profiles from the admin can be used
            but cannot be edited, and their credentials are never shown.
          </p>
          {profiles.length > 0 && (
            <label className="muted tiny">
              Active profile
              <select
                value={activeProfile ? `${activeProfile.owner_user_id}:${activeProfile.id}` : ''}
                onChange={(e) => chooseProfile(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={`${p.owner_user_id}:${p.id}`} value={`${p.owner_user_id}:${p.id}`}>
                    {p.name} · {p.provider} {p.own ? '' : `(shared by ${p.owner_username})`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {activeProfile?.shared && (
            <p className="muted tiny">
              This profile is shared read-only by {activeProfile.owner_username}.
            </p>
          )}
          <form onSubmit={save}>
            <div className="form-grid">
              <label title="A private name for this provider and model combination">
                Profile name
                <input
                  value={profileName}
                  disabled={activeProfile?.shared}
                  onChange={(e) => setProfileName(e.target.value)}
                  placeholder="Household assistant"
                />
              </label>
              <label title="AI provider — built-in options talk to the listed service; Custom lets you paste any OpenAI-compatible URL">
                Provider
                <select
                  value={provider}
                  disabled={activeProfile?.shared}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    setModels([]);
                    setModel('');
                  }}
                >
                  <option value="">Choose a provider…</option>
                  {cfg.providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>

              {provider === 'custom' && !activeProfile?.shared && (
                <label title="Full URL of any OpenAI-compatible endpoint. Must start with http:// or https://">
                  Base URL
                  <input
                    placeholder="https://…/v1"
                    value={customUrl}
                    onChange={(e) => setCustomUrl(e.target.value)}
                  />
                </label>
              )}

              {provider && needsKey && !activeProfile?.shared && (
                <label title="Your API key. Leave empty when editing to keep the saved key.">
                  API key{' '}
                  {cfg.has_key && cfg.provider === provider && (
                    <span className="muted">({cfg.key_hint} saved)</span>
                  )}
                  <input
                    type="password"
                    placeholder={
                      cfg.has_key && cfg.provider === provider
                        ? 'Leave empty to keep saved key'
                        : 'sk-…'
                    }
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </label>
              )}
              {provider && !needsKey && !activeProfile?.shared && (
                <div className="good" style={{ marginTop: 4 }}>
                  Runs locally — no API key needed.
                </div>
              )}

              {provider && (
                <label title="The model to use for AI requests">
                  Model
                  <div className="btn-row" style={{ marginTop: 4 }}>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={!models.length || activeProfile?.shared}
                      style={{ flex: 1 }}
                    >
                      <option value="">
                        {models.length ? 'Choose a model…' : 'Load models first'}
                      </option>
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={loadModels}
                      disabled={
                        loadingModels ||
                        (needsKey &&
                          !apiKey &&
                          !(cfg.has_key && cfg.provider === provider) &&
                          !activeProfile?.shared)
                      }
                      title="Fetch the list of models your key can use"
                    >
                      {loadingModels ? 'Loading…' : 'Load models'}
                    </button>
                  </div>
                  {models.length > 0 && (
                    <span className="muted tiny" style={{ display: 'block', marginTop: 4 }}>
                      {models.length} models available for your key
                    </span>
                  )}
                </label>
              )}
            </div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                type="submit"
                disabled={!provider || !model || activeProfile?.shared}
                title="Save the AI settings"
              >
                Save
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={test}
                disabled={!cfg.has_key && !activeProfile?.shared}
                title="Send a tiny test prompt to verify the connection"
              >
                Test connection
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={createNewProfile}
                disabled={!provider || !model || activeProfile?.shared}
                title="Create another profile using the values above"
              >
                New profile
              </button>
              {activeProfile?.own && (
                <button className="btn danger" type="button" onClick={removeActiveProfile}>
                  Delete profile
                </button>
              )}
            </div>
            {msg && (
              <div className={msg.ok ? 'good' : 'error'} style={{ marginTop: 6 }}>
                {msg.text}
              </div>
            )}
          </form>
          {me?.admin && activeProfile?.own && users.length > 1 && (
            <div style={{ marginTop: 16 }}>
              <p className="muted tiny" style={{ marginBottom: 6 }}>
                Share this profile with household users. They can use it, but cannot view or change
                its API key or endpoint.
              </p>
              <div className="btn-row" style={{ flexWrap: 'wrap' }}>
                {users
                  .filter((user) => user.username !== me.username)
                  .map((user) => (
                    <label className="muted tiny" key={user.username}>
                      <input
                        type="checkbox"
                        checked={sharedRecipients.includes(user.username)}
                        onChange={(e) =>
                          setSharedRecipients((previous) =>
                            e.target.checked
                              ? [...previous, user.username]
                              : previous.filter((name) => name !== user.username),
                          )
                        }
                      />{' '}
                      {user.username}
                    </label>
                  ))}
              </div>
              <button
                className="btn small"
                type="button"
                onClick={saveProfileShares}
                style={{ marginTop: 8 }}
              >
                Save sharing
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Exchange rates (foreign transactions and account display currencies) */}
      {fx && fx.used.length > 0 && (
        <div className="card settings-card" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head">
            <div>
              <p className="eyebrow">Currencies</p>
              <h2 style={{ fontSize: 18, margin: 0 }}>Exchange rates</h2>
            </div>
            <span className="muted tiny">{fx.missing.length} missing</span>
          </div>
          <div className="settings-section">
            <p className="muted tiny">
              Foreign transactions and account balances are converted to <b>{fx.base}</b> with a
              monthly rate ({fx.base} units per 1 foreign unit). Without a rate they count 1:1 and a
              warning card appears on the Dashboard.
            </p>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <button
                className="btn small"
                disabled={fxBusy}
                onClick={() => fetchFx(false)}
                title="Fill missing rates from frankfurter.dev (ECB reference rates)"
              >
                {fxBusy ? 'Fetching…' : 'Fetch missing from ECB'}
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Currency</th>
                  <th>Rate</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {fx.rates.map((r) => {
                  const key = `${r.month}|${r.currency}`;
                  return (
                    <tr key={key}>
                      <td>{r.month}</td>
                      <td>{r.currency}</td>
                      <td className="num">
                        <input
                          className="budget-input"
                          type="number"
                          step="0.0001"
                          min="0.000001"
                          style={{ width: 110 }}
                          value={fxEdits[key] ?? r.rate}
                          onChange={(e) => setFxEdits((p) => ({ ...p, [key]: e.target.value }))}
                        />
                      </td>
                      <td className="muted">{r.source === 'ecb' ? 'ECB' : 'manual'}</td>
                      <td>
                        <div className="env-actions">
                          <button
                            className={`btn small ${fxEdits[key] !== undefined ? 'primary' : 'ghost'}`}
                            disabled={fxEdits[key] === undefined}
                            onClick={() => saveFxRate(r.month, r.currency)}
                            title="Save the new rate"
                          >
                            Save
                          </button>
                          <button
                            className="btn danger small"
                            onClick={() => deleteFxRate(r.month, r.currency)}
                            title="Delete this rate — transactions in that month will count 1:1"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {fx.missing.map((m) => {
                  const key = `${m.month}|${m.currency}`;
                  return (
                    <tr key={`miss-${key}`} className="needs-review-row">
                      <td>{m.month}</td>
                      <td>{m.currency}</td>
                      <td className="num">
                        <input
                          className="budget-input"
                          type="number"
                          step="0.0001"
                          min="0.000001"
                          style={{ width: 110 }}
                          placeholder={`in ${fx.base}`}
                          value={fxEdits[key] ?? ''}
                          onChange={(e) => setFxEdits((p) => ({ ...p, [key]: e.target.value }))}
                        />
                      </td>
                      <td colSpan="2">
                        <button
                          className="btn small primary"
                          disabled={fxEdits[key] === undefined || fxEdits[key] === ''}
                          onClick={() => saveFxRate(m.month, m.currency)}
                          title="Save the new rate"
                        >
                          Save
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
