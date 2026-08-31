import { useEffect, useState } from 'react';
import { api, currentMonth, monthLabel } from '../api.js';

// Budgets: per-month plan per category. Editing saves an override for the
// selected month; the standing monthly plan is editable too.
export default function Budgets() {
  const [month, setMonth] = useState(currentMonth());
  const [meta, setMeta] = useState({ groups: [], accounts: [] });
  const [lines, setLines] = useState([]);
  const [edits, setEdits] = useState({});
  const [error, setError] = useState('');

  // keepEdits: after saving one cell, other in-progress edits in the table
  // must survive — wiping them all silently discarded unsaved input.
  const load = (keepEdits = false) =>
    api.get(`/budgets/${month}`).then((d) => {
      setLines(d.lines);
      if (!keepEdits) setEdits({});
    });
  useEffect(() => {
    api
      .get('/categories/meta/all')
      .then(setMeta)
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [month]);

  const grouped = lines.reduce((acc, l) => {
    (acc[l.group ?? 'Ungrouped'] ??= []).push(l);
    return acc;
  }, {});

  const clearEdit = (key) =>
    setEdits((p) => {
      if (!(key in p)) return p;
      const next = { ...p };
      delete next[key];
      return next;
    });

  const saveOverride = async (l) => {
    const v = edits[l.category_id];
    if (v === undefined) return;
    try {
      await api.put(`/budgets/${month}/${l.category_id}`, { amount: v === '' ? null : Number(v) });
      clearEdit(l.category_id);
      setError('');
      load(true);
    } catch (e) {
      setError(e.message);
    }
  };

  const saveStanding = async (l) => {
    const v = edits['s' + l.category_id];
    if (v === undefined) return;
    try {
      await api.patch(`/categories/${l.category_id}`, { monthly_budget: Number(v) || 0 });
      clearEdit('s' + l.category_id);
      setError('');
      load(true);
    } catch (e) {
      setError(e.message);
    }
  };

  const assignAccount = async (l, accountId) => {
    try {
      await api.patch(`/categories/${l.category_id}`, {
        account_id: accountId ? Number(accountId) : null,
      });
      setError('');
      load(true);
    } catch (e) {
      setError(e.message);
    }
  };

  const toggleRollover = async (l) => {
    const cur = l.roll_overs === undefined ? false : !!l.roll_overs;
    try {
      await api.patch(`/categories/${l.category_id}`, { roll_overs: !cur });
      setError('');
      load(true);
    } catch (e) {
      setError(e.message);
    }
  };

  const input = (key, value) => (
    <input
      className="budget-input"
      type="number"
      step="0.01"
      min="0"
      defaultValue={value}
      key={key + String(value)}
      onChange={(e) => setEdits((p) => ({ ...p, [key]: e.target.value }))}
    />
  );

  return (
    <div>
      <div className="page-head">
        <h1>Budgets — {monthLabel(month)}</h1>
        <div className="month-nav">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>
      <p className="muted">
        “Plan for {monthLabel(month)}” overrides the standing plan for that month only. Every
        category should have an account — untagged spending disappears from account totals.
      </p>
      {error && <div className="error">{error}</div>}

      {Object.entries(grouped).map(([g, rows]) => (
        <div key={g}>
          <h2>{g}</h2>
          <div className="card table-card tight">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Account</th>
                  <th className="num">Standing plan</th>
                  <th className="num">Plan for {monthLabel(month)}</th>
                  <th>Rollover</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.category_id} className={l.has_override ? 'override-row' : ''}>
                    <td>
                      {l.name}{' '}
                      {l.has_override && (
                        <button
                          className="btn ghost tiny-btn"
                          title="Remove this month's override"
                          onClick={() =>
                            api
                              .put(`/budgets/${month}/${l.category_id}`, { amount: null })
                              .then(() => load(true))
                              .catch((e) => setError(e.message))
                          }
                        >
                          ↺
                        </button>
                      )}
                    </td>
                    <td>
                      <select
                        value=""
                        onChange={(e) => assignAccount(l, e.target.value)}
                        className={l.account ? 'plain' : 'missing'}
                      >
                        <option value="">{l.account ?? '— untagged —'}</option>
                        {meta.accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      {input('s' + l.category_id, l.standing_plan)}
                      <button
                        className={`btn small ${edits['s' + l.category_id] !== undefined ? 'primary' : 'ghost'}`}
                        onClick={() => saveStanding(l)}
                        disabled={edits['s' + l.category_id] === undefined}
                      >
                        ✓
                      </button>
                    </td>
                    <td className="num">{input(l.category_id, l.planned)}</td>
                    <td>
                      <button
                        className={`btn ghost small ${l.roll_overs ? 'active' : ''}`}
                        title="Underspend carries forward to the next month"
                        onClick={() => toggleRollover(l)}
                      >
                        {l.roll_overs ? 'on' : 'off'}
                      </button>
                    </td>
                    <td>
                      <button
                        className={`btn small ${edits[l.category_id] !== undefined ? 'primary' : 'ghost'}`}
                        onClick={() => saveOverride(l)}
                        disabled={edits[l.category_id] === undefined}
                      >
                        Set
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
