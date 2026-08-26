import React, { useEffect, useState } from 'react';
import { api, eur } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

// Category management (groups, accounts, active dates) + learned keyword rules.
export default function Categories() {
  const { toast } = useDialogs();
  const [cats, setCats] = useState([]);
  const [meta, setMeta] = useState({ groups: [], accounts: [] });
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState({ keyword: '', category_id: '' });

  const load = () => {
    api.get('/categories').then(setCats);
    api.get('/transactions/rules/all').then(setRules);
  };
  useEffect(() => { load(); api.get('/categories/meta/all').then(setMeta); }, []);

  const patch = async (id, body) => {
    try { await api.patch(`/categories/${id}`, body); load(); }
    catch (e) { toast(e.message, 'error'); }
  };

  const addRule = async (e) => {
    e.preventDefault();
    if (!newRule.keyword.trim() || !newRule.category_id) return;
    await api.post('/transactions/rules', newRule);
    setNewRule({ keyword: '', category_id: '' });
    load();
  };

  return (
    <div>
      <h1>Categories</h1>
      <p className="muted">
        Every category belongs to exactly one account. Retiring a category clears its plan and
        rules so nothing phantom survives.
      </p>

      <div className="card table-card">
        <table>
          <thead>
            <tr><th>Category</th><th>Group</th><th>Account</th><th className="num">Plan €/mo</th><th>Status</th></tr>
          </thead>
          <tbody>
            {cats.map((c) => (
              <tr key={c.id} className={c.is_active ? '' : 'done-row'}>
                <td>{c.name}</td>
                <td className="muted">{c.group_name}</td>
                <td>
                  <select
                    value=""
                    className={c.account_name ? 'plain' : 'missing'}
                    onChange={(e) => patch(c.id, { account_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">{c.account_name ?? '— untagged —'}</option>
                    {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </td>
                <td className="num muted">{eur(c.monthly_budget)}</td>
                <td>
                  {c.is_active ? (
                    <button className="btn ghost small" onClick={() => patch(c.id, { is_active: false })}>
                      Retire
                    </button>
                  ) : (
                    <>
                      <span className="pill-badge">retired</span>{' '}
                      <button className="btn ghost small" onClick={() => patch(c.id, { is_active: true })}>
                        Reactivate
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Categorization rules</h2>
      <p className="muted">
        Rules are learned automatically when you assign a category to an unknown merchant in the
        review queue. You can also add them manually here.
      </p>
      <form onSubmit={addRule} className="card inline-form rule-form">
        <input
          placeholder="Keyword (matches description)"
          value={newRule.keyword}
          onChange={(e) => setNewRule({ ...newRule, keyword: e.target.value })}
        />
        <select
          value={newRule.category_id}
          onChange={(e) => setNewRule({ ...newRule, category_id: e.target.value })}
        >
          <option value="">→ Category</option>
          {cats.filter((c) => c.is_active).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="btn primary">Add rule</button>
      </form>
      <div className="card table-card tight">
        <table>
          <thead><tr><th>Keyword</th><th>Category</th><th>Matches</th><th></th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td><code>{r.keyword}</code></td>
                <td>{r.category_name}</td>
                <td>{r.matches}</td>
                <td>
                  <button
                    className="btn danger small"
                    onClick={() => api.del(`/transactions/rules/${r.id}`).then(load)}
                  >Delete</button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan="4" className="muted">No rules yet — assign categories to learn.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
