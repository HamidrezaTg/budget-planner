import React, { useEffect, useState } from 'react';
import { api, eur } from '../api.js';

export default function Recurring() {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState({ accounts: [], groups: [] });
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState({ name: '', amount: '', day_of_month: '1', account_id: '', category_id: '', auto_post: false });

  const load = () => api.get('/recurrences').then(setData);
  useEffect(() => {
    load();
    api.get('/categories/meta/all').then(setMeta);
    api.get('/categories').then(setCats);
  }, []);
  if (!data) return <div className="loading">Loading…</div>;

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post('/recurrences', {
        ...form,
        amount: Number(form.amount),
        day_of_month: Number(form.day_of_month),
        account_id: form.account_id || null,
        category_id: form.category_id || null,
      });
      setForm({ name: '', amount: '', day_of_month: '1', account_id: '', category_id: '', auto_post: false });
      load();
    } catch (err) {
      alert(err.message);
    }
  };

  const toggle = async (r, field) => {
    await api.patch(`/recurrences/${r.id}`, { [field]: !r[field] });
    load();
  };

  const post = async (u) => {
    await api.post(`/recurrences/${u.recurrence_id}/post`, { month: u.month });
    load();
  };

  const expected = data.upcoming.reduce((s, u) => s + u.amount, 0);

  return (
    <div>
      <h1>Recurring</h1>
      <p className="muted">
        Expected monthly transactions — rent, subscriptions, salary. They appear in
        the Upcoming panel on the Dashboard and can post themselves automatically on
        their day, or wait for you to confirm.
      </p>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Upcoming</p>
            <h2>Next occurrences</h2>
          </div>
          <span className="count-pill">{data.upcoming.length} items · {eur(expected)}</span>
        </div>
        {data.upcoming.length === 0 && <div className="muted">Nothing upcoming.</div>}
        {data.upcoming.map((u, i) => (
          <div key={i} className="bill-row">
            <div className="bill-date"><strong>{String(u.day).padStart(2, '0')}</strong><span>{u.month}</span></div>
            <div className="transaction-main">
              <strong>{u.name}</strong>
              <small>{u.auto_post ? 'auto-posts' : 'manual'}</small>
            </div>
            <button className="btn small" onClick={() => post(u)}>Post now</button>
            <b className={u.amount >= 0 ? 'income' : ''}>{eur(u.amount)}</b>
          </div>
        ))}
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr><th>Name</th><th>Day</th><th className="num">Amount</th><th>Account</th><th>Category</th><th>Auto</th><th>Active</th><th></th></tr>
          </thead>
          <tbody>
            {data.recurrences.map((r) => (
              <tr key={r.id} className={r.active ? '' : 'done-row'}>
                <td>{r.name}</td>
                <td>{r.day_of_month}</td>
                <td className={`num ${r.amount >= 0 ? 'income' : ''}`}>{eur(r.amount)}</td>
                <td className="muted">{r.account_name ?? '—'}</td>
                <td className="muted">{r.category_name ?? '—'}</td>
                <td>
                  <button className={`btn ghost small ${r.auto_post ? 'active' : ''}`} onClick={() => toggle(r, 'auto_post')}>
                    {r.auto_post ? 'auto' : 'manual'}
                  </button>
                </td>
                <td>
                  <button className="btn ghost small" onClick={() => toggle(r, 'active')}>
                    {r.active ? 'pause' : 'resume'}
                  </button>
                </td>
                <td>
                  <button className="btn danger small" onClick={() => api.del(`/recurrences/${r.id}`).then(load)}>Delete</button>
                </td>
              </tr>
            ))}
            {data.recurrences.length === 0 && (
              <tr><td colSpan="8" className="muted">No recurring transactions yet — add your first below.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} className="card inline-form">
        <input placeholder="Name (e.g. Rent)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input
          placeholder="€ (− expense, + income)" type="number" step="0.01" style={{ width: 150 }}
          value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
        <label>Day
          <input type="number" min="1" max="28" style={{ width: 70 }} value={form.day_of_month}
            onChange={(e) => setForm({ ...form, day_of_month: e.target.value })} />
        </label>
        <select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
          <option value="">Account…</option>
          {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
          <option value="">Category…</option>
          {cats.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="muted" style={{ flexDirection: 'row', alignItems: 'center', textTransform: 'none', letterSpacing: 0 }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={form.auto_post}
            onChange={(e) => setForm({ ...form, auto_post: e.target.checked })} /> auto-post
        </label>
        <button className="btn primary">Add</button>
      </form>
    </div>
  );
}
