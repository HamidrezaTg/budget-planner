import { useEffect, useState } from 'react';
import { api, eur } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

// Category management: groups, categories, learned rules, advanced rules,
// rule tester. The page also exposes inline add/edit/delete on every list so
// nothing lives only in seed data any more.
export default function Categories() {
  const { toast, confirm } = useDialogs();
  const [cats, setCats] = useState([]);
  const [meta, setMeta] = useState({ groups: [], accounts: [] });
  const [rules, setRules] = useState([]);
  const [newRule, setNewRule] = useState({ keyword: '', category_id: '' });
  const [advancedRule, setAdvancedRule] = useState({
    description_contains: '',
    amount_min: '',
    amount_max: '',
    account_id: '',
    tx_type: '',
    category_id: '',
    priority: '0',
  });
  const [testTx, setTestTx] = useState({
    description: '',
    amount: '',
    account_id: '',
    tx_type: '',
  });
  const [testResult, setTestResult] = useState(null);
  const [error, setError] = useState('');

  // Add forms.
  const [showAddCat, setShowAddCat] = useState(false);
  const [addCat, setAddCat] = useState({
    name: '',
    group_id: '',
    account_id: '',
    monthly_budget: 0,
  });
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [addGroup, setAddGroup] = useState({ name: '' });

  // Per-category inline edit state.
  const [editingCat, setEditingCat] = useState({}); // { [catId]: { name, group_id, account_id, monthly_budget, is_active, _saving } }
  // Per-group inline rename state.
  const [renamingGroup, setRenamingGroup] = useState({});

  const load = () => {
    api
      .get('/categories')
      .then(setCats)
      .catch((e) => toast(e.message, 'error'));
    api
      .get('/transactions/rules/all')
      .then(setRules)
      .catch((e) => toast(e.message, 'error'));
  };
  useEffect(() => {
    load();
    api
      .get('/categories/meta/all')
      .then(setMeta)
      .catch(() => {});
  }, []);

  const patch = async (id, body, confirmOptions) => {
    if (confirmOptions) {
      const ok = await confirm(confirmOptions);
      if (!ok) return;
    }
    try {
      await api.patch(`/categories/${id}`, body);
      setError('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const removeCategory = async (c) => {
    const ok = await confirm({
      title: `Delete category "${c.name}"?`,
      message:
        'If any transactions are still tagged with it, deletion is refused — retire the category instead so the history is kept.',
      danger: true,
      confirmLabel: 'Delete category',
    });
    if (!ok) return;
    try {
      await api.del(`/categories/${c.id}`);
      toast(`Category "${c.name}" deleted.`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const removeGroup = async (g) => {
    const used = cats.filter((c) => c.group_id === g.id).length;
    const ok = await confirm({
      title: `Delete group "${g.name}"?`,
      message: used
        ? `${used} categor${used === 1 ? 'y is' : 'ies are'} in this group. They will become ungrouped (data is kept).`
        : 'No categories are in this group.',
      danger: true,
      confirmLabel: 'Delete group',
    });
    if (!ok) return;
    try {
      await api.del(`/categories/groups/${g.id}`);
      toast(`Group "${g.name}" deleted.`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const startEditCategory = (c) => {
    setEditingCat((p) => ({
      ...p,
      [c.id]: {
        name: c.name,
        group_id: c.group_id ?? '',
        account_id: c.account_id ?? '',
        monthly_budget: c.monthly_budget,
        is_active: !!c.is_active,
      },
    }));
  };
  const cancelEditCategory = (id) => {
    setEditingCat((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  };
  const saveEditCategory = async (c) => {
    const e = editingCat[c.id];
    if (!e) return;
    if (!e.name.trim()) {
      setError('Name is required.');
      return;
    }
    try {
      await api.patch(`/categories/${c.id}`, {
        name: e.name.trim(),
        group_id: e.group_id === '' ? null : Number(e.group_id),
        account_id: e.account_id === '' ? null : Number(e.account_id),
        monthly_budget: Number(e.monthly_budget) || 0,
        is_active: !!e.is_active,
      });
      setError('');
      cancelEditCategory(c.id);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const submitAddCategory = async (e) => {
    e.preventDefault();
    if (!addCat.name.trim()) return;
    try {
      await api.post('/categories', {
        name: addCat.name.trim(),
        group_id: addCat.group_id ? Number(addCat.group_id) : null,
        account_id: addCat.account_id ? Number(addCat.account_id) : null,
        monthly_budget: Number(addCat.monthly_budget) || 0,
        is_active: true,
      });
      setAddCat({ name: '', group_id: '', account_id: '', monthly_budget: 0 });
      setShowAddCat(false);
      toast(`Category "${addCat.name.trim()}" added.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const submitAddGroup = async (e) => {
    e.preventDefault();
    if (!addGroup.name.trim()) return;
    try {
      await api.post('/categories/groups', { name: addGroup.name.trim() });
      setAddGroup({ name: '' });
      setShowAddGroup(false);
      toast(`Group "${addGroup.name.trim()}" added.`);
      load();
      api
        .get('/categories/meta/all')
        .then(setMeta)
        .catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  };

  const startRenameGroup = (g) => setRenamingGroup((p) => ({ ...p, [g.id]: g.name }));
  const cancelRenameGroup = (id) =>
    setRenamingGroup((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
  const saveRenameGroup = async (g) => {
    const v = (renamingGroup[g.id] ?? '').trim();
    if (!v || v === g.name) {
      cancelRenameGroup(g.id);
      return;
    }
    try {
      await api.patch(`/categories/groups/${g.id}`, { name: v, sort: g.sort });
      cancelRenameGroup(g.id);
      load();
      api
        .get('/categories/meta/all')
        .then(setMeta)
        .catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  };

  const addRule = async (e) => {
    e.preventDefault();
    if (!newRule.keyword.trim() || !newRule.category_id) return;
    try {
      await api.post('/transactions/rules', newRule);
      setNewRule({ keyword: '', category_id: '' });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
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
      setAdvancedRule({
        description_contains: '',
        amount_min: '',
        amount_max: '',
        account_id: '',
        tx_type: '',
        category_id: '',
        priority: '0',
      });
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const testRule = async (e) => {
    e.preventDefault();
    try {
      setTestResult(
        await api.post('/transactions/rules/test', {
          ...testTx,
          amount: Number(testTx.amount) || 0,
        }),
      );
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const deleteRule = async (r) => {
    const ok = await confirm({
      title: 'Delete this rule?',
      message: `"${r.rule_type === 'advanced' ? [r.description_contains && `desc: ${r.description_contains}`, r.amount_min != null && `≥ €${r.amount_min}`, r.amount_max != null && `≤ €${r.amount_max}`, r.account_id && 'account', r.tx_type && `type: ${r.tx_type}`].filter(Boolean).join(' · ') : r.keyword}" will stop matching new transactions. Existing transactions keep their categories.`,
      danger: true,
      confirmLabel: 'Delete rule',
    });
    if (!ok) return;
    try {
      await api.del(`/transactions/rules${r.rule_type === 'advanced' ? '/advanced' : ''}/${r.id}`);
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div>
      <h1>Categories</h1>
      <p className="muted">
        Every category belongs to exactly one group (budget block) and one account. Retiring a
        category clears its plan and rules so nothing phantom survives.
      </p>
      {error && <div className="error">{error}</div>}

      {/* ----------------------------- Groups ----------------------------- */}
      <div className="card table-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Groups</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>Budget blocks</h2>
          </div>
          <button
            className="btn small"
            title="Create a new budget group"
            onClick={() => setShowAddGroup((s) => !s)}
          >
            {showAddGroup ? 'Cancel' : '+ Add group'}
          </button>
        </div>
        {showAddGroup && (
          <form onSubmit={submitAddGroup} className="add-cat-form">
            <input
              autoFocus
              placeholder="Group name (e.g. Personal care)"
              value={addGroup.name}
              onChange={(e) => setAddGroup({ name: e.target.value })}
              maxLength={40}
              required
            />
            <button className="btn primary small" type="submit" disabled={!addGroup.name.trim()}>
              Create group
            </button>
          </form>
        )}
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Sort</th>
              <th>Categories</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {meta.groups.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No groups yet — create one to organize your categories.
                </td>
              </tr>
            )}
            {meta.groups.map((g) => {
              const count = cats.filter((c) => c.group_id === g.id).length;
              return (
                <tr key={g.id}>
                  <td>
                    {renamingGroup[g.id] !== undefined ? (
                      <input
                        autoFocus
                        value={renamingGroup[g.id]}
                        onChange={(e) =>
                          setRenamingGroup((p) => ({ ...p, [g.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRenameGroup(g);
                          if (e.key === 'Escape') cancelRenameGroup(g.id);
                        }}
                        onBlur={() => saveRenameGroup(g)}
                        maxLength={40}
                      />
                    ) : (
                      g.name
                    )}
                  </td>
                  <td className="muted">{g.sort}</td>
                  <td className="muted">{count}</td>
                  <td>
                    {renamingGroup[g.id] !== undefined ? (
                      <>
                        <button
                          className="btn small primary"
                          onClick={() => saveRenameGroup(g)}
                          title="Save the new group name"
                        >
                          Save
                        </button>
                        <button
                          className="btn ghost small"
                          onClick={() => cancelRenameGroup(g.id)}
                          title="Cancel without renaming"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn ghost tiny-btn"
                          title={`Rename the "${g.name}" group`}
                          onClick={() => startRenameGroup(g)}
                        >
                          ✎
                        </button>
                        <button
                          className="btn danger tiny-btn"
                          title={`Delete the "${g.name}" group — its categories become ungrouped`}
                          onClick={() => removeGroup(g)}
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ----------------------------- Categories ----------------------------- */}
      <div className="card table-card" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">Categories</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>{cats.length} total</h2>
          </div>
          <button
            className="btn small"
            title="Create a new category"
            onClick={() => setShowAddCat((s) => !s)}
          >
            {showAddCat ? 'Cancel' : '+ Add category'}
          </button>
        </div>
        {showAddCat && (
          <form onSubmit={submitAddCategory} className="add-cat-form">
            <input
              autoFocus
              placeholder="Category name (e.g. Streaming)"
              value={addCat.name}
              onChange={(e) => setAddCat({ ...addCat, name: e.target.value })}
              maxLength={60}
              required
            />
            <select
              title="Group this category belongs to"
              value={addCat.group_id}
              onChange={(e) => setAddCat({ ...addCat, group_id: e.target.value })}
            >
              <option value="">No group…</option>
              {meta.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <select
              title="Account this category is paid from"
              value={addCat.account_id}
              onChange={(e) => setAddCat({ ...addCat, account_id: e.target.value })}
            >
              <option value="">— untagged —</option>
              {meta.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="€/month"
              title="Default monthly plan"
              value={addCat.monthly_budget}
              onChange={(e) => setAddCat({ ...addCat, monthly_budget: e.target.value })}
            />
            <button className="btn primary small" type="submit" disabled={!addCat.name.trim()}>
              Create category
            </button>
          </form>
        )}

        {cats.length === 0 && !showAddCat && (
          <div className="empty" style={{ padding: '20px 12px', textAlign: 'center' }}>
            <p className="muted">No categories yet. Add your first one to start budgeting.</p>
          </div>
        )}

        {cats.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Group</th>
                <th>Account</th>
                <th className="num">Plan €/mo</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => {
                const edit = editingCat[c.id];
                return (
                  <tr key={c.id} className={c.is_active ? '' : 'done-row'}>
                    <td>
                      {edit ? (
                        <input
                          autoFocus
                          value={edit.name}
                          onChange={(e) =>
                            setEditingCat((p) => ({
                              ...p,
                              [c.id]: { ...p[c.id], name: e.target.value },
                            }))
                          }
                          maxLength={60}
                        />
                      ) : (
                        c.name
                      )}
                    </td>
                    <td>
                      {edit ? (
                        <select
                          value={edit.group_id}
                          onChange={(e) =>
                            setEditingCat((p) => ({
                              ...p,
                              [c.id]: { ...p[c.id], group_id: e.target.value },
                            }))
                          }
                        >
                          <option value="">No group</option>
                          {meta.groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="muted">{c.group_name ?? '—'}</span>
                      )}
                    </td>
                    <td>
                      {edit ? (
                        <select
                          value={edit.account_id}
                          onChange={(e) =>
                            setEditingCat((p) => ({
                              ...p,
                              [c.id]: { ...p[c.id], account_id: e.target.value },
                            }))
                          }
                        >
                          <option value="">— untagged —</option>
                          {meta.accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          value=""
                          title="Change the account this category is paid from"
                          className={c.account_name ? 'plain' : 'missing'}
                          onChange={(e) =>
                            patch(c.id, {
                              account_id: e.target.value ? Number(e.target.value) : null,
                            })
                          }
                        >
                          <option value="">{c.account_name ?? '— untagged —'}</option>
                          {meta.accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="num">
                      {edit ? (
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          style={{ width: 100 }}
                          value={edit.monthly_budget}
                          onChange={(e) =>
                            setEditingCat((p) => ({
                              ...p,
                              [c.id]: { ...p[c.id], monthly_budget: e.target.value },
                            }))
                          }
                        />
                      ) : (
                        <span className="muted">{eur(c.monthly_budget)}</span>
                      )}
                    </td>
                    <td>
                      {edit ? (
                        <label
                          className="muted tiny"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <input
                            type="checkbox"
                            checked={!!edit.is_active}
                            onChange={(e) =>
                              setEditingCat((p) => ({
                                ...p,
                                [c.id]: { ...p[c.id], is_active: e.target.checked },
                              }))
                            }
                          />{' '}
                          active
                        </label>
                      ) : c.is_active ? (
                        <button
                          className="btn ghost small"
                          title="Retire — clears the monthly plan and rules, but keeps history"
                          onClick={() =>
                            patch(
                              c.id,
                              { is_active: false },
                              {
                                title: 'Retire this category?',
                                message:
                                  'Retiring clears its monthly plan and categorization rules so nothing phantom survives. You can reactivate it later.',
                                danger: true,
                                confirmLabel: 'Retire category',
                              },
                            )
                          }
                        >
                          Retire
                        </button>
                      ) : (
                        <>
                          <span className="pill-badge">retired</span>{' '}
                          <button
                            className="btn ghost small"
                            title="Reactivate this category"
                            onClick={() => patch(c.id, { is_active: true })}
                          >
                            Reactivate
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      {edit ? (
                        <>
                          <button
                            className="btn small primary"
                            title="Save the changes"
                            onClick={() => saveEditCategory(c)}
                          >
                            Save
                          </button>
                          <button
                            className="btn ghost small"
                            title="Cancel without saving"
                            onClick={() => cancelEditCategory(c.id)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="btn ghost tiny-btn"
                            title={`Edit "${c.name}"`}
                            onClick={() => startEditCategory(c)}
                          >
                            ✎
                          </button>
                          <button
                            className="btn danger tiny-btn"
                            title={`Delete "${c.name}" — refused if any transactions still use it`}
                            onClick={() => removeCategory(c)}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ----------------------------- Rules ----------------------------- */}
      <h2>Categorization rules</h2>
      <p className="muted">
        Rules are learned automatically when you assign a category to an unknown merchant in the
        review queue. You can also add them manually here.
      </p>
      <form onSubmit={addRule} className="card inline-form rule-form">
        <input
          placeholder="Keyword (matches description)"
          title="A keyword rule matches when the merchant description (lowercased, whitespace collapsed) equals or contains this keyword"
          value={newRule.keyword}
          onChange={(e) => setNewRule({ ...newRule, keyword: e.target.value })}
        />
        <select
          title="Category to apply when the rule matches"
          value={newRule.category_id}
          onChange={(e) => setNewRule({ ...newRule, category_id: e.target.value })}
        >
          <option value="">→ Category</option>
          {cats
            .filter((c) => c.is_active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <button className="btn primary" title="Add this keyword rule">
          Add rule
        </button>
      </form>
      <div className="card table-card tight">
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Type</th>
              <th>Category</th>
              <th>Matches</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={`${r.rule_type}-${r.id}`}>
                <td>
                  <code>
                    {r.rule_type === 'advanced'
                      ? [
                          r.description_contains && `desc: ${r.description_contains}`,
                          r.amount_min != null && `≥ €${r.amount_min}`,
                          r.amount_max != null && `≤ €${r.amount_max}`,
                          r.account_id && 'account',
                          r.tx_type && `type: ${r.tx_type}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : r.keyword}
                  </code>
                </td>
                <td>
                  <span className="pill-badge">{r.rule_type}</span>
                </td>
                <td>{r.category_name}</td>
                <td>{r.matches}</td>
                <td>
                  <button
                    className="btn danger small"
                    title={`Delete this ${r.rule_type} rule`}
                    onClick={() => deleteRule(r)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan="5" className="muted">
                  No rules yet — assign categories to learn.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2>Advanced rule</h2>
      <p className="muted">
        Combine any conditions. Amount limits use the absolute transaction amount; higher priority
        rules win.
      </p>
      <form onSubmit={addAdvancedRule} className="card inline-form rule-form">
        <input
          title="Match if description contains this text"
          placeholder="Description contains"
          value={advancedRule.description_contains}
          onChange={(e) =>
            setAdvancedRule({ ...advancedRule, description_contains: e.target.value })
          }
        />
        <input
          type="number"
          step="0.01"
          title="Match if the absolute amount is at least this"
          placeholder="Min €"
          value={advancedRule.amount_min}
          onChange={(e) => setAdvancedRule({ ...advancedRule, amount_min: e.target.value })}
        />
        <input
          type="number"
          step="0.01"
          title="Match if the absolute amount is at most this"
          placeholder="Max €"
          value={advancedRule.amount_max}
          onChange={(e) => setAdvancedRule({ ...advancedRule, amount_max: e.target.value })}
        />
        <select
          title="Match only transactions on this account"
          value={advancedRule.account_id}
          onChange={(e) => setAdvancedRule({ ...advancedRule, account_id: e.target.value })}
        >
          <option value="">Any account</option>
          {meta.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input
          title="Match the tx_type (e.g. Card)"
          placeholder="Type (e.g. Card)"
          value={advancedRule.tx_type}
          onChange={(e) => setAdvancedRule({ ...advancedRule, tx_type: e.target.value })}
        />
        <select
          title="Category to apply when the rule matches"
          value={advancedRule.category_id}
          onChange={(e) => setAdvancedRule({ ...advancedRule, category_id: e.target.value })}
        >
          <option value="">→ Category</option>
          {cats
            .filter((c) => c.is_active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
        <input
          type="number"
          step="1"
          placeholder="Priority"
          title="Higher priority rules are evaluated first"
          value={advancedRule.priority}
          onChange={(e) => setAdvancedRule({ ...advancedRule, priority: e.target.value })}
        />
        <button className="btn primary" title="Add this advanced rule">
          Add advanced rule
        </button>
      </form>

      <h2>Rule tester</h2>
      <p className="muted">
        Preview which rule would categorize a transaction. Testing never writes data.
      </p>
      <form onSubmit={testRule} className="card inline-form rule-form">
        <input
          title="A sample transaction description"
          placeholder="Description"
          value={testTx.description}
          onChange={(e) => setTestTx({ ...testTx, description: e.target.value })}
        />
        <input
          type="number"
          step="0.01"
          title="Signed amount (negative = spend)"
          placeholder="Amount €"
          value={testTx.amount}
          onChange={(e) => setTestTx({ ...testTx, amount: e.target.value })}
        />
        <select
          title="Account the sample transaction is on"
          value={testTx.account_id}
          onChange={(e) => setTestTx({ ...testTx, account_id: e.target.value })}
        >
          <option value="">Any account</option>
          {meta.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input
          title="tx_type of the sample transaction"
          placeholder="Type"
          value={testTx.tx_type}
          onChange={(e) => setTestTx({ ...testTx, tx_type: e.target.value })}
        />
        <button className="btn" title="Find the rule that would match this transaction">
          Test
        </button>
        {testResult && (
          <span className={testResult.category_id ? 'good' : 'muted'}>
            {testResult.category_id
              ? `→ ${testResult.category_name || 'matched category'}`
              : 'No matching rule'}
          </span>
        )}
      </form>
    </div>
  );
}
