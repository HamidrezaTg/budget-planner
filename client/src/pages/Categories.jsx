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
  const [advancedRule, setAdvancedRule] = useState({ description_contains: '', amount_min: '', amount_max: '', account_id: '', tx_type: '', category_id: '', priority: '0' });
  const [testTx, setTestTx] = useState({ description: '', amount: '', account_id: '', tx_type: '' });
  const [testResult, setTestResult] = useState(null);

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

  const addAdvancedRule = async (e) => {
    e.preventDefault();
    try {
      await api.post('/transactions/rules/advanced', {
        ...advancedRule,
        amount_min: advancedRule.amount_min || null,
        amount_max: advancedRule.amount_max || null,
        account_id: advancedRule.account_id || null,
        category_id: Number(advancedRule.category_id),
        priority: Number(advancedRule.priority) || 0,
      });
      setAdvancedRule({ description_contains: '', amount_min: '', amount_max: '', account_id: '', tx_type: '', category_id: '', priority: '0' });
      load();
    } catch (e) { toast(e.message, 'error'); }
  };

  const testRule = async (e) => {
    e.preventDefault();
    try {
      setTestResult(await api.post('/transactions/rules/test', { ...testTx, amount: Number(testTx.amount) || 0 }));
    } catch (e) { toast(e.message, 'error'); }
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
          <thead><tr><th>Rule</th><th>Type</th><th>Category</th><th>Matches</th><th></th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={`${r.rule_type}-${r.id}`}>
                <td><code>{r.rule_type === 'advanced'
                  ? [r.description_contains && `desc: ${r.description_contains}`, r.amount_min != null && `≥ €${r.amount_min}`, r.amount_max != null && `≤ €${r.amount_max}`, r.account_id && 'account', r.tx_type && `type: ${r.tx_type}`].filter(Boolean).join(' · ')
                  : r.keyword}</code></td>
                <td><span className="pill-badge">{r.rule_type}</span></td>
                <td>{r.category_name}</td>
                <td>{r.matches}</td>
                <td>
                  <button
                    className="btn danger small"
                    onClick={() => api.del(`/transactions/rules${r.rule_type === 'advanced' ? '/advanced' : ''}/${r.id}`).then(load)}
                  >Delete</button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan="5" className="muted">No rules yet — assign categories to learn.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Advanced rule</h2>
      <p className="muted">Combine any conditions. Amount limits use the absolute transaction amount; higher priority rules win.</p>
      <form onSubmit={addAdvancedRule} className="card inline-form rule-form">
        <input placeholder="Description contains" value={advancedRule.description_contains}
          onChange={(e) => setAdvancedRule({ ...advancedRule, description_contains: e.target.value })} />
        <input type="number" step="0.01" placeholder="Min €" value={advancedRule.amount_min}
          onChange={(e) => setAdvancedRule({ ...advancedRule, amount_min: e.target.value })} />
        <input type="number" step="0.01" placeholder="Max €" value={advancedRule.amount_max}
          onChange={(e) => setAdvancedRule({ ...advancedRule, amount_max: e.target.value })} />
        <select value={advancedRule.account_id} onChange={(e) => setAdvancedRule({ ...advancedRule, account_id: e.target.value })}>
          <option value="">Any account</option>
          {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input placeholder="Type (e.g. Card)" value={advancedRule.tx_type}
          onChange={(e) => setAdvancedRule({ ...advancedRule, tx_type: e.target.value })} />
        <select value={advancedRule.category_id} onChange={(e) => setAdvancedRule({ ...advancedRule, category_id: e.target.value })}>
          <option value="">→ Category</option>
          {cats.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="number" step="1" placeholder="Priority" title="Higher priority rules are evaluated first" value={advancedRule.priority}
          onChange={(e) => setAdvancedRule({ ...advancedRule, priority: e.target.value })} />
        <button className="btn primary">Add advanced rule</button>
      </form>

      <h2>Rule tester</h2>
      <p className="muted">Preview which rule would categorize a transaction. Testing never writes data.</p>
      <form onSubmit={testRule} className="card inline-form rule-form">
        <input placeholder="Description" value={testTx.description}
          onChange={(e) => setTestTx({ ...testTx, description: e.target.value })} />
        <input type="number" step="0.01" placeholder="Amount €" value={testTx.amount}
          onChange={(e) => setTestTx({ ...testTx, amount: e.target.value })} />
        <select value={testTx.account_id} onChange={(e) => setTestTx({ ...testTx, account_id: e.target.value })}>
          <option value="">Any account</option>
          {meta.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input placeholder="Type" value={testTx.tx_type}
          onChange={(e) => setTestTx({ ...testTx, tx_type: e.target.value })} />
        <button className="btn">Test</button>
        {testResult && <span className={testResult.category_id ? 'good' : 'muted'}>
          {testResult.category_id ? `→ ${testResult.category_name || 'matched category'}` : 'No matching rule'}
        </span>}
      </form>
    </div>
  );
}
