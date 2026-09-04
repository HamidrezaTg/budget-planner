import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Rules() {
  const { toast, confirm } = useDialogs();
  const [cats, setCats] = useState([]);
  const [accounts, setAccounts] = useState([]);
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
  const [choiceRule, setChoiceRule] = useState({ keyword: '', category_ids: [], account_id: '' });
  const [testTx, setTestTx] = useState({
    description: '',
    amount: '',
    account_id: '',
    tx_type: '',
  });
  const [testResult, setTestResult] = useState(null);
  const [ruleQuery, setRuleQuery] = useState('');
  const [ruleType, setRuleType] = useState('');
  const [ruleCategory, setRuleCategory] = useState('');
  const [ruleEnabled, setRuleEnabled] = useState('');

  const loadRules = useCallback(() => {
    const q = new URLSearchParams();
    if (ruleQuery.trim()) q.set('q', ruleQuery.trim());
    if (ruleType) q.set('type', ruleType);
    if (ruleCategory) q.set('category_id', ruleCategory);
    if (ruleEnabled) q.set('enabled', ruleEnabled);
    api
      .get(`/transactions/rules${q.toString() ? `?${q}` : ''}`)
      .then(setRules)
      .catch((e) => toast(e.message, 'error'));
  }, [ruleCategory, ruleEnabled, ruleQuery, ruleType, toast]);

  useEffect(() => {
    api
      .get('/categories')
      .then(setCats)
      .catch((e) => toast(e.message, 'error'));
    api
      .get('/categories/meta/all')
      .then((meta) => setAccounts(meta.accounts ?? []))
      .catch((e) => toast(e.message, 'error'));
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(loadRules, 200);
    return () => clearTimeout(t);
  }, [loadRules]);

  const addRule = async (e) => {
    e.preventDefault();
    if (!newRule.keyword.trim() || !newRule.category_id) return;
    try {
      await api.post('/transactions/rules', newRule);
      setNewRule({ keyword: '', category_id: '' });
      loadRules();
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
      loadRules();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const addChoiceRule = async (e) => {
    e.preventDefault();
    if (!choiceRule.keyword.trim() || choiceRule.category_ids.length < 2) return;
    try {
      await api.post('/transactions/rules/choice', {
        keyword: choiceRule.keyword.trim(),
        category_ids: choiceRule.category_ids.map(Number),
        account_id: choiceRule.account_id || null,
      });
      setChoiceRule({ keyword: '', category_ids: [], account_id: '' });
      toast('Choice rule added — matching transactions will ask you to pick a category.');
      loadRules();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const toggleRuleEnabled = async (rule) => {
    try {
      await api.patch(`/transactions/rules/${rule.rule_type}/${rule.id}`, {
        enabled: rule.enabled ? 0 : 1,
      });
      loadRules();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const retargetKeywordRule = async (rule, categoryId) => {
    if (!categoryId) return;
    try {
      await api.patch(`/transactions/rules/${rule.id}`, { category_id: Number(categoryId) });
      loadRules();
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

  const deleteRule = async (rule) => {
    const description =
      rule.rule_type === 'advanced'
        ? [
            rule.description_contains && `desc: ${rule.description_contains}`,
            rule.amount_min != null && `≥ €${rule.amount_min}`,
            rule.amount_max != null && `≤ €${rule.amount_max}`,
            rule.account_id && 'account',
            rule.tx_type && `type: ${rule.tx_type}`,
          ]
            .filter(Boolean)
            .join(' · ')
        : rule.rule_type === 'choice'
          ? `${rule.keyword} → choose between ${(rule.categories ?? []).map((c) => c.category_name).join(', ')}`
          : rule.keyword;
    const ok = await confirm({
      title: 'Delete this rule?',
      message: `"${description}" will stop matching new transactions. Existing transactions keep their categories.`,
      danger: true,
      confirmLabel: 'Delete rule',
    });
    if (!ok) return;
    try {
      await api.del(
        `/transactions/rules${rule.rule_type === 'advanced' ? '/advanced' : ''}${rule.rule_type === 'choice' ? '/choice' : ''}/${rule.id}`,
      );
      loadRules();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div>
      <h1>Categorization rules</h1>
      <p className="muted">
        Rules apply categories to future imports. Choice rules never guess — they send the
        transaction to review and let you pick between their categories.
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

      <h3 style={{ margin: '18px 0 6px' }}>Category choice rule</h3>
      <p className="muted">
        For keywords that can legitimately belong to several categories, matching transactions land
        in the review queue with these candidate categories.
      </p>
      <form onSubmit={addChoiceRule} className="card inline-form rule-form">
        <input
          placeholder="Keyword (e.g. amazon)"
          title="Matching transactions are sent to review instead of being auto-categorized"
          value={choiceRule.keyword}
          onChange={(e) => setChoiceRule({ ...choiceRule, keyword: e.target.value })}
          required
        />
        <select
          title="Optional: restrict the rule to one account"
          value={choiceRule.account_id}
          onChange={(e) => setChoiceRule({ ...choiceRule, account_id: e.target.value })}
        >
          <option value="">Any account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          title="Pick two or more candidate categories"
          value=""
          onChange={(e) => {
            if (e.target.value) {
              const id = Number(e.target.value);
              setChoiceRule((p) => ({
                ...p,
                category_ids: p.category_ids.includes(id)
                  ? p.category_ids.filter((c) => c !== id)
                  : [...p.category_ids, id],
              }));
            }
          }}
        >
          <option value="">
            {choiceRule.category_ids.length
              ? `${choiceRule.category_ids.length} candidate(s) — click to add more`
              : '→ Candidate categories (pick 2+)'}
          </option>
          {cats
            .filter((c) => c.is_active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {choiceRule.category_ids.includes(c.id) ? '✓ ' : ''}
                {c.name}
              </option>
            ))}
        </select>
        <button
          className="btn primary"
          title="Add this choice rule"
          disabled={choiceRule.category_ids.length < 2 || !choiceRule.keyword.trim()}
        >
          Add choice rule
        </button>
      </form>

      <div className="card inline-form rule-form" style={{ marginTop: 10 }}>
        <input
          placeholder="Search rules…"
          title="Filter rules by keyword, condition, or category name"
          value={ruleQuery}
          onChange={(e) => setRuleQuery(e.target.value)}
        />
        <select
          title="Filter by rule type"
          value={ruleType}
          onChange={(e) => setRuleType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="keyword">Keyword</option>
          <option value="advanced">Advanced</option>
          <option value="choice">Choice</option>
        </select>
        <select
          title="Filter by category"
          value={ruleCategory}
          onChange={(e) => setRuleCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          title="Filter by enabled state"
          value={ruleEnabled}
          onChange={(e) => setRuleEnabled(e.target.value)}
        >
          <option value="">Enabled + disabled</option>
          <option value="1">Enabled only</option>
          <option value="0">Disabled only</option>
        </select>
        <span className="muted tiny" style={{ alignSelf: 'center' }}>
          {rules.length} rule{rules.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="card table-card tight">
        <table>
          <thead>
            <tr>
              <th>Rule</th>
              <th>Type</th>
              <th>Category</th>
              <th>Matches</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr
                key={`${rule.rule_type}-${rule.id}`}
                className={rule.enabled === 0 ? 'done-row' : ''}
              >
                <td>
                  <code>
                    {rule.rule_type === 'advanced'
                      ? [
                          rule.description_contains && `desc: ${rule.description_contains}`,
                          rule.amount_min != null && `≥ €${rule.amount_min}`,
                          rule.amount_max != null && `≤ €${rule.amount_max}`,
                          rule.account_id && 'account',
                          rule.tx_type && `type: ${rule.tx_type}`,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : rule.keyword}
                  </code>
                </td>
                <td>
                  <span className="pill-badge">{rule.rule_type}</span>
                </td>
                <td>
                  {rule.rule_type === 'choice' ? (
                    <span className="muted">
                      Choose:{' '}
                      {(rule.categories ?? []).map((c) => c.category_name).join(', ') || '—'}
                    </span>
                  ) : rule.rule_type === 'keyword' ? (
                    <select
                      value={rule.category_id}
                      title="Change the category this keyword assigns"
                      className="plain"
                      onChange={(e) => retargetKeywordRule(rule, e.target.value)}
                    >
                      {cats
                        .filter((c) => c.is_active || c.id === rule.category_id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  ) : (
                    rule.category_name
                  )}
                </td>
                <td>{rule.rule_type === 'choice' ? '—' : rule.matches}</td>
                <td>
                  {rule.rule_type === 'keyword' ? (
                    <span className="muted tiny">always on</span>
                  ) : (
                    <button
                      className="btn ghost small"
                      title={rule.enabled ? 'Disable this rule' : 'Enable this rule'}
                      onClick={() => toggleRuleEnabled(rule)}
                    >
                      {rule.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                  )}
                </td>
                <td>
                  <button
                    className="btn danger small"
                    title={`Delete this ${rule.rule_type} rule`}
                    onClick={() => deleteRule(rule)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan="6" className="muted">
                  No rules match — clear the search or assign categories to learn.
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
          {accounts.map((a) => (
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
          {accounts.map((a) => (
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
          <span className={testResult.choice || testResult.category_id ? 'good' : 'muted'}>
            {testResult.choice
              ? `→ ask: ${testResult.candidates.map((c) => c.category_name).join(' / ')}`
              : testResult.category_id
                ? `→ ${testResult.category_name || 'matched category'}`
                : 'No matching rule'}
          </span>
        )}
      </form>
    </div>
  );
}
