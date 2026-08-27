import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, eur, currentMonth, monthLabel } from '../api.js';
import { Modal, useDialogs } from '../components/Dialog.jsx';

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [month, setMonth] = useState(params.get('month') || '');
  const [review, setReviewOnly] = useState(params.get('review') === '1');
  const [suggestions, setSuggestions] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState('');
  const [splitTx, setSplitTx] = useState(null);
  const [splitParts, setSplitParts] = useState([]);
  const [splitError, setSplitError] = useState('');
  const [attTx, setAttTx] = useState(null);
  const [attList, setAttList] = useState(null);
  const [attError, setAttError] = useState('');
  const { confirm } = useDialogs();

  const load = () => {
    const q = new URLSearchParams();
    if (month) q.set('month', month);
    if (review) q.set('review', '1');
    api.get(`/transactions?${q}`).then((d) => {
      setRows(d.rows);
      setTotal(d.total);
    }).catch((e) => setError(e.message));
  };

  useEffect(() => {
    api.get('/categories').then(setCategories);
  }, []);
  useEffect(() => { load(); }, [month, review]);

  const assign = async (tx, categoryId, remember) => {
    await api.patch(`/transactions/${tx.id}`, { category_id: categoryId, remember });
    load();
  };

  const suggestWithAi = async () => {
    setAiBusy(true);
    setError('');
    try {
      const r = await api.post('/ai/suggest-categories', {});
      setSuggestions(r.suggestions);
      if (!r.suggestions.length) setError('Nothing to suggest — queue is empty.');
    } catch (e) {
      setError(e.message);
    } finally {
      setAiBusy(false);
    }
  };

  const applySuggestion = async (s) => {
    await api.patch(`/transactions/${s.id}`, { category_id: s.category_id, remember: true });
    setSuggestions((p) => p?.filter((x) => x.id !== s.id) ?? null);
    load();
  };

  const sugFor = (txId) => suggestions?.find((s) => s.id === txId);

  const openSplit = (tx) => {
    setSplitTx(tx);
    setSplitParts([
      { category_id: '', amount: '' },
      { category_id: '', amount: '' },
    ]);
    setSplitError('');
  };

  const submitSplit = async () => {
    setSplitError('');
    const parts = splitParts.filter((p) => p.category_id && Number(p.amount));
    try {
      await api.post(`/transactions/${splitTx.id}/split`, { parts });
      setSplitTx(null);
      load();
    } catch (e) {
      setSplitError(e.message);
    }
  };

  const unsplit = async (tx) => {
    const ok = await confirm({
      title: 'Undo this split?',
      message: 'The parts are removed and the original full amount returns to "needs review".',
      danger: true,
      confirmLabel: 'Undo split',
    });
    if (!ok) return;
    await api.post(`/transactions/${tx.id}/unsplit`);
    load();
  };

  const openAttachments = (tx) => {
    setAttTx(tx);
    setAttError('');
    api.get(`/attachments?transaction_id=${tx.id}`)
      .then((d) => setAttList(d.attachments))
      .catch((e) => { setAttList([]); setAttError(e.message); });
  };

  const refreshAttachments = () => {
    api.get(`/attachments?transaction_id=${attTx.id}`).then((d) => setAttList(d.attachments));
    load();
  };

  const uploadAttachment = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAttError('');
    try {
      await api.upload('/attachments', file, { transaction_id: attTx.id });
      refreshAttachments();
    } catch (err) {
      setAttError(err.message);
    }
  };

  const deleteAttachment = async (att) => {
    const ok = await confirm({
      title: 'Delete attachment?',
      message: att.original_name,
      danger: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    await api.del(`/attachments/${att.id}`);
    refreshAttachments();
  };

  const formatSize = (n) =>
    n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`;

  const applyMany = async (minConfidence) => {
    const list = suggestions.filter((s) => s.confidence >= minConfidence);
    for (const s of list) {
      await api.patch(`/transactions/${s.id}`, { category_id: s.category_id, remember: true });
    }
    setSuggestions((p) => (p ?? []).filter((s) => s.confidence < minConfidence));
    load();
  };

  return (
    <div>
      <h1>{review ? 'Needs review' : 'Transactions'} <span className="muted h-count">({total})</span></h1>

      <div className="filters card">
        <label>
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <button
          className={`btn ghost ${review ? 'active' : ''}`}
          onClick={() => {
            const p = new URLSearchParams(params);
            if (review) { p.delete('review'); } else { p.set('review', '1'); }
            setParams(p);
          }}
        >
          {review ? 'Showing needs-review' : 'Show needs-review only'}
        </button>
        {month && (
          <button className="btn ghost" onClick={() => setMonth('')}>Clear month</button>
        )}
        {review && (
          <>
            <button className="btn" onClick={suggestWithAi} disabled={aiBusy}>
              {aiBusy ? 'Asking AI…' : 'Suggest categories with AI'}
            </button>
            {suggestions?.length > 0 && (
              <>
                <button className="btn primary" onClick={() => applyMany(0)}>
                  Apply all ({suggestions.length})
                </button>
                <button
                  className="btn"
                  title="Only apply suggestions with 80% confidence or higher"
                  onClick={() => applyMany(0.8)}
                >
                  Apply ≥80% ({suggestions.filter((s) => s.confidence >= 0.8).length})
                </button>
              </>
            )}
          </>
        )}
      </div>
      {error && <div className="error" style={{ margin: '0 0 10px 4px' }}>{error}</div>}

      {rows.length === 0 && <div className="card empty">Nothing here.</div>}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Description</th><th>Amount</th><th style={{ minWidth: 260 }}>Category</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tx) => (
              <tr key={tx.id} className={tx.needs_review ? 'needs-review-row' : ''}>
                <td>{tx.date}</td>
                <td>
                  {tx.description}
                  {tx.tx_type && <span className="muted type-tag">{tx.tx_type}</span>}
                  {tx.split_parts > 0 && (
                    <span className="pill-badge accent-badge">split · {tx.split_parts}</span>
                  )}
                  {tx.split_of && (
                    <span className="muted tiny" title={tx.split_parent_desc}>
                      part of {tx.split_parent_desc}
                    </span>
                  )}
                  <button
                    className={`btn ghost small clip-btn${tx.attachment_count > 0 ? ' has-attachments' : ''}`}
                    title={tx.attachment_count > 0 ? `${tx.attachment_count} attachment(s)` : 'Add attachments'}
                    onClick={() => openAttachments(tx)}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                    {tx.attachment_count > 0 ? tx.attachment_count : ''}
                  </button>
                </td>
                <td className={tx.amount >= 0 ? 'income' : 'expense'}>
                  {eur(tx.amount)}
                  {tx.currency && tx.currency !== (localStorage.getItem('bp-currency') || 'EUR') && (
                    <span className="muted tiny" title={`recorded in ${tx.currency}`}> {tx.currency}</span>
                  )}
                </td>
                <td>
                  {tx.category_name && !tx.needs_review ? (
                    <div className="assign">
                      <span className="cat-chip" style={{ background: tx.category_color || '#5E8BD9' }}>
                        {tx.category_name}
                      </span>
                      {tx.split_parts > 0 && (
                        <button className="btn ghost small" onClick={() => unsplit(tx)}>Unsplit</button>
                      )}
                      {!tx.split_of && !tx.split_group && (
                        <button className="btn ghost small" onClick={() => openSplit(tx)}>Split</button>
                      )}
                    </div>
                  ) : sugFor(tx.id) ? (
                    <div className="assign">
                      <span className="cat-chip ai-chip">
                        {sugFor(tx.id).category} · {Math.round(sugFor(tx.id).confidence * 100)}%
                      </span>
                      <button className="btn small primary" onClick={() => applySuggestion(sugFor(tx.id))}>
                        Apply
                      </button>
                    </div>
                  ) : (
                    <div className="assign">
                      <select
                        defaultValue=""
                        onChange={(e) => e.target.value && assign(tx, Number(e.target.value), true)}
                      >
                        <option value="">Assign category…</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <span className="muted tiny">remembered for next time</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {splitTx && (
        <Modal
          title={`Split — ${splitTx.description}`}
          onClose={() => setSplitTx(null)}
          width={520}
        >
          <p className="modal-message">
            Original amount: <b className={splitTx.amount >= 0 ? 'income' : 'expense'}>{eur(splitTx.amount)}</b> ·
            parts must add up to it.
          </p>
          {splitParts.map((p, i) => (
            <div key={i} className="split-row">
              <select
                aria-label={`Part ${i + 1} category`}
                value={p.category_id}
                onChange={(e) => {
                  const next = [...splitParts];
                  next[i] = { ...p, category_id: e.target.value };
                  setSplitParts(next);
                }}
              >
                <option value="">Category…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input
                type="number" step="0.01" placeholder="Amount"
                aria-label={`Part ${i + 1} amount`}
                value={p.amount}
                onChange={(e) => {
                  const next = [...splitParts];
                  next[i] = { ...p, amount: e.target.value };
                  setSplitParts(next);
                }}
              />
              {splitParts.length > 2 && (
                <button
                  className="btn ghost small"
                  aria-label={`Remove part ${i + 1}`}
                  onClick={() => setSplitParts(splitParts.filter((_, j) => j !== i))}
                >✕</button>
              )}
            </div>
          ))}
          <div className="split-summary">
            <span className={Math.abs(splitParts.reduce((s, p) => s + (Number(p.amount) || 0), 0) - splitTx.amount) <= 0.01 ? 'good' : 'bad'}>
              {eur(splitParts.reduce((s, p) => s + (Number(p.amount) || 0), 0))} of {eur(splitTx.amount)}
            </span>
            <button className="btn ghost small" onClick={() => setSplitParts([...splitParts, { category_id: '', amount: '' }])}>
              + Add part
            </button>
          </div>
          {splitError && <div className="error" role="alert" style={{ margin: '8px 0' }}>{splitError}</div>}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setSplitTx(null)}>Cancel</button>
            <button className="btn primary" onClick={submitSplit}>Save split</button>
          </div>
        </Modal>
      )}

      {attTx && (
        <Modal
          title={`Attachments — ${attTx.description}`}
          onClose={() => setAttTx(null)}
          width={520}
        >
          <p className="modal-message">
            <b className={attTx.amount >= 0 ? 'income' : 'expense'}>{eur(attTx.amount)}</b> on {attTx.date} ·
            PDF, PNG, JPEG, WebP or CSV up to 10 MB.
          </p>
          {attList === null ? (
            <div className="muted" style={{ margin: '10px 0' }}>Loading…</div>
          ) : attList.length === 0 ? (
            <div className="muted" style={{ margin: '10px 0' }}>No attachments yet.</div>
          ) : (
            <div className="att-list">
              {attList.map((a) => (
                <div key={a.id} className="att-row">
                  <div className="att-main">
                    <strong>{a.original_name}</strong>
                    <small className="muted">{formatSize(a.size)} · {a.created_at.slice(0, 10)}</small>
                  </div>
                  <div className="env-actions">
                    <a className="btn small" href={`/api/attachments/${a.id}/file`}>Download</a>
                    <button className="btn danger small" onClick={() => deleteAttachment(a)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {attError && <div className="error" role="alert" style={{ margin: '8px 0' }}>{attError}</div>}
          <div className="modal-actions">
            <label className="btn primary file-btn">
              Add file…
              <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.csv" onChange={uploadAttachment} />
            </label>
            <button className="btn ghost" onClick={() => setAttTx(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
