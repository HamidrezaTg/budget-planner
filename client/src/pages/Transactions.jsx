import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatMoney } from '../api.js';
import { Modal, useDialogs } from '../components/Dialog.jsx';
import { useWorkingMonth } from '../components/WorkingMonth.jsx';

const PAGE_SIZE = 50;

export default function Transactions() {
  const [params, setParams] = useSearchParams();
  const { month: workingMonth, setMonth: setWorkingMonth } = useWorkingMonth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [month, setMonth] = useState(params.get('month') || workingMonth);
  const [review, setReviewOnly] = useState(params.get('review') === '1');
  const [page, setPage] = useState(0);
  const [suggestions, setSuggestions] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState('');
  const [splitTx, setSplitTx] = useState(null);
  const [splitParts, setSplitParts] = useState([]);
  const [splitError, setSplitError] = useState('');
  const [attTx, setAttTx] = useState(null);
  const [attList, setAttList] = useState(null);
  const [attError, setAttError] = useState('');
  const [transferCandidates, setTransferCandidates] = useState(null);
  const [transferError, setTransferError] = useState('');
  // Per-row transaction editor: { [tx.id]: { accountId, categoryId, fundId, commitmentId, remember } }
  const [editingCategory, setEditingCategory] = useState({});
  const [editFunds, setEditFunds] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    date: '',
    description: '',
    amount: '',
    currency: 'EUR',
    account_id: '',
    transfer_to_account_id: '',
    category_id: '',
    fund_id: '',
    commitment_id: '',
    tx_type: '',
    is_transfer: false,
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
    setPage(0);
  }, [params, workingMonth]);

  // A request-sequence guard: the newest request wins, so fast month/filter
  // switching can never let an older response clobber a newer one.
  const loadSeq = useRef(0);
  const load = () => {
    const seq = ++loadSeq.current;
    const q = new URLSearchParams();
    if (month) q.set('month', month);
    if (review) q.set('review', '1');
    q.set('limit', PAGE_SIZE);
    q.set('offset', page * PAGE_SIZE);
    api
      .get(`/transactions?${q}`)
      .then((d) => {
        if (seq !== loadSeq.current) return;
        setRows(d.rows);
        setTotal(d.total);
        setError('');
      })
      .catch((e) => {
        if (seq === loadSeq.current) setError(e.message);
      });
  };

  useEffect(() => {
    api.get('/categories').then(setCategories);
    api.get('/categories/meta/all').then((m) => setAccounts(m.accounts ?? []));
    api
      .get('/commitments')
      .then(setCommitments)
      .catch(() => {});
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
      commitment_id: '',
      tx_type: '',
      transfer_to_account_id: '',
      is_transfer: false,
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
      if (addForm.is_transfer) {
        await api.post('/transactions/transfer', {
          date: addForm.date,
          description: addForm.description.trim(),
          amount: Math.abs(amt),
          currency: addForm.currency,
          source_account_id: addForm.account_id,
          target_account_id: addForm.transfer_to_account_id,
        });
      } else {
        await api.post('/transactions', {
          date: addForm.date,
          description: addForm.description.trim(),
          amount: amt,
          currency: addForm.currency,
          account_id: addForm.account_id || null,
          category_id: addForm.category_id || null,
          fund_id: addForm.fund_id || null,
          commitment_id: addForm.commitment_id || null,
          tx_type: addForm.tx_type || null,
        });
      }
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
  }, [month, review, page]);

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    if (page > lastPage) setPage(lastPage);
  }, [page, total]);

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
        accountId: tx.account_id || '',
        categoryId: tx.category_id || '',
        fundId: tx.fund_id || '',
        commitmentId: tx.commitment_id || '',
        remember: true,
      },
    }));
    if (editFunds.length === 0)
      api
        .get('/funds')
        .then((d) => setEditFunds(d.funds ?? []))
        .catch(() => {});
    if (accounts.length === 0)
      api
        .get('/categories/meta/all')
        .then((m) => setAccounts(m.accounts ?? []))
        .catch(() => {});
    if (commitments.length === 0)
      api
        .get('/commitments')
        .then(setCommitments)
        .catch(() => {});
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
        account_id: edit.accountId ? Number(edit.accountId) : null,
        category_id: edit.categoryId ? Number(edit.categoryId) : null,
        fund_id: edit.fundId ? Number(edit.fundId) : null,
        commitment_id: edit.commitmentId ? Number(edit.commitmentId) : null,
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

  const deleteTransaction = async (tx) => {
    const paired = !!tx.transfer_group;
    const ok = await confirm({
      title: paired ? 'Delete both transfer entries?' : 'Delete transaction?',
      message: paired
        ? `${tx.description} is paired with another account entry. Both sides will be permanently deleted.`
        : `${tx.description} · ${formatMoney(tx.amount, tx.currency)}. This cannot be undone.`,
      danger: true,
      confirmLabel: paired ? 'Delete both' : 'Delete',
    });
    if (!ok) return;
    try {
      await api.del(`/transactions/${tx.id}${paired ? '?delete_partner=true' : ''}`);
      setEditingCategory((p) => {
        const next = { ...p };
        delete next[tx.id];
        return next;
      });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const loadTransferCandidates = async () => {
    setTransferError('');
    try {
      const data = await api.get('/transactions/transfer/candidates');
      setTransferCandidates(data.candidates ?? []);
    } catch (e) {
      setTransferError(e.message);
    }
  };

  const pairTransfer = async (candidate) => {
    try {
      await api.post('/transactions/transfer/pair', {
        transaction_a_id: candidate.transaction_a_id,
        transaction_b_id: candidate.transaction_b_id,
      });
      setTransferCandidates((p) =>
        p?.filter(
          (item) =>
            item.transaction_a_id !== candidate.transaction_a_id &&
            item.transaction_b_id !== candidate.transaction_b_id,
        ),
      );
      load();
    } catch (e) {
      setTransferError(e.message);
    }
  };

  const unpairTransfer = async (tx) => {
    try {
      await api.post(`/transactions/${tx.id}/unpair`);
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
              setPage(0);
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
            setPage(0);
            setParams(p);
          }}
        >
          {review ? 'Showing needs-review' : 'Show needs-review only'}
        </button>
        {month && (
          <button
            className="btn ghost"
            title="Show every month"
            onClick={() => {
              setMonth('');
              setPage(0);
            }}
          >
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
          className={`btn ${transferCandidates ? 'active' : ''}`}
          title="Find unpaired transactions that may be transfers between your accounts"
          onClick={loadTransferCandidates}
        >
          Pair transfers
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

      {transferCandidates && (
        <div className="card transfer-review transaction-transfer-review">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Move money, do not spend it</p>
              <h2 style={{ fontSize: 18, margin: 0 }}>Possible transfer pairs</h2>
            </div>
            <button className="btn ghost small" onClick={() => setTransferCandidates(null)}>
              Close
            </button>
          </div>
          <p className="muted tiny">
            Pair opposite entries from different accounts. Paired rows are excluded from spending
            and income totals.
          </p>
          {transferError && <div className="error">{transferError}</div>}
          {transferCandidates.length === 0 ? (
            <p className="muted">No unpaired matches found.</p>
          ) : (
            <div className="transfer-options">
              {transferCandidates.slice(0, 30).map((candidate) => (
                <div
                  key={`${candidate.transaction_a_id}-${candidate.transaction_b_id}`}
                  className="transfer-option"
                >
                  <span>
                    <strong>
                      {formatMoney(candidate.amount, candidate.transaction_a.currency)}{' '}
                      {candidate.same_date
                        ? `· ${candidate.transaction_a.date}`
                        : '· different dates'}
                    </strong>
                    <span className="muted tiny">
                      {candidate.transaction_a.account_name}: {candidate.transaction_a.description}{' '}
                      ↔ {candidate.transaction_b.account_name}:{' '}
                      {candidate.transaction_b.description}
                    </span>
                  </span>
                  <button className="btn primary small" onClick={() => pairTransfer(candidate)}>
                    Pair
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {rows.length === 0 && <div className="card empty">Nothing here.</div>}

      <div className="card table-card">
        <table id="transactions-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Account</th>
              <th>Amount</th>
              <th style={{ minWidth: 260 }}>Category</th>
              <th></th>
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
                <td>{tx.account_name || <span className="muted">Unassigned</span>}</td>
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
                  {tx.commitment_name ? (
                    <span
                      className="pill-badge"
                      style={{ background: 'var(--teal, var(--blue))', marginLeft: 4 }}
                      title="This payment is attributed to a commitment"
                    >
                      → {tx.commitment_name}
                    </span>
                  ) : (
                    ''
                  )}
                  {editingCategory[tx.id] ? (
                    <div className="assign assign-edit">
                      <select
                        title="Account for this transaction"
                        value={editingCategory[tx.id].accountId}
                        onChange={(e) =>
                          setEditingCategory((p) => ({
                            ...p,
                            [tx.id]: { ...p[tx.id], accountId: e.target.value },
                          }))
                        }
                      >
                        <option value="">Unassigned account</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
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
                        title="Optional funding source. A transaction can use a fund or commitment, not both."
                        value={
                          editingCategory[tx.id].fundId
                            ? `fund:${editingCategory[tx.id].fundId}`
                            : editingCategory[tx.id].commitmentId
                              ? `commitment:${editingCategory[tx.id].commitmentId}`
                              : ''
                        }
                        onChange={(e) => {
                          const [kind, id] = e.target.value.split(':');
                          setEditingCategory((p) => ({
                            ...p,
                            [tx.id]: {
                              ...p[tx.id],
                              fundId: kind === 'fund' ? id : '',
                              commitmentId: kind === 'commitment' ? id : '',
                            },
                          }));
                        }}
                      >
                        <option value="">No fund or commitment</option>
                        <optgroup label="Funds">
                          {editFunds.map((f) => (
                            <option key={`fund-${f.id}`} value={`fund:${f.id}`}>
                              Fund: {f.name}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Commitments">
                          {commitments.map((c) => (
                            <option key={`commitment-${c.id}`} value={`commitment:${c.id}`}>
                              Commitment: {c.name}
                            </option>
                          ))}
                        </optgroup>
                      </select>
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
                  ) : tx.transfer_group ? (
                    <div className="assign">
                      <span className="pill-badge accent-badge">paired transfer</span>
                      <button
                        className="btn ghost small"
                        title="Unpair these two transactions so they can be categorized separately"
                        onClick={() => unpairTransfer(tx)}
                      >
                        Unpair
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
                      <button
                        className="btn ghost small"
                        title="Edit this transaction's account and funding source"
                        onClick={() => startEditCategory(tx)}
                      >
                        Edit
                      </button>
                    </div>
                  )}
                </td>
                <td>
                  <button className="btn danger small" onClick={() => deleteTransaction(tx)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <nav className="transaction-pagination" aria-label="Transaction pagination">
          <button
            type="button"
            className="btn ghost small"
            aria-label="Previous transactions page"
            onClick={() => setPage((current) => current - 1)}
            disabled={page === 0}
          >
            Previous
          </button>
          <span className="pagination-status" role="status" aria-live="polite">
            {total === 0
              ? 'Showing 0 of 0'
              : `Showing ${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}{' '}
            {total > 0 && `(page ${page + 1} of ${Math.ceil(total / PAGE_SIZE)})`}
          </span>
          <button
            type="button"
            className="btn ghost small"
            aria-label="Next transactions page"
            onClick={() => setPage((current) => current + 1)}
            disabled={(page + 1) * PAGE_SIZE >= total}
          >
            Next
          </button>
        </nav>
      </div>

      {splitTx && (
        <Modal
          title={`Split — ${splitTx.description}`}
          description={
            <>
              Original amount:{' '}
              <b className={splitTx.amount >= 0 ? 'income' : 'expense'}>
                {formatMoney(splitTx.amount, splitTx.currency)}
              </b>{' '}
              · parts must add up to it.
            </>
          }
          onClose={() => setSplitTx(null)}
          width={520}
        >
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
          description={
            <>
              <b className={attTx.amount >= 0 ? 'income' : 'expense'}>
                {formatMoney(attTx.amount, attTx.currency)}
              </b>{' '}
              on {attTx.date} · PDF, PNG, JPEG, WebP or CSV up to 10 MB.
            </>
          }
          onClose={() => setAttTx(null)}
          width={520}
        >
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
        <Modal
          title="Add transaction"
          description="Enter the details for a new transaction."
          onClose={() => setAddOpen(false)}
          width={460}
        >
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
            <label className="check-label">
              <input
                type="checkbox"
                checked={addForm.is_transfer}
                onChange={(e) =>
                  setAddForm({
                    ...addForm,
                    is_transfer: e.target.checked,
                    category_id: '',
                    fund_id: '',
                    commitment_id: '',
                  })
                }
              />{' '}
              Transfer between accounts
            </label>
            {addForm.is_transfer && (
              <p className="muted tiny">
                Enter a positive amount. This creates an outgoing row and an incoming row, both
                excluded from spending and income.
              </p>
            )}
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
                disabled={addForm.is_transfer}
              />
            </div>
            <label className="modal-label" htmlFor="add-tx-acc">
              {addForm.is_transfer ? 'From account' : 'Account'}
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
            {addForm.is_transfer ? (
              <>
                <label className="modal-label" htmlFor="add-tx-to-acc">
                  To account
                </label>
                <select
                  id="add-tx-to-acc"
                  value={addForm.transfer_to_account_id}
                  onChange={(e) =>
                    setAddForm({ ...addForm, transfer_to_account_id: e.target.value })
                  }
                >
                  <option value="">Choose destination…</option>
                  {addAccounts
                    .filter((a) => String(a.id) !== String(addForm.account_id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <>
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
                <label className="modal-label" htmlFor="add-tx-funding">
                  Funding source <span className="muted tiny">(optional)</span>
                </label>
                <select
                  id="add-tx-funding"
                  title="A transaction can be linked to a fund or commitment, not both"
                  value={
                    addForm.fund_id
                      ? `fund:${addForm.fund_id}`
                      : addForm.commitment_id
                        ? `commitment:${addForm.commitment_id}`
                        : ''
                  }
                  onChange={(e) => {
                    const [kind, id] = e.target.value.split(':');
                    setAddForm({
                      ...addForm,
                      fund_id: kind === 'fund' ? id : '',
                      commitment_id: kind === 'commitment' ? id : '',
                    });
                  }}
                >
                  <option value="">None</option>
                  <optgroup label="Funds">
                    {addFunds.map((f) => (
                      <option key={`fund-${f.id}`} value={`fund:${f.id}`}>
                        Fund: {f.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Commitments">
                    {commitments.map((c) => (
                      <option key={`commitment-${c.id}`} value={`commitment:${c.id}`}>
                        Commitment: {c.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </>
            )}
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
