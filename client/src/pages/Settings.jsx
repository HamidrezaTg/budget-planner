import React, { useEffect, useState } from 'react';
import { api, setCurrency } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Settings() {
  const { confirm, toast } = useDialogs();
  const [cfg, setCfg] = useState(null);
  const [provider, setProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  const [customUrl, setCustomUrl] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [msg, setMsg] = useState(null);

  const [currency, setCurrencyState] = useState('EUR');
  const [fx, setFx] = useState(null);
  const [fxEdits, setFxEdits] = useState({});
  const [fxBusy, setFxBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [dataMsg, setDataMsg] = useState(null);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');

  useEffect(() => {
    api.get('/settings').then((s) => {
      setCfg(s);
      setProvider(s.provider || '');
      setModel(s.model || '');
      setCustomUrl(s.base_url || '');
      setCurrencyState(s.currency || 'EUR');
      if (s.provider && s.model) setModels([s.model]);
    });
    api.get('/settings/fx').then(setFx).catch(() => {});
  }, []);

  const providerDef = cfg?.providers?.find((p) => p.id === provider);
  const needsKey = providerDef ? !providerDef.no_key : true;

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
        provider,
        model,
        currency,
        ...(provider === 'custom' ? { base_url: customUrl } : {}),
        ...(apiKey ? { api_key: apiKey } : {}),
      });
      setCfg(updated);
      setCurrency(currency);
      setApiKey('');
      // rates were stored relative to the old base currency
      api.get('/settings/fx').then(setFx).catch(() => {});
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

  const pickTheme = (t) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    localStorage.setItem('bp-theme', t);
  };

  const loadFx = () => api.get('/settings/fx').then(setFx).catch(() => {});

  const saveFxRate = async (month, cur) => {
    const key = `${month}|${cur}`;
    const value = fxEdits[key];
    if (value === undefined || value === '') return;
    try {
      await api.put('/settings/fx', { month, currency: cur, rate: Number(value) });
      setFxEdits((p) => ({ ...p, [key]: undefined }));
      loadFx();
      toast(`Saved ${cur} rate for ${month}.`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
  };

  const deleteFxRate = async (month, cur) => {
    const ok = await confirm({
      title: 'Delete this exchange rate?',
      message: `The ${cur} rate for ${month} will be removed. Transactions for that month will be counted 1:1 until you add a new rate.`,
      danger: true,
      confirmLabel: 'Delete rate',
    });
    if (!ok) return;
    await api.del('/settings/fx', { month, currency: cur });
    loadFx();
  };

  const fetchFx = async (overwrite) => {
    setFxBusy(true);
    try {
      const r = await api.post('/settings/fx/fetch', { overwrite });
      loadFx();
      if (r.filled > 0 && r.failed.length === 0) {
        toast(`Imported ${r.filled} monthly rate(s) from the ECB.`, 'ok');
      } else if (r.filled > 0) {
        toast(`${r.filled} imported, ${r.failed.length} failed — see failed months below.`, 'error');
      } else if (r.attempted === 0) {
        toast('Nothing to fetch — all rates present.', 'ok');
      } else {
        toast(r.failed[0]?.error || 'Could not reach the rate service.', 'error');
      }
    } catch (e) { toast(e.message, 'error'); }
    finally { setFxBusy(false); }
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
      message:
        `"${file.name}" will REPLACE your current database. A copy of the current data is kept as .pre-restore. You will need to reload the page afterwards.`,
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
    <div>
      <h1>Settings</h1>

      <h2>Appearance</h2>
      <div className="card inline-form">
        <span className="muted">Theme</span>
        <button
          className={`btn ${theme === 'light' ? 'primary' : 'ghost'}`}
          onClick={() => pickTheme('light')}
        >
          Light
        </button>
        <button
          className={`btn ${theme === 'dark' ? 'primary' : 'ghost'}`}
          onClick={() => pickTheme('dark')}
        >
          Dark
        </button>
        <span className="muted" style={{ marginLeft: 18 }}>Currency</span>
        <select
          value={currency}
          onChange={(e) => {
            setCurrencyState(e.target.value);
            setCurrency(e.target.value);
          }}
          style={{ width: 100 }}
        >
          {['EUR', 'USD', 'GBP', 'CHF'].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="muted tiny">saved with the next Save below</span>
      </div>

      {fx && fx.used.length > 0 && (
        <>
          <h2>Exchange rates</h2>
          <p className="muted">
            Transactions recorded in another currency are converted to <b>{fx.base}</b> with a
            monthly rate ({fx.base} units per 1 foreign unit). Without a rate they count 1:1 and a
            warning card appears on the Dashboard.
          </p>
          <div className="card table-card tight">
            <div className="panel-head">
              <span className="muted tiny">{fx.missing.length} month/currency pair(s) missing a rate</span>
              <button className="btn small" disabled={fxBusy} onClick={() => fetchFx(false)}>
                {fxBusy ? 'Fetching…' : 'Fetch missing from ECB'}
              </button>
            </div>
            <table>
              <thead><tr><th>Month</th><th>Currency</th><th>Rate</th><th>Source</th><th></th></tr></thead>
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
                          type="number" step="0.0001" min="0.000001"
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
                          >Save</button>
                          <button className="btn danger small" onClick={() => deleteFxRate(r.month, r.currency)}>✕</button>
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
                          type="number" step="0.0001" min="0.000001"
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
                        >Save</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Account</h2>
      <form onSubmit={changePassword} className="card inline-form settings-form">
        <label>Current password
          <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </label>
        <label>New password
          <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </label>
        <label>Repeat new password
          <input type="password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} />
        </label>
        <div className="btn-row">
          <button className="btn primary" disabled={!pw.current || !pw.next}>Change password</button>
          {pwMsg && <span className={pwMsg.ok ? 'good' : 'error'}>{pwMsg.text}</span>}
        </div>
      </form>

      <h2>Data</h2>
      <div className="card inline-form settings-form">
        <div className="btn-row">
          <a className="btn" href="/api/settings/backup">Download full backup (.db)</a>
          <label className="btn file-btn">
            Restore backup (.db)
            <input type="file" accept=".db" onChange={restoreBackup} hidden />
          </label>
          <button className="btn danger" onClick={deleteSpending}>Delete all spending data</button>
        </div>
        <span className="muted tiny">
          Backup downloads your complete database file — store it somewhere safe.
          Restore replaces your current data with a backup file (a .pre-restore copy is kept).
          Deleting spending data removes every transaction but keeps budgets, rules,
          funds, income sources and commitments. To migrate to a server: install there,
          create an account, then restore your backup file.
        </span>
        {dataMsg && <div className={dataMsg.ok ? 'good' : 'error'}>{dataMsg.text}</div>}
      </div>

      <h2>AI connection</h2>
      <p className="muted">
        Pick a provider, enter your API key, then load the models available to your key.
        Everything is stored in your own database only.
      </p>
      <form onSubmit={save} className="card inline-form settings-form">
        <label>Provider
          <select value={provider} onChange={(e) => { setProvider(e.target.value); setModels([]); setModel(''); }}>
            <option value="">Choose a provider…</option>
            {cfg.providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>

        {provider === 'custom' && (
          <label>Base URL
            <input
              placeholder="https://…/v1"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
            />
          </label>
        )}

        {provider && needsKey && (
          <label>API key {cfg.has_key && cfg.provider === provider && <span className="muted">({cfg.key_hint} saved)</span>}
            <input
              type="password"
              placeholder={cfg.has_key && cfg.provider === provider ? 'Leave empty to keep saved key' : 'sk-…'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
        )}
        {provider && !needsKey && (
          <div className="good">Runs locally — no API key needed.</div>
        )}

        {provider && (
          <label>Model
            <div className="btn-row">
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={!models.length}>
                <option value="">{models.length ? 'Choose a model…' : 'Load models first'}</option>
                {models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button
                className="btn ghost"
                type="button"
                onClick={loadModels}
                disabled={loadingModels || (needsKey && !apiKey && !(cfg.has_key && cfg.provider === provider))}
              >
                {loadingModels ? 'Loading…' : 'Load models'}
              </button>
            </div>
            {models.length > 0 && <span className="muted tiny">{models.length} models available for your key</span>}
          </label>
        )}

        <div className="btn-row">
          <button className="btn primary" type="submit" disabled={!provider || !model}>Save</button>
          <button className="btn ghost" type="button" onClick={test} disabled={!cfg.has_key}>Test connection</button>
        </div>
        {msg && <div className={msg.ok ? 'good' : 'error'}>{msg.text}</div>}
      </form>
    </div>
  );
}
