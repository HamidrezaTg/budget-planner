import React, { useEffect, useState } from 'react';
import { api, eur } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Balances() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ account_id: '', month: '', balance: '' });
  const [msg, setMsg] = useState('');
  const { confirm } = useDialogs();

  const load = () => api.get('/balances').then(setData);
  useEffect(() => { load(); }, []);
  if (!data) return <div className="loading">Loading…</div>;

  const submit = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api.post('/balances', form);
      setForm({ account_id: '', month: '', balance: '' });
      load();
    } catch (err) { setMsg(err.message); }
  };

  return (
    <div>
      <h1>Balance check</h1>
      <p className="muted">
        Type in the real bank balance each month. The projection re-anchors to it instead of
        letting drift compound silently — the variance is shown as a discrete, explained figure.
      </p>
      {data.anchored_at && (
        <div className="card success-box" style={{ marginBottom: 12 }}>
          📍 Projection currently anchored to <b>{data.anchored_at}</b>
          {data.reconciled.find((r) => r.month === data.anchored_at) && (
            <> · variance there:{' '}
              <b className={data.reconciled.find((r) => r.month === data.anchored_at).variance >= 0 ? 'good' : 'bad'}>
                {eur(data.reconciled.find((r) => r.month === data.anchored_at).variance)}
              </b>
            </>
          )}
        </div>
      )}

      <div className="filters card">
        <form onSubmit={submit} className="inline-form">
          <select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
            <option value="">Account…</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input type="month" value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })} />
          <input
            type="number" step="0.01" placeholder="Actual balance €"
            value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })}
          />
          <button className="btn primary">Record</button>
          {msg && <span className="error">{msg}</span>}
        </form>
      </div>

      <h2>History & reconciliation</h2>
      <div className="card table-card tight">
        <table>
          <thead>
            <tr><th>Month</th><th>Account</th><th className="num">Observed</th><th className="num">Model predicted</th><th className="num">Variance</th><th></th></tr>
          </thead>
          <tbody>
            {data.reconciled.map((r) => (
              <tr key={r.id}>
                <td>{r.month}{r.month === data.anchored_at && <span className="pill-badge accent-badge">anchor</span>}</td>
                <td>{r.account_name}</td>
                <td className="num">{eur(r.balance)}</td>
                <td className="num">{eur(r.predicted)}</td>
                <td className={`num ${r.variance >= 0 ? 'good' : 'bad'}`}>
                  {r.variance >= 0 ? '+' : ''}{eur(r.variance)}
                </td>
                <td>
                  <button
                    className="btn danger small"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete the ${r.month} observation for ${r.account_name}?`,
                        message: 'The projection will re-anchor to the next remaining observation.',
                        danger: true,
                        confirmLabel: 'Delete',
                      });
                      if (ok) {
                        await api.del(`/balances/${r.id}`);
                        load();
                      }
                    }}
                  >Delete</button>
                </td>
              </tr>
            ))}
            {data.reconciled.length === 0 && (
              <tr><td colSpan="6" className="muted">No observations yet — enter your first real balance above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
