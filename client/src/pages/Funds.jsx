import { useEffect, useState } from 'react';
import { api, eur, currentMonth } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Funds() {
  const [data, setData] = useState(null);
  const [amounts, setAmounts] = useState({});
  const [msg, setMsg] = useState('');
  const { toast, confirm } = useDialogs();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: '',
    start_month: currentMonth(),
    monthly_contribution: 0,
    opening_balance: 0,
  });

  const load = () =>
    api
      .get('/funds')
      .then(setData)
      .catch((e) => setMsg(e.message));
  useEffect(() => {
    load();
  }, []);
  if (!data) return <div className="loading">{msg ? `Failed to load: ${msg}` : 'Loading…'}</div>;

  const move = async (fundId, kind) => {
    setMsg('');
    try {
      await api.post(`/funds/${fundId}/movement`, {
        kind,
        amount: Number(amounts[fundId]),
        month: data.month,
      });
      setAmounts((p) => ({ ...p, [fundId]: '' }));
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const saveConfig = async (f) => {
    const c = amounts['c' + f.id];
    if (c === undefined) return;
    try {
      await api.patch(`/funds/${f.id}`, { monthly_contribution: Number(c) || 0 });
      setMsg('');
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const setGoal = async (f) => {
    const amt = amounts['g' + f.id];
    const date = amounts['gd' + f.id];
    if (amt === undefined && date === undefined) return;
    if (!Number(amt) || Number(amt) <= 0) {
      toast('Enter a positive target amount first.', 'error');
      return;
    }
    try {
      await api.patch(`/funds/${f.id}`, {
        target_amount: Number(amt),
        target_date: date || null,
      });
      setAmounts((p) => ({ ...p, ['g' + f.id]: undefined, ['gd' + f.id]: undefined }));
      setMsg('');
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const addFund = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      await api.post('/funds', {
        name: form.name.trim(),
        start_month: form.start_month,
        monthly_contribution: Number(form.monthly_contribution) || 0,
        opening_balance: Number(form.opening_balance) || 0,
      });
      setForm({
        name: '',
        start_month: currentMonth(),
        monthly_contribution: 0,
        opening_balance: 0,
      });
      setShowAdd(false);
      setMsg('');
      toast(`Fund "${form.name.trim()}" created.`, 'ok');
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  const removeFund = async (f) => {
    const ok = await confirm({
      title: `Delete fund "${f.name}"?`,
      message:
        'This removes the fund and its movement history. Transactions are kept; they will simply no longer be linked to a fund.',
      danger: true,
      confirmLabel: 'Delete fund',
    });
    if (!ok) return;
    try {
      await api.del(`/funds/${f.id}`);
      toast(`Fund "${f.name}" deleted.`);
      load();
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div>
      <h1>
        Sinking funds <span className="muted h-count">(balances at {data.month})</span>
      </h1>
      <p className="muted">
        Set money aside monthly for irregular bills; draw it down when the bill lands. A negative
        balance is a warning signal, not an error — it means the bill arrived early.
      </p>
      {msg && <div className="error">{msg}</div>}

      <div className="card table-card">
        <div className="panel-head">
          <span className="muted tiny">
            {data.funds.length} fund{data.funds.length === 1 ? '' : 's'}
          </span>
          <button
            className="btn small"
            title="Create a new fund"
            onClick={() => setShowAdd((s) => !s)}
          >
            {showAdd ? 'Cancel' : '+ Add fund'}
          </button>
        </div>
        {showAdd && (
          <form onSubmit={addFund} className="add-fund-form">
            <input
              autoFocus
              placeholder="Fund name (e.g. Car service)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={60}
            />
            <label className="muted tiny">
              Start month
              <input
                type="month"
                value={form.start_month}
                onChange={(e) => setForm({ ...form, start_month: e.target.value })}
                required
              />
            </label>
            <label className="muted tiny">
              Monthly contribution €
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.monthly_contribution}
                onChange={(e) => setForm({ ...form, monthly_contribution: e.target.value })}
              />
            </label>
            <label className="muted tiny">
              Opening balance €
              <input
                type="number"
                step="0.01"
                value={form.opening_balance}
                onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
                title="Money already in the fund when you start using the planner. Negative values represent an overdrawn fund."
              />
            </label>
            <button className="btn primary small" type="submit" disabled={!form.name.trim()}>
              Create fund
            </button>
          </form>
        )}

        {data.funds.length === 0 && !showAdd && (
          <div className="empty" style={{ padding: '20px 12px', textAlign: 'center' }}>
            <p className="muted">
              No funds yet. Create your first fund to start setting money aside for irregular bills.
            </p>
          </div>
        )}

        {data.funds.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Fund</th>
                <th className="num">Balance</th>
                <th>Goal</th>
                <th className="num">Monthly contribution</th>
                <th style={{ minWidth: 250 }}>Move money</th>
                <th></th>
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
                            <div
                              className="bar"
                              style={{ width: `${f.goal.progress}%`, background: 'var(--blue)' }}
                            />
                          </div>
                          <span className="muted tiny">{f.goal.progress}%</span>
                        </div>
                        <span className="muted tiny">
                          {eur(f.goal.remaining)} to go
                          {f.goal.target_date && ` · by ${f.goal.target_date}`}
                          {f.goal.monthly_needed != null && f.goal.remaining > 0 && (
                            <>
                              {' '}
                              · needs {eur(f.goal.monthly_needed)}/mo{' '}
                              {f.goal.on_track ? (
                                <span className="good">(on track)</span>
                              ) : (
                                <span className="bad">(behind)</span>
                              )}
                            </>
                          )}
                        </span>
                        <button
                          className="btn ghost tiny-btn"
                          title={`Edit the ${f.name} target`}
                          onClick={() => {
                            setAmounts((p) => ({
                              ...p,
                              ['g' + f.id]: String(f.goal.target_amount),
                              ['gd' + f.id]: f.goal.target_date ?? '',
                            }));
                          }}
                        >
                          ✎
                        </button>
                      </>
                    ) : null}
                    {amounts['g' + f.id] !== undefined || amounts['gd' + f.id] !== undefined ? (
                      <div className="goal-edit">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Target €"
                          style={{ width: 90 }}
                          value={amounts['g' + f.id] ?? ''}
                          onChange={(e) =>
                            setAmounts((p) => ({ ...p, ['g' + f.id]: e.target.value }))
                          }
                        />
                        <input
                          type="month"
                          style={{ width: 130 }}
                          value={amounts['gd' + f.id] ?? ''}
                          onChange={(e) =>
                            setAmounts((p) => ({ ...p, ['gd' + f.id]: e.target.value }))
                          }
                        />
                        <button
                          className="btn small primary"
                          title="Save the goal"
                          onClick={() => setGoal(f)}
                        >
                          Save
                        </button>
                      </div>
                    ) : !f.goal ? (
                      <button
                        className="btn ghost small"
                        title={`Set a savings target for ${f.name}`}
                        onClick={() =>
                          setAmounts((p) => ({ ...p, ['g' + f.id]: '', ['gd' + f.id]: '' }))
                        }
                      >
                        + Set goal
                      </button>
                    ) : null}
                  </td>
                  <td className="num">
                    <input
                      className="budget-input"
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={f.monthly_contribution}
                      key={'c' + f.id + String(f.monthly_contribution)}
                      title="Per-month amount set aside into this fund"
                      onChange={(e) => setAmounts((p) => ({ ...p, ['c' + f.id]: e.target.value }))}
                    />
                    <button
                      className={`btn small ${(amounts['c' + f.id] ?? '') !== '' ? 'primary' : 'ghost'}`}
                      title="Save the new monthly contribution"
                      onClick={() => saveConfig(f)}
                      disabled={amounts['c' + f.id] === undefined}
                    >
                      ✓
                    </button>
                  </td>
                  <td>
                    <div className="env-actions">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="€"
                        title="Amount to move"
                        value={amounts[f.id] ?? ''}
                        onChange={(e) => setAmounts((p) => ({ ...p, [f.id]: e.target.value }))}
                      />
                      <button
                        className="btn small"
                        title="Record a contribution into this fund"
                        disabled={!amounts[f.id]}
                        onClick={() => move(f.id, 'contribution')}
                      >
                        In
                      </button>
                      <button
                        className="btn small"
                        title="Record a withdrawal from this fund"
                        disabled={!amounts[f.id]}
                        onClick={() => move(f.id, 'withdrawal')}
                      >
                        Out
                      </button>
                    </div>
                  </td>
                  <td>
                    <button
                      className="btn danger tiny-btn"
                      title={`Delete the ${f.name} fund`}
                      onClick={() => removeFund(f)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Recent movements</h2>
      <div className="card table-card tight">
        <table>
          <thead>
            <tr>
              <th>Created</th>
              <th>Fund</th>
              <th>Month</th>
              <th>Kind</th>
              <th className="num">Amount</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {data.movements.map((m) => (
              <tr key={m.id}>
                <td>{m.created_at.slice(0, 10)}</td>
                <td>{m.fund_name}</td>
                <td>{m.month}</td>
                <td className="muted">
                  {m.kind}
                  {m.scheduled ? ' (scheduled)' : ''}
                </td>
                <td className={`num ${m.amount >= 0 ? 'income' : 'expense'}`}>{eur(m.amount)}</td>
                <td className="muted">{m.note}</td>
              </tr>
            ))}
            {data.movements.length === 0 && (
              <tr>
                <td colSpan="6" className="muted">
                  No movements yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
