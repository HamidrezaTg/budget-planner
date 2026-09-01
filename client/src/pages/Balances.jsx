import { useEffect, useState } from 'react';
import { api, formatMoney } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Balances() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ account_id: '', month: '', balance: '' });
  const [editingAccount, setEditingAccount] = useState({}); // { [id]: { opening_balance, ...saving } }
  const [msg, setMsg] = useState('');
  const { confirm } = useDialogs();

  const load = () =>
    api
      .get('/balances')
      .then(setData)
      .catch((err) => setMsg(err.message));
  useEffect(() => {
    load();
  }, []);
  if (!data) return <div className="loading">{msg ? `Failed to load: ${msg}` : 'Loading…'}</div>;

  const submit = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/balances', form);
      setForm({ account_id: '', month: '', balance: '' });
      load();
    } catch (err) {
      setMsg(err.message);
    }
  };

  const startEditAccount = (a) => {
    setEditingAccount((p) => ({ ...p, [a.id]: { opening_balance: a.opening_balance } }));
  };
  const cancelEditAccount = (id) => {
    setEditingAccount((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
  };
  const saveEditAccount = async (a) => {
    const e = editingAccount[a.id];
    if (!e) return;
    try {
      await api.patch(`/balances/${a.id}`, { opening_balance: Number(e.opening_balance) || 0 });
      setMsg('');
      cancelEditAccount(a.id);
      load();
    } catch (err) {
      setMsg(err.message);
    }
  };

  return (
    <div>
      <h1>Balance check</h1>
      <p className="muted">
        Type in the real bank balance each month. The projection re-anchors to it instead of letting
        drift compound silently — the variance is shown as a discrete, explained figure.
      </p>
      {data.anchored_at && (
        <div className="card success-box" style={{ marginBottom: 12 }}>
          📍 Projection currently anchored to <b>{data.anchored_at}</b>
          {data.reconciled.find((r) => r.month === data.anchored_at) && (
            <>
              {' '}
              · variance there:{' '}
              <b
                className={
                  data.reconciled.find((r) => r.month === data.anchored_at).variance >= 0
                    ? 'good'
                    : 'bad'
                }
              >
                {formatMoney(
                  data.reconciled.find((r) => r.month === data.anchored_at).variance,
                  data.reconciled.find((r) => r.month === data.anchored_at).display_currency,
                )}
              </b>
            </>
          )}
        </div>
      )}

      <div className="card table-card" style={{ marginBottom: 14 }}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">Accounts</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>Starting balance per account</h2>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Kind</th>
              <th className="num">Opening balance</th>
              <th className="num">Predicted (this month)</th>
              <th className="num">Latest observation</th>
              <th className="num">Variance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.per_account.map((a) => {
              const edit = editingAccount[a.id];
              return (
                <tr key={a.id}>
                  <td>
                    {a.name}
                    {a.is_spending_pot ? (
                      <span className="pill-badge accent-badge" style={{ marginLeft: 6 }}>
                        spending pot
                      </span>
                    ) : null}
                  </td>
                  <td className="muted">{a.kind}</td>
                  <td className="num">
                    {edit ? (
                      <input
                        type="number"
                        step="0.01"
                        style={{ width: 110 }}
                        title="Money already in the account when you started using the planner"
                        value={edit.opening_balance}
                        onChange={(e) =>
                          setEditingAccount((p) => ({
                            ...p,
                            [a.id]: { ...p[a.id], opening_balance: e.target.value },
                          }))
                        }
                      />
                    ) : (
                      formatMoney(a.opening_balance, a.display_currency)
                    )}
                  </td>
                  <td className="num muted">
                    {formatMoney(a.predicted_at_month, a.display_currency)}
                  </td>
                  <td className="num muted">
                    {a.latest_observation ? (
                      `${a.latest_observation.month} · ${formatMoney(a.latest_observation.balance, a.display_currency)}`
                    ) : (
                      <span className="muted tiny">no observation</span>
                    )}
                  </td>
                  <td
                    className={`num ${a.variance == null ? 'muted' : a.variance >= 0 ? 'good' : 'bad'}`}
                  >
                    {a.variance == null
                      ? '—'
                      : (a.variance >= 0 ? '+' : '') + formatMoney(a.variance, a.display_currency)}
                  </td>
                  <td>
                    {edit ? (
                      <>
                        <button
                          className="btn small primary"
                          title="Save the new opening balance"
                          onClick={() => saveEditAccount(a)}
                        >
                          Save
                        </button>
                        <button
                          className="btn ghost small"
                          title="Cancel without saving"
                          onClick={() => cancelEditAccount(a.id)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn ghost small"
                        title={`Edit the opening balance for ${a.name}`}
                        onClick={() => startEditAccount(a)}
                      >
                        ✎
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="filters card">
        <form onSubmit={submit} className="inline-form">
          <select
            title="Which account this observation is for"
            value={form.account_id}
            onChange={(e) => setForm({ ...form, account_id: e.target.value })}
          >
            <option value="">Account…</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <input
            title="The month this balance is for"
            type="month"
            value={form.month}
            onChange={(e) => setForm({ ...form, month: e.target.value })}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Actual balance €"
            title="The real balance you saw in your bank on that month"
            value={form.balance}
            onChange={(e) => setForm({ ...form, balance: e.target.value })}
          />
          <button
            className="btn primary"
            title="Record the real bank balance for this month and account"
          >
            Record
          </button>
          {msg && <span className="error">{msg}</span>}
        </form>
      </div>

      <h2>History &amp; reconciliation</h2>
      <div className="card table-card tight">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th>Account</th>
              <th className="num">Observed</th>
              <th className="num">Model predicted</th>
              <th className="num">Variance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.reconciled.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.month}
                  {r.month === data.anchored_at && (
                    <span className="pill-badge accent-badge">anchor</span>
                  )}
                </td>
                <td>{r.account_name}</td>
                <td className="num">{formatMoney(r.balance, r.display_currency)}</td>
                <td className="num">{formatMoney(r.predicted, r.display_currency)}</td>
                <td className={`num ${r.variance >= 0 ? 'good' : 'bad'}`}>
                  {r.variance >= 0 ? '+' : ''}
                  {formatMoney(r.variance, r.display_currency)}
                </td>
                <td>
                  <button
                    className="btn danger small"
                    title={`Delete the ${r.month} observation for ${r.account_name}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete the ${r.month} observation for ${r.account_name}?`,
                        message: 'The projection will re-anchor to the next remaining observation.',
                        danger: true,
                        confirmLabel: 'Delete',
                      });
                      if (ok) {
                        try {
                          await api.del(`/balances/${r.id}`);
                          setMsg('');
                          load();
                        } catch (err) {
                          setMsg(err.message);
                        }
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {data.reconciled.length === 0 && (
              <tr>
                <td colSpan="6" className="muted">
                  No observations yet — enter your first real balance above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
