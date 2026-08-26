import React, { useEffect, useState } from 'react';
import { api, eur } from '../api.js';

export default function Funds() {
  const [data, setData] = useState(null);
  const [amounts, setAmounts] = useState({});
  const [msg, setMsg] = useState('');

  const load = () => api.get('/funds').then(setData);
  useEffect(() => { load(); }, []);
  if (!data) return <div className="loading">Loading…</div>;

  const move = async (fundId, kind) => {
    setMsg('');
    try {
      await api.post(`/funds/${fundId}/movement`, { kind, amount: Number(amounts[fundId]), month: data.month });
      setAmounts((p) => ({ ...p, [fundId]: '' }));
      load();
    } catch (e) { setMsg(e.message); }
  };

  const saveConfig = async (f) => {
    const c = amounts['c' + f.id];
    if (c === undefined) return;
    await api.patch(`/funds/${f.id}`, { monthly_contribution: Number(c) || 0 });
    load();
  };

  const setGoal = async (f) => {
    const amt = amounts['g' + f.id];
    const date = amounts['gd' + f.id];
    if (amt === undefined && date === undefined) return;
    await api.patch(`/funds/${f.id}`, {
      target_amount: amt === '' ? null : Number(amt),
      target_date: date || null,
    });
    setAmounts((p) => ({ ...p, ['g' + f.id]: undefined, ['gd' + f.id]: undefined }));
    load();
  };

  return (
    <div>
      <h1>Sinking funds <span className="muted h-count">(balances at {data.month})</span></h1>
      <p className="muted">
        Set money aside monthly for irregular bills; draw it down when the bill lands.
        A negative balance is a warning signal, not an error — it means the bill arrived early.
      </p>
      {msg && <div className="error">{msg}</div>}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Fund</th><th className="num">Balance</th><th>Goal</th><th className="num">Monthly contribution</th>
              <th style={{ minWidth: 250 }}>Move money</th><th></th>
            </tr>
          </thead>
          <tbody>
            {data.funds.map((f) => (
              <tr key={f.id} className={f.negative ? 'neg-row' : ''}>
                <td>
                  {f.name}
                  {f.negative && <span className="bad pill-badge">negative</span>}
                  {f.category_name && <span className="muted tiny"> → {f.category_name}</span>}
                </td>
                <td className={`num ${f.negative ? 'bad' : f.balance > 0 ? 'income' : ''}`}>
                  {eur(f.balance)}
                </td>
                <td style={{ minWidth: 190 }}>
                  {f.goal ? (
                    <>
                      <div className="goal-line">
                        <div className="bar-track" style={{ flex: 1 }}>
                          <div className="bar" style={{ width: `${f.goal.progress}%`, background: 'var(--blue)' }} />
                        </div>
                        <span className="muted tiny">{f.goal.progress}%</span>
                      </div>
                      <span className="muted tiny">
                        {eur(f.goal.remaining)} to go
                        {f.goal.target_date && ` · by ${f.goal.target_date}`}
                        {f.goal.monthly_needed != null && f.goal.remaining > 0 && (
                          <> · needs {eur(f.goal.monthly_needed)}/mo{' '}
                            {f.goal.on_track ? <span className="good">(on track)</span> : <span className="bad">(behind)</span>}
                          </>
                        )}
                      </span>
                      <button className="btn ghost tiny-btn" title="Edit goal"
                        onClick={() => {
                          setAmounts((p) => ({ ...p, ['g' + f.id]: String(f.goal.target_amount), ['gd' + f.id]: f.goal.target_date ?? '' }));
                        }}
                      >✎</button>
                    </>
                  ) : null}
                  {(amounts['g' + f.id] !== undefined || amounts['gd' + f.id] !== undefined) ? (
                    <div className="goal-edit">
                      <input type="number" step="0.01" placeholder="Target €" style={{ width: 90 }}
                        value={amounts['g' + f.id] ?? ''}
                        onChange={(e) => setAmounts((p) => ({ ...p, ['g' + f.id]: e.target.value }))} />
                      <input type="month" style={{ width: 130 }}
                        value={amounts['gd' + f.id] ?? ''}
                        onChange={(e) => setAmounts((p) => ({ ...p, ['gd' + f.id]: e.target.value }))} />
                      <button className="btn small primary" onClick={() => setGoal(f)}>Save</button>
                    </div>
                  ) : !f.goal ? (
                    <button className="btn ghost small" onClick={() => setAmounts((p) => ({ ...p, ['g' + f.id]: '', ['gd' + f.id]: '' }))}>
                      + Set goal
                    </button>
                  ) : null}
                </td>
                <td className="num">
                  <input
                    className="budget-input"
                    type="number" step="0.01" min="0"
                    defaultValue={f.monthly_contribution}
                    key={'c' + f.id + String(f.monthly_contribution)}
                    onChange={(e) => setAmounts((p) => ({ ...p, ['c' + f.id]: e.target.value }))}
                  />
                  <button
                    className={`btn small ${(amounts['c' + f.id] ?? '') !== '' ? 'primary' : 'ghost'}`}
                    onClick={() => saveConfig(f)}
                    disabled={amounts['c' + f.id] === undefined}
                  >✓</button>
                </td>
                <td>
                  <div className="env-actions">
                    <input
                      type="number" step="0.01" min="0" placeholder="€"
                      value={amounts[f.id] ?? ''}
                      onChange={(e) => setAmounts((p) => ({ ...p, [f.id]: e.target.value }))}
                    />
                    <button className="btn small" disabled={!amounts[f.id]} onClick={() => move(f.id, 'contribution')}>In</button>
                    <button className="btn small" disabled={!amounts[f.id]} onClick={() => move(f.id, 'withdrawal')}>Out</button>
                  </div>
                </td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recent movements</h2>
      <div className="card table-card tight">
        <table>
          <thead><tr><th>Created</th><th>Fund</th><th>Month</th><th>Kind</th><th className="num">Amount</th><th>Note</th></tr></thead>
          <tbody>
            {data.movements.map((m) => (
              <tr key={m.id}>
                <td>{m.created_at.slice(0, 10)}</td>
                <td>{m.fund_name}</td>
                <td>{m.month}</td>
                <td className="muted">{m.kind}{m.scheduled ? ' (scheduled)' : ''}</td>
                <td className={`num ${m.amount >= 0 ? 'income' : 'expense'}`}>{eur(m.amount)}</td>
                <td className="muted">{m.note}</td>
              </tr>
            ))}
            {data.movements.length === 0 && (
              <tr><td colSpan="6" className="muted">No movements yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
