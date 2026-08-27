import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, eur } from '../api.js';

export default function ImportPage() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [accountId, setAccountId] = useState('');
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    api.get('/categories/meta/all').then((m) => setAccounts(m.accounts));
  }, []);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setDone(null);
    setResult(null);
    setBusy(true);
    try {
      const data = await api.upload('/import/upload', file);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const smartAnalyze = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setDone(null);
    setResult(null);
    setBusy(true);
    try {
      const data = await api.upload('/import/smart', file);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.post('/import/confirm', { token: result.token, account_id: accountId || null });
      setDone(r);
      setResult(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Picking an account re-runs categorization (account-scoped rules only match
  // once the account is known), so refresh the preview for the same staged file.
  const pickAccount = async (e) => {
    const value = e.target.value;
    setAccountId(value);
    if (!result?.token) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/import/preview', { token: result.token, account_id: value || null });
      setResult((prev) => ({ ...prev, ...r }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Import statement</h1>
      <p className="muted">
        Upload your bank export (.csv or .xlsx — Revolut files are detected automatically).
        Only COMPLETED transactions are imported; pendings from previous months count as
        completed; duplicates are skipped.
      </p>

      <div className="card upload-card">
        <label className="btn primary file-btn">
          {busy ? 'Processing…' : 'Choose CSV / XLSX file'}
          <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} disabled={busy} hidden />
        </label>
        <label className="btn file-btn" title="AI detects the format of any bank export and converts it">
          Analyze format with AI
          <input type="file" accept=".csv,.xlsx,.xls" onChange={smartAnalyze} disabled={busy} hidden />
        </label>
        {error && <div className="error">{error}</div>}
      </div>

      {result?.ai_spec && (
        <div className="card success-box">
          AI detected: <b>{result.ai_spec.notes || 'custom format'}</b>
          {result.ai_spec.date_format && ` · dates: ${result.ai_spec.date_format}`}
          {result.ai_spec.decimal_point === ',' && ' · decimal comma'}
        </div>
      )}

      {done && (
        <div className="card success-box">
          Imported {done.inserted} transaction(s)
          {done.skippedDuplicates > 0 && ` · skipped ${done.skippedDuplicates} duplicate(s)`}
          {done.remainingReview > 0 && (
            <>
              {' '}·{' '}
              <Link to="/transactions?review=1">
                {done.remainingReview} need review →
              </Link>
            </>
          )}
        </div>
      )}

      {result && (
        <>
          <div className="stats-row">
            <div className="card stat"><div className="stat-label">To import</div><div className="stat-value">{result.summary.toImport}</div></div>
            <div className="card stat"><div className="stat-label">Duplicates</div><div className="stat-value">{result.summary.duplicates}</div></div>
            <div className="card stat"><div className="stat-label">Needs review</div><div className="stat-value warn">{result.summary.needsReview}</div></div>
            <div className="card stat"><div className="stat-label">Income / Expenses</div><div className="stat-value small-value">{result.summary.income} / {result.summary.expenses}</div></div>
          </div>
          <div style={{ marginTop: 16 }} className="inline-form">
            <select value={accountId} onChange={pickAccount}>
              <option value="">Import into account…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="btn primary" onClick={confirm} disabled={busy}>
              Confirm import ({result.summary.toImport})
            </button>
          </div>
          <div className="card table-card">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Description</th><th>Amount</th><th>Suggested category</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {result.preview.map((tx, i) => (
                  <tr key={i} className={tx.duplicate ? 'dup' : ''}>
                    <td>{tx.date}</td>
                    <td>{tx.description}</td>
                    <td className={tx.amount >= 0 ? 'income' : 'expense'}>{eur(tx.amount)}</td>
                    <td>{tx.suggested_category_id ? '✓' : '—'}</td>
                    <td>{tx.duplicate ? 'duplicate' : tx.needs_review ? 'needs review' : 'ok'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
