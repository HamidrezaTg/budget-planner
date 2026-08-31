import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, eur } from '../api.js';

function transferCandidates(preview = []) {
  const seen = new Set();
  return preview.flatMap((tx) => {
    if (!tx.transfer_pair_id || seen.has(tx.transfer_pair_id)) return [];
    seen.add(tx.transfer_pair_id);
    const other = preview[tx.transfer_pair_other];
    return [
      {
        id: tx.transfer_pair_id,
        date: tx.date,
        amount: Math.abs(tx.amount),
        first: tx.description,
        second: other?.description || 'matching entry',
        confidence: tx.transfer_pair_confidence,
      },
    ];
  });
}

export default function ImportPage() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [accountId, setAccountId] = useState(
    () => localStorage.getItem('bp-last-import-account') || '',
  );
  const [accounts, setAccounts] = useState([]);
  const [selectedTransfers, setSelectedTransfers] = useState([]);

  useEffect(() => {
    api
      .get('/categories/meta/all')
      .then((m) => setAccounts(m.accounts))
      .catch((e) => setError(e.message));
  }, []);

  const processFile = async (file, endpoint) => {
    if (!file) return;
    setError('');
    setDone(null);
    setResult(null);
    setSelectedTransfers([]);
    setBusy(true);
    try {
      const data = await api.upload(endpoint, file);
      if (accountId && data.token) {
        try {
          const preview = await api.post('/import/preview', {
            token: data.token,
            account_id: accountId,
          });
          setResult({ ...data, ...preview });
        } catch (err) {
          // Account ids are local to each server/user. A remembered id may no
          // longer exist, so do not make it prevent the user from importing.
          setAccountId('');
          localStorage.removeItem('bp-last-import-account');
          setResult(data);
          setError(
            `The remembered account is unavailable. Please choose an account before confirming. ${err.message}`,
          );
        }
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    await processFile(e.target.files?.[0], '/import/upload');
    e.target.value = '';
  };

  const onDrop = async (e) => {
    e.preventDefault();
    await processFile(e.dataTransfer.files?.[0], '/import/upload');
  };

  const smartAnalyze = async (e) => {
    await processFile(e.target.files?.[0], '/import/smart');
    e.target.value = '';
  };

  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.post('/import/confirm', {
        token: result.token,
        account_id: accountId || null,
        transfer_pairs: selectedTransfers,
      });
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
    if (value) localStorage.setItem('bp-last-import-account', value);
    else localStorage.removeItem('bp-last-import-account');
    if (!result?.token) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/import/preview', {
        token: result.token,
        account_id: value || null,
      });
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
        Upload your bank export (.csv or .xlsx — Revolut files are detected automatically). Only
        COMPLETED transactions are imported; pendings from previous months count as completed;
        duplicates are skipped.
      </p>

      <div
        className="card upload-card upload-dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <p className="drop-hint">Drop a CSV or XLSX file here</p>
        <label className="btn primary file-btn">
          {busy ? 'Processing…' : 'Choose CSV / XLSX file'}
          <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} disabled={busy} hidden />
        </label>
        <label
          className="btn file-btn"
          title="AI detects the format of any bank export and converts it"
        >
          Analyze format with AI
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={smartAnalyze}
            disabled={busy}
            hidden
          />
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
              {' '}
              · <Link to="/transactions?review=1">{done.remainingReview} need review →</Link>
            </>
          )}
        </div>
      )}

      {/* Rows the parser could not read: never silently dropped — show what and why. */}
      {result?.errors?.length > 0 && (
        <div className="card warn-box" role="alert">
          <b>
            {result.errors.at(-1)?.truncated
              ? `${result.stats.invalid} row(s) could not be read`
              : `${result.errors.length} row(s) could not be read`}
            .
          </b>{' '}
          Check the file — these were skipped:
          <ul style={{ margin: '8px 0 0 18px' }}>
            {result.errors
              .filter((e) => !e.truncated)
              .map((e, i) => (
                <li key={i}>
                  row {e.row}: {e.reason}
                  {e.value ? ` — "${e.value}"` : ''}
                </li>
              ))}
          </ul>
        </div>
      )}

      {result && (
        <>
          <div className="stats-row">
            <div className="card stat">
              <div className="stat-label">To import</div>
              <div className="stat-value">{result.summary.toImport}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Duplicates</div>
              <div className="stat-value">{result.summary.duplicates}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Needs review</div>
              <div className="stat-value warn">{result.summary.needsReview}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Income / Expenses</div>
              <div className="stat-value small-value">
                {result.summary.income} / {result.summary.expenses}
              </div>
            </div>
          </div>
          {transferCandidates(result.preview).length > 0 && (
            <div
              className="card transfer-review"
              role="group"
              aria-labelledby="transfer-review-title"
            >
              <div className="panel-head">
                <div>
                  <p className="eyebrow">Review before import</p>
                  <h2 id="transfer-review-title" style={{ fontSize: 18, margin: 0 }}>
                    Possible transfers
                  </h2>
                </div>
                <span className="muted tiny">Nothing is marked automatically.</span>
              </div>
              <p className="muted tiny">
                Select only rows that are two sides of the same movement between your own accounts.
                Selected rows will not count as income or spending.
              </p>
              <div className="transfer-options">
                {transferCandidates(result.preview).map((pair) => (
                  <label key={pair.id} className="transfer-option">
                    <input
                      type="checkbox"
                      checked={selectedTransfers.includes(pair.id)}
                      onChange={(e) =>
                        setSelectedTransfers((previous) =>
                          e.target.checked
                            ? [...previous, pair.id]
                            : previous.filter((id) => id !== pair.id),
                        )
                      }
                    />
                    <span>
                      <strong>
                        {pair.date} · {eur(pair.amount)}
                      </strong>
                      <span className="muted tiny">
                        {pair.first} ↔ {pair.second} · {pair.confidence} confidence
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div style={{ marginTop: 16 }} className="inline-form">
            <select value={accountId} onChange={pickAccount}>
              <option value="">Import into account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button className="btn primary" onClick={confirm} disabled={busy}>
              Confirm import ({result.summary.toImport})
            </button>
          </div>
          <div className="card table-card">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Suggested category</th>
                  <th>Status</th>
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
