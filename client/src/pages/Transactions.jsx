import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, eur, currentMonth, monthLabel } from '../api.js';

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

  const load = () => {
    const q = new URLSearchParams();
    if (month) q.set('month', month);
    if (review) q.set('review', '1');
    api.get(`/transactions?${q}`).then((d) => {
      setRows(d.rows);
      setTotal(d.total);
    });
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
                </td>
                <td className={tx.amount >= 0 ? 'income' : 'expense'}>{eur(tx.amount)}</td>
                <td>
                  {tx.category_name && !tx.needs_review ? (
                    <span className="cat-chip" style={{ background: tx.category_color || '#5E8BD9' }}>
                      {tx.category_name}
                    </span>
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
    </div>
  );
}
