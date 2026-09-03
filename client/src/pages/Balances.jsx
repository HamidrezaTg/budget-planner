import { useEffect, useState } from 'react';
import { api, formatMoney } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Balances() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ account_id: '', month: '', balance: '' });
  const [editingAccount, setEditingAccount] = useState({}); // { [id]: { opening_balance, opening_balance_month } }
  const [observedDrafts, setObservedDrafts] = useState({}); // { `${accountId}|${month}`: string }
  const [showEmptyMonths, setShowEmptyMonths] = useState(false);
  const [msg, setMsg] = useState('');
  const { confirm } = useDialogs();

  const load = () =>
    api
      .get('/balances')
      .then((d) => {
        setData(d);
        setObservedDrafts({});
      })
      .catch((err) => setMsg(err.message));
  useEffect(() => {
    load();
  }, []);
  if (!data) return <div className="loading">{msg ? `Failed to load: ${msg}` : 'Loading…'}</div>;

  const submit = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/balances', { ...form, balance: Number(form.balance) });
      setForm({ account_id: '', month: '', balance: '' });
      load();
    } catch (err) {
      setMsg(err.message);
    }
  };

  // Opening balances belong to the account, so they are saved through
  // /api/accounts (the old PATCH /balances/:id route never existed).
  const startEditAccount = (a) =>
    setEditingAccount((p) => ({
      ...p,
      [a.id]: {
        opening_balance: String(a.opening_balance ?? 0),
        opening_balance_month: a.opening_balance_month ?? '',
      },
    }));
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
      await api.patch(`/accounts/${a.id}`, {
        opening_balance: Number(e.opening_balance) || 0,
        opening_balance_month: e.opening_balance_month || null,
      });
      setMsg('');
      cancelEditAccount(a.id);
      load();
    } catch (err) {
      setMsg(err.message);
    }
  };

  const draftKey = (accountId, month) => `${accountId}|${month}`;
  const saveObserved = async (accountId, month) => {
    const key = draftKey(accountId, month);
    const raw = observedDrafts[key];
    if (raw === undefined || raw === '') return;
    try {
      await api.post('/balances', { account_id: accountId, month, balance: Number(raw) });
      setMsg('');
      load();
    } catch (err) {
      setMsg(err.message);
    }
  };

  const varianceClass = (v) =>
    v == null ? 'muted' : Math.abs(v) < 0.005 ? 'good' : v > 0 ? 'warn-text' : 'bad';
  const fmtVariance = (v, cur) => (v == null ? '—' : (v > 0 ? '+' : '') + formatMoney(v, cur));

  // By default hide months where nothing was observed and nothing differs —
  // the user cares about months they reconciled (or can reconcile now).
  const visibleHistory = showEmptyMonths
    ? data.history
    : data.history.filter((m) => m.accounts.some((r) => r.observed !== null) || m.total);

  return (
    <div>
      <h1>Balance check</h1>
      <p className="muted">
        Type in the real bank balance each month. Every month is compared with the calculated
        balance — not just the latest one — and the projection re-anchors to the newest observation
        instead of letting drift compound silently. Variance is <code>calculated − observed</code>.
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
                  (data.reconciled.find((r) => r.month === data.anchored_at).variance ?? 0) >= 0
                    ? 'warn-text'
                    : 'bad'
                }
              >
                {formatMoney(
                  data.reconciled.find((r) => r.month === data.anchored_at).variance ?? 0,
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
            <h2 style={{ fontSize: 18, margin: 0 }}>Opening balance and latest check</h2>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Kind</th>
              <th className="num">Opening balance</th>
              <th>Opening month</th>
              <th className="num">Calculated (this month)</th>
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
                        title="Money in the account as of the opening month"
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
                  <td>
                    {edit ? (
                      <input
                        type="month"
                        title="The opening balance was true at the END of this month. Leave empty to count it against all history."
                        value={edit.opening_balance_month}
                        onChange={(e) =>
                          setEditingAccount((p) => ({
                            ...p,
                            [a.id]: { ...p[a.id], opening_balance_month: e.target.value },
                          }))
                        }
                      />
                    ) : a.opening_balance_month ? (
                      `${a.opening_balance_month} (end)`
                    ) : (
                      <span className="muted tiny">all history</span>
                    )}
                  </td>
                  <td className="num muted">
                    {a.predicted_at_month == null
                      ? '—'
                      : formatMoney(a.predicted_at_month, a.display_currency)}
                  </td>
                  <td className="num muted">
                    {a.latest_observation ? (
                      `${a.latest_observation.month} · ${formatMoney(a.latest_observation.balance, a.display_currency)}`
                    ) : (
                      <span className="muted tiny">no observation</span>
                    )}
                  </td>
                  <td className={`num ${varianceClass(a.latest_variance)}`}>
                    {fmtVariance(a.latest_variance, a.display_currency)}
                  </td>
                  <td>
                    {edit ? (
                      <>
                        <button
                          className="btn small primary"
                          title="Save opening balance and month"
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

      <h2>Month-by-month reconciliation</h2>
      <p className="muted">
        The calculated balance comes from your opening balance plus every imported transaction. The
        observed column is what the bank said. Totals only appear when every account has an
        observation for the month — a missing observation is never counted as zero. Months before an
        account's opening-balance month show n/a.
      </p>
      <label className="muted tiny" style={{ display: 'inline-flex', gap: 6, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={showEmptyMonths}
          onChange={(e) => setShowEmptyMonths(e.target.checked)}
        />{' '}
        show months without observations
      </label>
      <div className="card table-card tight">
        <table>
          <thead>
            <tr>
              <th>Month</th>
              {data.accounts.map((a) => (
                <th key={a.id} className="num">
                  {a.name} <span className="muted tiny">({a.display_currency})</span>
                </th>
              ))}
              <th className="num">Total variance</th>
            </tr>
          </thead>
          <tbody>
            {visibleHistory
              .slice()
              .reverse()
              .map((m) => (
                <tr key={m.month}>
                  <td>
                    {m.month}
                    {m.month === data.anchored_at && (
                      <span className="pill-badge accent-badge">anchor</span>
                    )}
                  </td>
                  {m.accounts.map((r) => {
                    const key = draftKey(r.account_id, m.month);
                    const draft = observedDrafts[key];
                    const observation = data.observations.find(
                      (o) => o.account_id === r.account_id && o.month === m.month,
                    );
                    return (
                      <td key={r.account_id} className="num">
                        {r.calculated === null ? (
                          <span className="muted tiny" title="Before the opening-balance month">
                            n/a
                          </span>
                        ) : (
                          <>
                            <input
                              type="number"
                              step="0.01"
                              style={{ width: 100 }}
                              aria-label={`Observed balance for ${m.month}`}
                              placeholder={r.observed == null ? 'actual…' : undefined}
                              value={draft ?? (r.observed == null ? '' : r.observed)}
                              onChange={(e) =>
                                setObservedDrafts((p) => ({ ...p, [key]: e.target.value }))
                              }
                              onBlur={() => saveObserved(r.account_id, m.month)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  e.currentTarget.blur();
                                }
                              }}
                            />
                            {observation && (
                              <button
                                className="btn danger tiny-btn"
                                title={`Delete the ${m.month} observation`}
                                onClick={async () => {
                                  const ok = await confirm({
                                    title: `Delete the ${m.month} observation for this account?`,
                                    message:
                                      'The projection will re-anchor to the next remaining observation.',
                                    danger: true,
                                    confirmLabel: 'Delete',
                                  });
                                  if (!ok) return;
                                  try {
                                    await api.del(`/balances/${observation.id}`);
                                    setMsg('');
                                    load();
                                  } catch (err) {
                                    setMsg(err.message);
                                  }
                                }}
                              >
                                ✕
                              </button>
                            )}
                            <div className="muted tiny">
                              calc {formatMoney(r.calculated, r.display_currency)}
                              {r.variance != null && (
                                <span className={varianceClass(r.variance)}>
                                  {' '}
                                  · {fmtVariance(r.variance, r.display_currency)}
                                </span>
                              )}
                            </div>
                          </>
                        )}
                      </td>
                    );
                  })}
                  <td className="num muted">
                    {m.total
                      ? `${fmtVariance(m.total.variance, '')} (calc ${formatMoney(m.total.calculated, '')} / obs ${formatMoney(m.total.observed, '')})`
                      : '—'}
                  </td>
                </tr>
              ))}
            {visibleHistory.length === 0 && (
              <tr>
                <td colSpan={data.accounts.length + 2} className="muted">
                  No observed months yet — enter your first real balance above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
