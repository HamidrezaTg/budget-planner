import React, { useEffect, useState } from 'react';
import { api, eur } from '../api.js';

export default function Savings() {
  const [data, setData] = useState(null);
  const [amounts, setAmounts] = useState({});
  const [msg, setMsg] = useState('');

  const load = () => api.get('/envelopes').then(setData);
  useEffect(() => { load(); }, []);

  if (!data) return <div className="loading">Loading…</div>;

  const act = async (categoryId, action, amount) => {
    setMsg('');
    try {
      await api.post(`/envelopes/${categoryId}`, { action, amount, month: data.month });
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div>
      <h1>Savings envelopes <span className="muted h-count">({data.month})</span></h1>
      <p className="muted">
        Save money aside per category across months, then withdraw it when you want to spend it.
        “Sweep underspend” moves what's left of this month's budget into the envelope.
      </p>
      {msg && <div className="error">{msg}</div>}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Category</th><th>Envelope balance</th><th>Underspend this month</th><th style={{ minWidth: 280 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.envelopes.map((e) => (
              <tr key={e.category_id}>
                <td><span className="dot" style={{ background: e.color }} /> {e.name}</td>
                <td className={e.balance > 0 ? 'income' : ''}>{eur(e.balance)}</td>
                <td>{e.underspend > 0 ? eur(e.underspend) : '—'}</td>
                <td>
                  <div className="env-actions">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="€"
                      value={amounts[e.category_id] ?? ''}
                      onChange={(ev) => setAmounts({ ...amounts, [e.category_id]: ev.target.value })}
                    />
                    <button
                      className="btn small"
                      onClick={() => act(e.category_id, 'contribute', Number(amounts[e.category_id]))}
                      disabled={!amounts[e.category_id]}
                    >
                      Save
                    </button>
                    <button
                      className="btn small"
                      onClick={() => act(e.category_id, 'withdraw', Number(amounts[e.category_id]))}
                      disabled={!amounts[e.category_id]}
                    >
                      Withdraw
                    </button>
                    {e.underspend > 0 && (
                      <button className="btn ghost small" onClick={() => act(e.category_id, 'sweep')}>
                        Sweep {eur(e.underspend)}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recent envelope activity</h2>
      <div className="card table-card">
        <table>
          <thead><tr><th>Date</th><th>Category</th><th>Month</th><th>Amount</th><th>Note</th></tr></thead>
          <tbody>
            {data.recent.map((l) => (
              <tr key={l.id}>
                <td>{l.created_at.slice(0, 10)}</td>
                <td>{l.category_name}</td>
                <td>{l.month}</td>
                <td className={l.amount >= 0 ? 'income' : 'expense'}>{eur(l.amount)}</td>
                <td className="muted">{l.note}</td>
              </tr>
            ))}
            {data.recent.length === 0 && (
              <tr><td colSpan="5" className="muted">No activity yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
