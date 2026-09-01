import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatMoney } from '../api.js';
import { Modal, useDialogs } from '../components/Dialog.jsx';
import { useWorkingMonth } from '../components/WorkingMonth.jsx';

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const { month: workingMonth, setMonth: setWorkingMonth } = useWorkingMonth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [month, setMonth] = useState(params.get('month') || workingMonth);
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
  // Per-row "edit category" mode: { [tx.id]: { categoryId, fundId, transferGroup, remember } }
  const [editingCategory, setEditingCategory] = useState({});
  const [editFunds, setEditFunds] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    date: '',
    description: '',
    amount: '',
    currency: 'EUR',
    account_id: '',
    category_id: '',
    fund_id: '',
    tx_type: '',
    transfer_group: '',
  });
  const [addAccounts, setAddAccounts] = useState([]);
  const [addFunds, setAddFunds] = useState([]);
  const [addError, setAddError] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const { confirm } = useDialogs();

  // The URL is the source of truth for the filter: the toggle button updates
  // the params, and this effect keeps the state (and list) in sync — clicking
  // a "needs review" link while already on the page now refilters too.
  useEffect(() => {
    setReviewOnly(params.get('review') === '1');
    setMonth(params.get('month') || workingMonth);
  }, [params, workingMonth]);

  // A request-sequence guard: the newest request wins, so fast month/filter
  // switching can never let an older response clobber a newer one.
  const loadSeq = useRef(0);
  const load = () => {
    const seq = ++loadSeq.current;
    const q = new URLSearchParams();
    if (month) q.set('month', month);
    if (review) q.set('review', '1');
    api
      .get(`/transactions?${q}`)
      .then((d) => {
        if (seq !== loadSeq.current) return;
        setRows(d.rows);
        setTotal(d.total);
      })
      .catch((e) => {
        if (seq === loadSeq.current) setError(e.message);
      });
  };

  useEffect(() => {
    api.get('/categories').then(setCategories);
  }, []);

  const openAdd = async () => {
    const today = new Date().toISOString().slice(0, 10);
    setAddForm({
      date: today,
      description: '',
      amount: '',
      currency: 'EUR',
      account_id: '',
      category_id: '',
      fund_id: '',
      tx_type: '',
      transfer_group: '',
    });
    setAddError('');
    setAddOpen(true);
    if (addAccounts.length === 0) {
      try {
        const meta = await api.get('/categories/meta/all');
        setAddAccounts(meta.accounts ?? []);
      } catch {
        /* leave the select empty; user can retry */
      }
    }
    if (addFunds.length === 0) {
      try {
        const f = await api.get('/funds');
        setAddFunds(f.funds ?? []);
      } catch {
        /* no funds */
      }
    }
  };

  const submitAdd = async (e) => {
    e?.preventDefault?.();
    if (addBusy) return;
    setAddError('');
    const amt = Number(addForm.amount);
    if (!addForm.date || !addForm.description.trim() || !Number.isFinite(amt) || amt === 0) {
      setAddError('Date, description and a non-zero amount are required.');
      return;
    }
    setAddBusy(true);
    try {
      await api.post('/transactions', {
        date: addForm.date,
        description: addForm.description.trim(),
        amount: amt,
        currency: addForm.currency,
        account_id: addForm.account_id || null,
        category_id: addForm.category_id || null,
        fund_id: addForm.fund_id || null,
        tx_type: addForm.tx_type || null,
        transfer_group: addForm.transfer_group || null,
      });
      setAddOpen(false);
      load();
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAddBusy(false);
    }
  };
  useEffect(() => {
    load();
  }, [month, review]);

  const assign = async (tx, categoryId, remember) => {
    try {
      await api.patch(`/transactions/${tx.id}`, { category_id: categoryId, remember });
      setError('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const startEditCategory = (tx) => {
    setEditingCategory((p) => ({
      ...p,
      [tx.id]: {
        categoryId: tx.category_id || '',
        fundId: tx.fund_id || '',
        transferGroup: tx.transfer_group || '',
        remember: true,
      },
    }));
    if (editFunds.length === 0) {
      api
        .get('/funds')
        .then((d) => setEditFunds(d.funds ?? []))
        .catch(() => {});
    }
  };
  const cancelEditCategory = (tx) => {
    setEditingCategory((p) => {
      const next = { ...p };
      delete next[tx.id];
      return next;
    });
  };
  const saveEditCategory = async (tx) => {
    const edit = editingCategory[tx.id];
    if (!edit) return;
    try {
      const body = {
        category_id: edit.categoryId ? Number(edit.categoryId) : null,
        fund_id: edit.fundId ? Number(edit.fundId) : null,
        transfer_group: edit.transferGroup ? String(edit.transferGroup).trim() : null,
        remember: !!edit.remember,
      };
      await api.patch(`/transactions/${tx.id}`, body);
      setError('');
      cancelEditCategory(tx);
      load();
    } catch (e) {
      setError(e.message);
    }
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
    try {
      await api.patch(`/transactions/${s.id}`, { category_id: s.category_id, remember: true });
      setSuggestions((p) => p?.filter((x) => x.id !== s.id) ?? null);
      load();
    } catch (e) {
      setError(e.message);
    }
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
    try {
      await api.post(`/transactions/${tx.id}/unsplit`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const openAttachments = (tx) => {
    setAttTx(tx);
    setAttError('');
    api
      .get(`/attachments?transaction_id=${tx.id}`)
      .then((d) => setAttList(d.attachments))
      .catch((e) => {
        setAttList([]);
        setAttError(e.message);
      });
  };

  const refreshAttachments = () => {
    api
      .get(`/attachments?transaction_id=${attTx.id}`)
      .then((d) => setAttList(d.attachments))
      .catch((e) => setAttError(e.message));
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
    try {
      await api.del(`/attachments/${att.id}`);
      refreshAttachments();
    } catch (err) {
      setAttError(err.message);
    }
  };

  const formatSize = (n) =>
    n < 1024
      ? `${n} B`
      : n < 1024 * 1024
        ? `${Math.round(n / 1024)} KB`
        : `${(n / (1024 * 1024)).toFixed(1)} MB`;

  const applyMany = async (minConfidence) => {
    const list = suggestions.filter((s) => s.confidence >= minConfidence);
    let applied = 0;
    let failed = 0;
    for (const s of list) {
      try {
        await api.patch(`/transactions/${s.id}`, { category_id: s.category_id, remember: true });
        applied++;
      } catch {
        failed++;
      }
    }
    if (failed) setError(`${applied} applied, ${failed} failed — try again for the rest.`);
    setSuggestions((p) => (p ?? []).filter((s) => s.confidence < minConfidence));
    load();
  };

  return (
    <div>
      <h1>
        {review ? 'Needs review' : 'Transactions'} <span className="muted h-count">({total})</span>
      </h1>

      <div className="filters card">
        <label>
          Month
          <input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setWorkingMonth(e.target.value);
            }}
          />
        </label>
        <button
          className={`btn ghost ${review ? 'active' : ''}`}
          onClick={() => {
            const p = new URLSearchParams(params);
            if (review) {
              p.delete('review');
            } else {
              p.set('review', '1');
            }
            setParams(p);
          }}
        >
          {review ? 'Showing needs-review' : 'Show needs-review only'}
        </button>
        {month && (
          <button className="btn ghost" title="Show every month" onClick={() => setMonth('')}>
            Clear month
          </button>
        )}
        <button
          className="btn"
          title="Add a single transaction by hand (no CSV import needed)"
          onClick={openAdd}
        >
          + Add transaction
        </button>
        <button
          className="btn"
          onClick={suggestWithAi}
          disabled={aiBusy}
          title="Ask the AI to suggest a category for every needs-review transaction in the current view"
        >
          {aiBusy ? 'Asking AI…' : 'Suggest categories with AI'}
        </button>
        {suggestions?.length > 0 && (
          <>
            <button
              className="btn primary"
              title="Apply every AI suggestion"
              onClick={() => applyMany(0)}
            >
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
      </div>
      {error && (
        <div className="error" style={{ margin: '0 0 10px 4px' }}>
          {error}
        </div>
      )}

      {rows.length === 0 && <div className="card empty">Nothing here.</div>}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Amount</th>
              <th style={{ minWidth: 260 }}>Category</th>
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
                    title={
                      tx.attachment_count > 0
                        ? `${tx.attachment_count} attachment(s)`
                        : 'Add attachments'
                    }
                    onClick={() => openAttachments(tx)}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                    {tx.attachment_count > 0 ? tx.attachment_count : ''}
                  </button>
                </td>
                <td className={tx.amount >= 0 ? 'income' : 'expense'}>
                  {formatMoney(tx.amount, tx.currency)}
                  {tx.currency &&
                    tx.currency !== (localStorage.getItem('bp-currency') || 'EUR') && (
                      <span className="muted tiny" title={`recorded in ${tx.currency}`}>
                        {' '}
                        {tx.currency}
                      </span>
                    )}
                </td>
                <td>
                  {tx.transfer_group ? (
                    <span
                      className="pill-badge accent-badge"
                      title={`Bank↔card transfer (group: ${tx.transfer_group}) — not counted as spend or income`}
                    >
                      transfer
                    </span>
                  ) : (
                    ''
                  )}
                  {tx.fund_name ? (
                    <span
                      className="pill-badge"
                      style={{ background: 'var(--blue)', marginLeft: 4 }}
                      title="Drawn from this sinking fund"
                    >
                      → {tx.fund_name}
                    </span>
                  ) : (
                    ''
                  )}
                  {editingCategory[tx.id] ? (
                    <div className="assign assign-edit">
                      <select
                        title="Category for this transaction"
                        value={editingCategory[tx.id].categoryId}
                        onChange={(e) =>
                          setEditingCategory((p) => ({
                            ...p,
                            [tx.id]: { ...p[tx.id], categoryId: e.target.value },
                          }))
                        }
                      >
                        <option value="">No category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <select
                        title="Pay this transaction from a sinking fund (draws the fund balance down)"
                        value={editingCategory[tx.id].fundId}
                        onChange={(e) =>
                          setEditingCategory((p) => ({
                            ...p,
                            [tx.id]: { ...p[tx.id], fundId: e.target.value },
                          }))
                        }
                      >
                        <option value="">No fund</option>
                        {editFunds.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Transfer id (optional)"
                        title="If this row is part of a bank↔card transfer, enter a token shared by both sides. Both rows stop counting as spend/income."
                        style={{ width: 160 }}
                        value={editingCategory[tx.id].transferGroup}
                        onChange={(e) =>
                          setEditingCategory((p) => ({
                            ...p,
                            [tx.id]: { ...p[tx.id], transferGroup: e.target.value },
                          }))
                        }
                      />
                      <label
                        className="remember-toggle"
                        title="Save a rule so this merchant auto-categorizes next time"
                      >
                        <input
                          type="checkbox"
                          checked={!!editingCategory[tx.id].remember}
                          onChange={(e) =>
                            setEditingCategory((p) => ({
                              ...p,
                              [tx.id]: { ...p[tx.id], remember: e.target.checked },
                            }))
                          }
                        />
                        <span className="muted tiny">remember</span>
                      </label>
                      <button
                        className="btn small primary"
                        title="Save the changes"
                        onClick={() => saveEditCategory(tx)}
                      >
                        Save
                      </button>
                      <button
                        className="btn ghost small"
                        title="Cancel without changing"
                        onClick={() => cancelEditCategory(tx)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : tx.category_name && !tx.needs_review ? (
                    <div className="assign">
                      <span
                        className="cat-chip"
                        style={{ background: tx.category_color || '#5E8BD9' }}
                      >
                        {tx.category_name}
                      </span>
                      {tx.split_parts > 0 && (
                        <button
                          className="btn ghost small"
                          title={`Remove the split (${tx.split_parts} parts) and return to the full amount`}
                          onClick={() => unsplit(tx)}
                        >
                          Unsplit
                        </button>
                      )}
                      {!tx.split_of && !tx.split_group && (
                        <button
                          className="btn ghost small"
                          title="Split this transaction across several categories"
                          onClick={() => openSplit(tx)}
                        >
                          Split
                        </button>
                      )}
                      <button
                        className="btn ghost small"
                        title="Change the category for this transaction"
                        onClick={() => startEditCategory(tx)}
                      >
                        Edit
                      </button>
                    </div>
                  ) : sugFor(tx.id) ? (
                    <div className="assign">
                      <span className="cat-chip ai-chip">
                        {sugFor(tx.id).category} · {Math.round(sugFor(tx.id).confidence * 100)}%
                      </span>
                      <button
                        className="btn small primary"
                        onClick={() => applySuggestion(sugFor(tx.id))}
                      >
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
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <span
                        className="muted tiny"
                        title="The merchant will be remembered for next time"
                      >
                        remembered for next time
                      </span>
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
            Original amount:{' '}
            <b className={splitTx.amount >= 0 ? 'income' : 'expense'}>
              {formatMoney(splitTx.amount, splitTx.currency)}
            </b>{' '}
            · parts must add up to it.
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
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                placeholder="Amount"
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
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="split-summary">
            <span
              className={
                Math.abs(
                  splitParts.reduce((s, p) => s + (Number(p.amount) || 0), 0) - splitTx.amount,
                ) <= 0.01
                  ? 'good'
                  : 'bad'
              }
            >
              {formatMoney(
                splitParts.reduce((s, p) => s + (Number(p.amount) || 0), 0),
                splitTx.currency,
              )}{' '}
              of {formatMoney(splitTx.amount, splitTx.currency)}
            </span>
            <button
              className="btn ghost small"
              onClick={() => setSplitParts([...splitParts, { category_id: '', amount: '' }])}
            >
              + Add part
            </button>
          </div>
          {splitError && (
            <div className="error" role="alert" style={{ margin: '8px 0' }}>
              {splitError}
            </div>
          )}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setSplitTx(null)}>
              Cancel
            </button>
            <button className="btn primary" onClick={submitSplit}>
              Save split
            </button>
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
            <b className={attTx.amount >= 0 ? 'income' : 'expense'}>
              {formatMoney(attTx.amount, attTx.currency)}
            </b>{' '}
            on {attTx.date} · PDF, PNG, JPEG, WebP or CSV up to 10 MB.
          </p>
          {attList === null ? (
            <div className="muted" style={{ margin: '10px 0' }}>
              Loading…
            </div>
          ) : attList.length === 0 ? (
            <div className="muted" style={{ margin: '10px 0' }}>
              No attachments yet.
            </div>
          ) : (
            <div className="att-list">
              {attList.map((a) => (
                <div key={a.id} className="att-row">
                  <div className="att-main">
                    <strong>{a.original_name}</strong>
                    <small className="muted">
                      {formatSize(a.size)} · {a.created_at.slice(0, 10)}
                    </small>
                  </div>
                  <div className="env-actions">
                    <a className="btn small" href={`/api/attachments/${a.id}/file`}>
                      Download
                    </a>
                    <button className="btn danger small" onClick={() => deleteAttachment(a)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {attError && (
            <div className="error" role="alert" style={{ margin: '8px 0' }}>
              {attError}
            </div>
          )}
          <div className="modal-actions">
            <label className="btn primary file-btn">
              Add file…
              <input
                type="file"
                hidden
                accept=".pdf,.png,.jpg,.jpeg,.webp,.csv"
                onChange={uploadAttachment}
              />
            </label>
            <button className="btn ghost" onClick={() => setAttTx(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {addOpen && (
        <Modal title="Add transaction" onClose={() => setAddOpen(false)} width={460}>
          <form onSubmit={submitAdd} className="add-tx-form">
            <label className="modal-label" htmlFor="add-tx-date">
              Date
            </label>
            <input
              id="add-tx-date"
              type="date"
              value={addForm.date}
              onChange={(e) => setAddForm({ ...addForm, date: e.target.value })}
              required
              autoFocus
            />
            <label className="modal-label" htmlFor="add-tx-desc">
              Description
            </label>
            <input
              id="add-tx-desc"
              type="text"
              maxLength={200}
              placeholder="e.g. REWE SAGT DANKE"
              value={addForm.description}
              onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
              required
            />
            <label className="modal-label" htmlFor="add-tx-amount">
              Amount{' '}
              <span className="muted tiny">(negative = spend, positive = refund/income)</span>
            </label>
            <input
              id="add-tx-amount"
              type="number"
              step="0.01"
              placeholder="-12.50"
              value={addForm.amount}
              onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })}
              required
            />
            <div className="add-tx-row">
              <label className="modal-label" htmlFor="add-tx-cur">
                Currency
              </label>
              <select
                id="add-tx-cur"
                value={addForm.currency}
                onChange={(e) => setAddForm({ ...addForm, currency: e.target.value })}
              >
                {['EUR', 'USD', 'GBP', 'CHF'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <label className="modal-label" htmlFor="add-tx-type">
                Type <span className="muted tiny">(optional)</span>
              </label>
              <input
                id="add-tx-type"
                type="text"
                maxLength={40}
                placeholder="e.g. Card"
                value={addForm.tx_type}
                onChange={(e) => setAddForm({ ...addForm, tx_type: e.target.value })}
              />
            </div>
            <label className="modal-label" htmlFor="add-tx-acc">
              Account
            </label>
            <select
              id="add-tx-acc"
              value={addForm.account_id}
              onChange={(e) => setAddForm({ ...addForm, account_id: e.target.value })}
            >
              <option value="">Unassigned…</option>
              {addAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <label className="modal-label" htmlFor="add-tx-cat">
              Category
            </label>
            <select
              id="add-tx-cat"
              title="Leave empty to put this row in the needs-review queue"
              value={addForm.category_id}
              onChange={(e) => setAddForm({ ...addForm, category_id: e.target.value })}
            >
              <option value="">Needs review (uncategorized)…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="modal-label" htmlFor="add-tx-fund">
              Fund <span className="muted tiny">(optional, draws the fund balance)</span>
            </label>
            <select
              id="add-tx-fund"
              title="Pay this transaction from a sinking fund"
              value={addForm.fund_id}
              onChange={(e) => setAddForm({ ...addForm, fund_id: e.target.value })}
            >
              <option value="">No fund</option>
              {addFunds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <label className="modal-label" htmlFor="add-tx-xfer">
              Transfer group <span className="muted tiny">(optional)</span>
            </label>
            <input
              id="add-tx-xfer"
              type="text"
              maxLength={80}
              placeholder="e.g. xfer-2026-08-15"
              title="If this row is part of a bank↔card transfer, enter the same token used for the other side. Both rows stop counting as spend or income."
              value={addForm.transfer_group}
              onChange={(e) => setAddForm({ ...addForm, transfer_group: e.target.value })}
            />
            {addError && (
              <div className="error" role="alert" style={{ margin: '8px 0' }}>
                {addError}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={addBusy}>
                {addBusy ? 'Saving…' : 'Add transaction'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
