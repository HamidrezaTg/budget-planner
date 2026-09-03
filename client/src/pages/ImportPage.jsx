import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatMoney } from '../api.js';

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
        currency: tx.currency,
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
  const [ocrMode, setOcrMode] = useState('local');
  const [aiSettings, setAiSettings] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [templateMode, setTemplateMode] = useState(
    () => localStorage.getItem('bp-import-template-mode') || 'reuse',
  );

  useEffect(() => {
    api
      .get('/categories/meta/all')
      .then((m) => setAccounts(m.accounts))
      .catch((e) => setError(e.message));
    api
      .get('/settings')
      .then(setAiSettings)
      .catch(() => {});
    api
      .get('/import/templates')
      .then((data) => setTemplates(data.templates || []))
      .catch(() => {});
  }, []);

  const processFile = async (file, endpoint) => {
    if (!file) return;
    setError('');
    setDone(null);
    setResult(null);
    setSelectedTransfers([]);
    setBusy(true);
    try {
      const online = ocrMode === 'online' && /\.(pdf|jpe?g|png)$/i.test(file.name || '');
      const data = await api.upload(endpoint, file, {
        template_mode: templateMode,
        ...(online ? { ocr_mode: 'online' } : {}),
      });
      const matchedTemplate = data.csv_check?.template || data.template_check?.template;
      if (matchedTemplate) {
        setTemplates((previous) =>
          previous.map((item) =>
            item.id === matchedTemplate.id ? { ...item, ...matchedTemplate } : item,
          ),
        );
      }
      if (accountId && data.token && data.summary) {
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
    try {
      const saved = await api.get('/import/templates');
      setTemplates(saved.templates || []);
    } catch {}
    e.target.value = '';
  };

  const analyzeCsv = async () => {
    if (!result?.token) return;
    setBusy(true);
    setError('');
    try {
      const data = await api.post('/import/analyze', { token: result.token });
      if (accountId && data.summary) {
        const preview = await api.post('/import/preview', {
          token: data.token,
          account_id: accountId,
        });
        setResult({ ...data, ...preview });
      } else {
        setResult(data);
      }
      if (data.csv_check?.template_saved) {
        const saved = await api.get('/import/templates');
        setTemplates(saved.templates || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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

  const renameTemplate = async (template) => {
    const name = window.prompt('Template name', template.name);
    if (name === null || name.trim() === template.name) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api.patch(`/import/templates/${template.id}`, { name });
      setTemplates((previous) =>
        previous.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteTemplate = async (template) => {
    if (
      !window.confirm(
        `Delete the saved "${template.name}" template? Existing transactions are not changed.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api.del(`/import/templates/${template.id}`);
      setTemplates((previous) => previous.filter((item) => item.id !== template.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const templateCheck = result?.csv_check || result?.template_check;

  return (
    <div>
      <h1>Import statement</h1>
      <p className="muted">
        Upload your bank export (.csv, .xlsx, PDF, JPG, or PNG — Revolut files are detected
        automatically). Local OCR is the private default; the optional online OCR choice sends PDF
        page renders or images to the active AI provider. Configured AI is used to map extracted
        rows. Cancelled transactions are skipped; zero-value rows, fees, refunds, reverted entries,
        and pending entries remain available for review. Duplicates are skipped at confirmation.
      </p>

      <div
        className="card upload-card upload-dropzone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <p className="drop-hint">Drop a CSV, XLSX, PDF, JPG, or PNG file here</p>
        <label className="btn primary file-btn">
          {busy ? 'Processing…' : 'Upload CSV'}
          <input type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} hidden />
        </label>
        <label className="btn file-btn">
          Choose PDF, image, or Excel
          <input
            type="file"
            accept=".xlsx,.xls,.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={onFile}
            disabled={busy}
            hidden
          />
        </label>
        <label
          className="btn file-btn"
          title="AI detects the format of any bank export and converts it"
        >
          Analyze format with AI
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png,text/csv,application/pdf,image/jpeg,image/png"
            onChange={smartAnalyze}
            disabled={busy}
            hidden
          />
        </label>
        <label className="muted tiny" style={{ display: 'block', marginTop: 10 }}>
          OCR source for PDF/JPG/PNG
          <select value={ocrMode} onChange={(e) => setOcrMode(e.target.value)} disabled={busy}>
            <option value="local">Local OCR (private, recommended)</option>
            <option value="online" disabled={!aiSettings?.profile_id}>
              Online vision OCR{aiSettings?.profile_name ? ` · ${aiSettings.profile_name}` : ''}
            </option>
          </select>
        </label>
        <label className="muted tiny" style={{ display: 'block', marginTop: 10 }}>
          CSV and Excel template handling
          <select
            value={templateMode}
            onChange={(e) => {
              setTemplateMode(e.target.value);
              localStorage.setItem('bp-import-template-mode', e.target.value);
            }}
            disabled={busy}
          >
            <option value="reuse">Reuse matching saved templates</option>
            <option value="fresh">Start fresh and ignore saved templates</option>
          </select>
        </label>
        {ocrMode === 'online' && (
          <p className="muted tiny">
            The selected statement pages will be sent to your active AI provider for OCR. Use local
            OCR when the statement must stay on this server.
          </p>
        )}
        <p className="muted tiny import-template-note">
          PDF and image imports always require AI structuring after OCR. CSV and Excel imports use
          AI only when needed, or when you choose to start fresh.
        </p>
        {templates.length > 0 && (
          <p className="muted tiny import-template-note">
            {templates.length} saved CSV/Excel template(s). Matching files are imported directly
            without AI. Manage them below.
          </p>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      {templates.length > 0 && (
        <div className="card import-template-manager">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Saved import memory</p>
              <h2 style={{ fontSize: 18, margin: 0 }}>CSV and Excel templates</h2>
            </div>
            <span className="muted tiny">Mappings only, never bank files</span>
          </div>
          <p className="muted tiny">
            A template remembers how to read columns. Renaming or deleting one does not change
            transactions already imported.
          </p>
          <div className="import-template-list">
            {templates.map((template) => (
              <div className="import-template-item" key={template.id}>
                <div>
                  <strong>{template.name}</strong>
                  <div className="muted tiny">
                    {template.format === 'xlsx' ? 'Excel' : 'CSV'} · used {template.use_count}{' '}
                    time(s)
                  </div>
                  <div className="muted tiny">
                    Created {template.created_at} · last used {template.updated_at}
                  </div>
                  <div className="muted tiny">Headers: {template.headers.join(' · ')}</div>
                </div>
                <div className="inline-form">
                  <button className="btn" onClick={() => renameTemplate(template)} disabled={busy}>
                    Rename
                  </button>
                  <button className="btn" onClick={() => deleteTemplate(template)} disabled={busy}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {templateCheck?.status === 'needs_ai' && (
        <div className="card warn-box" role="status">
          <b>AI analysis recommended for this CSV.</b>
          <span>{templateCheck.issues.join(' ')}</span>
          <button
            className="btn primary"
            onClick={analyzeCsv}
            disabled={busy || !aiSettings?.profile_id}
          >
            {busy ? 'Analyzing…' : 'Analyze this CSV with AI'}
          </button>
          {!aiSettings?.profile_id && (
            <span className="muted tiny">Configure an AI profile first.</span>
          )}
        </div>
      )}

      {templateCheck?.status === 'ready' && (
        <div className="card success-box" role="status">
          <b>CSV is ready to import directly.</b> {result.csv_check.instruction}
        </div>
      )}

      {templateCheck?.status === 'template' && (
        <div className="card success-box" role="status">
          <b>Saved {templateCheck.format === 'xlsx' ? 'Excel' : 'CSV'} template matched.</b>{' '}
          {templateCheck.instruction}
        </div>
      )}

      {templateCheck?.status === 'analyzed' && (
        <div className="card success-box" role="status">
          <b>
            AI approved and saved this {templateCheck.format === 'xlsx' ? 'Excel' : 'CSV'}
            structure.
          </b>{' '}
          {result.ai_instruction}
        </div>
      )}

      {result?.ocr_structured_by_ai && (
        <div className="card success-box" role="status">
          <b>OCR text was structured by AI.</b> The extracted transactions were validated before
          import.
        </div>
      )}

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

      {result?.summary && (
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
              <div className="stat-label">Need a category</div>
              <div className="stat-value warn">{result.summary.needsReview}</div>
            </div>
            <div className="card stat">
              <div className="stat-label">Income / Expenses</div>
              <div className="stat-value small-value">
                {result.summary.income} / {result.summary.expenses}
              </div>
              {result.summary.zero > 0 && (
                <div className="stat-note">{result.summary.zero} zero-value row(s)</div>
              )}
            </div>
          </div>
          {result.stats && (
            <div className="card import-reconciliation" role="status">
              <b>Import reconciliation</b> {result.stats.source_rows ?? result.stats.total} source
              rows · {result.stats.total} checked · {result.stats.imported} transaction(s) parsed
              {result.summary.duplicates > 0 && ` · ${result.summary.duplicates} duplicate(s)`}
              {result.stats.skippedCancelled > 0 &&
                ` · ${result.stats.skippedCancelled} cancelled row(s) skipped`}
              {result.summary.zero > 0 && ` · ${result.summary.zero} zero-value row(s)`}
              {result.stats.invalid > 0 && ` · ${result.stats.invalid} invalid row(s)`}
            </div>
          )}
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
                        {pair.date} · {formatMoney(pair.amount, pair.currency)}
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
                    <td className={tx.amount >= 0 ? 'income' : 'expense'}>
                      {formatMoney(tx.amount, tx.currency)}
                    </td>
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
