import React, { useEffect, useState } from 'react';
import { api, eur, currentMonth, monthLabel } from '../api.js';

// Budgets: per-month plan per category. Editing saves an override for the
// selected month; the standing monthly plan is editable too.
export default function Budgets() {
  const [month, setMonth] = useState(currentMonth());
  const [meta, setMeta] = useState({ groups: [], accounts: [] });
  const [lines, setLines] = useState([]);
  const [edits, setEdits] = useState({});

  const load = () => api.get(`/budgets/${month}`).then((d) => { setLines(d.lines); setEdits({}); });
  useEffect(() => { api.get('/categories/meta/all').then(setMeta); }, []);
  useEffect(() => { load(); }, [month]);

  const grouped = lines.reduce((acc, l) => {
    (acc[l.group ?? 'Ungrouped'] ??= []).push(l);
    return acc;
  }, {});

  const saveOverride = async (l) => {
    const v = edits[l.category_id];
    if (v === undefined) return;
    await api.put(`/budgets/${month}/${l.category_id}`, { amount: v === '' ? null : Number(v) });
    load();
  };

  const saveStanding = async (l) => {
    const v = edits['s' + l.category_id];
    if (v === undefined) return;
    await api.patch(`/categories/${l.category_id}`, { monthly_budget: Number(v) || 0 });
    load();
  };

  const assignAccount = async (l, accountId) => {
    await api.patch(`/categories/${l.category_id}`, { account_id: accountId ? Number(accountId) : null });
    load();
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
        “Plan for {monthLabel(month)}” overrides the standing plan for that month only.
        Every category should have an account — untagged spending disappears from account totals.
      </p>

      {Object.entries(grouped).map(([g, rows]) => (
        <div key={g}>
          <h2>{g}</h2>
          <div className="card table-card tight">
            <table>
              <thead>
                <tr>
                  <th>Category</th><th>Account</th>
                  <th className="num">Standing plan</th>
                  <th className="num">Plan for {monthLabel(month)}</th><th></th>
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
                          onClick={() => api.put(`/budgets/${month}/${l.category_id}`, { amount: null }).then(load)}
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
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      {input('s' + l.category_id, l.standing_plan)}
                      <button
                        className={`btn small ${edits['s' + l.category_id] !== undefined ? 'primary' : 'ghost'}`}
                        onClick={() => saveStanding(l)}
                        disabled={edits['s' + l.category_id] === undefined}
                      >✓</button>
                    </td>
                    <td className="num">{input(l.category_id, l.planned)}</td>
                    <td>
                      <button
                        className={`btn small ${edits[l.category_id] !== undefined ? 'primary' : 'ghost'}`}
                        onClick={() => saveOverride(l)}
                        disabled={edits[l.category_id] === undefined}
                      >Set</button>
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
