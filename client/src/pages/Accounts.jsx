import { useEffect, useState } from 'react';
import { api, eur } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

const kinds = [
  ['bank', 'Bank'],
  ['card', 'Card'],
  ['cash', 'Cash'],
  ['other', 'Other'],
];
const editKinds = [...kinds, ['sparkasse', 'Sparkasse'], ['revolut', 'Revolut']];

function kindLabel(kind) {
  return editKinds.find(([value]) => value === kind)?.[1] || kind || 'Other';
}

export default function Accounts() {
  const { confirm, toast } = useDialogs();
  const [accounts, setAccounts] = useState(null);
  const [persons, setPersons] = useState(null);
  const [form, setForm] = useState({
    name: '',
    kind: 'bank',
    opening_balance: '0',
    is_spending_pot: false,
  });
  const [editing, setEditing] = useState({});
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const load = () => {
    api
      .get('/accounts')
      .then(setAccounts)
      .catch((e) => setError(e.message));
    api
      .get('/persons')
      .then(setPersons)
      .catch((e) => setError(e.message));
  };
  useEffect(() => {
    load();
  }, []);

  const addAccount = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    try {
      await api.post('/accounts', {
        name: form.name.trim(),
        kind: form.kind,
        opening_balance: Number(form.opening_balance) || 0,
        is_spending_pot: form.is_spending_pot,
      });
      setForm({ name: '', kind: 'bank', opening_balance: '0', is_spending_pot: false });
      setShowAdd(false);
      setError('');
      toast(`Account "${form.name.trim()}" added.`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const startEdit = (account) =>
    setEditing((previous) => ({
      ...previous,
      [account.id]: {
        name: account.name,
        kind: editKinds.some(([value]) => value === account.kind) ? account.kind : 'other',
        opening_balance: String(account.opening_balance ?? 0),
        is_spending_pot: !!account.is_spending_pot,
      },
    }));

  const cancelEdit = (id) =>
    setEditing((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });

  const saveEdit = async (account) => {
    const edit = editing[account.id];
    if (!edit?.name.trim()) return setError('Account name is required.');
    try {
      await api.patch(`/accounts/${account.id}`, {
        name: edit.name.trim(),
        kind: edit.kind,
        opening_balance: Number(edit.opening_balance) || 0,
        is_spending_pot: !!edit.is_spending_pot,
      });
      cancelEdit(account.id);
      setError('');
      toast(`Account "${edit.name.trim()}" saved.`, 'ok');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (account) => {
    const ok = await confirm({
      title: `Delete account "${account.name}"?`,
      message:
        'This is only possible when no transactions or balance observations use the account. Existing data is never deleted accidentally.',
      danger: true,
      confirmLabel: 'Delete account',
    });
    if (!ok) return;
    try {
      await api.del(`/accounts/${account.id}`);
      setError('');
      toast(`Account "${account.name}" deleted.`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const [personName, setPersonName] = useState('');
  const [editingPerson, setEditingPerson] = useState({});

  const addPerson = async (event) => {
    event.preventDefault();
    if (!personName.trim()) return;
    try {
      await api.post('/persons', { name: personName.trim() });
      toast(`Person "${personName.trim()}" added.`);
      setPersonName('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const savePerson = async (person) => {
    const name = (editingPerson[person.id] ?? '').trim();
    if (!name) return setError('Person name is required.');
    try {
      await api.patch(`/persons/${person.id}`, { name });
      setEditingPerson((previous) => {
        const next = { ...previous };
        delete next[person.id];
        return next;
      });
      setError('');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const removePerson = async (person) => {
    const ok = await confirm({
      title: `Delete person "${person.name}"?`,
      message:
        'Income sources linked to this person stay intact; they will simply become unassigned.',
      danger: true,
      confirmLabel: 'Delete person',
    });
    if (!ok) return;
    try {
      await api.del(`/persons/${person.id}`);
      toast(`Person "${person.name}" deleted.`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!accounts)
    return <div className="loading">{error ? `Failed to load: ${error}` : 'Loading…'}</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">Money locations</p>
          <h1>Accounts</h1>
          <p className="muted">
            Keep bank accounts, cards, cash, and spending pots separate so balances stay
            explainable.
          </p>
        </div>
        <button className="btn primary" onClick={() => setShowAdd((open) => !open)}>
          {showAdd ? 'Cancel' : '+ Add account'}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {showAdd && (
        <form className="card inline-form" onSubmit={addAccount} style={{ marginBottom: 14 }}>
          <label className="muted tiny">
            Name
            <input
              autoFocus
              value={form.name}
              maxLength={60}
              placeholder="e.g. Main bank account"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label className="muted tiny">
            Type
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {kinds.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="muted tiny">
            Opening balance
            <input
              type="number"
              step="0.01"
              value={form.opening_balance}
              onChange={(e) => setForm({ ...form, opening_balance: e.target.value })}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={form.is_spending_pot}
              onChange={(e) => setForm({ ...form, is_spending_pot: e.target.checked })}
            />
            Spending pot
          </label>
          <button className="btn primary" type="submit" disabled={!form.name.trim()}>
            Create account
          </button>
        </form>
      )}

      <div className="card table-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Your setup</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>
              {accounts.length} account{accounts.length === 1 ? '' : 's'}
            </h2>
          </div>
          <span className="muted tiny">
            Opening balances are used as the starting point for reconciliation.
          </span>
        </div>
        {accounts.length === 0 ? (
          <div className="empty" style={{ padding: 20, textAlign: 'center' }}>
            <p className="muted">No accounts yet. Add the places where your money lives.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th className="num">Opening balance</th>
                <th>Spending pot</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const edit = editing[account.id];
                return (
                  <tr key={account.id}>
                    {edit ? (
                      <>
                        <td>
                          <input
                            value={edit.name}
                            maxLength={60}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                [account.id]: { ...edit, name: e.target.value },
                              })
                            }
                          />
                        </td>
                        <td>
                          <select
                            value={edit.kind}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                [account.id]: { ...edit, kind: e.target.value },
                              })
                            }
                          >
                            {editKinds.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">
                          <input
                            className="budget-input"
                            type="number"
                            step="0.01"
                            value={edit.opening_balance}
                            onChange={(e) =>
                              setEditing({
                                ...editing,
                                [account.id]: { ...edit, opening_balance: e.target.value },
                              })
                            }
                          />
                        </td>
                        <td>
                          <label className="check-label">
                            <input
                              type="checkbox"
                              checked={edit.is_spending_pot}
                              onChange={(e) =>
                                setEditing({
                                  ...editing,
                                  [account.id]: { ...edit, is_spending_pot: e.target.checked },
                                })
                              }
                            />{' '}
                            Yes
                          </label>
                        </td>
                        <td>
                          <button className="btn small primary" onClick={() => saveEdit(account)}>
                            Save
                          </button>
                          <button
                            className="btn small ghost"
                            onClick={() => cancelEdit(account.id)}
                          >
                            Cancel
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          <strong>{account.name}</strong>
                        </td>
                        <td>
                          <span className="count-pill">{kindLabel(account.kind)}</span>
                        </td>
                        <td className="num">{eur(account.opening_balance)}</td>
                        <td>
                          {account.is_spending_pot ? (
                            <span className="good">Yes</span>
                          ) : (
                            <span className="muted">No</span>
                          )}
                        </td>
                        <td>
                          <button className="btn small ghost" onClick={() => startEdit(account)}>
                            Edit
                          </button>
                          <button className="btn small danger" onClick={() => remove(account)}>
                            Delete
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card table-card" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div>
            <p className="eyebrow">Income contacts</p>
            <h2 style={{ fontSize: 18, margin: 0 }}>People</h2>
          </div>
          <span className="muted tiny">Use these names when assigning income sources.</span>
        </div>
        <form className="inline-form" onSubmit={addPerson} style={{ padding: '0 16px 14px' }}>
          <input
            value={personName}
            maxLength={60}
            placeholder="Person name"
            onChange={(e) => setPersonName(e.target.value)}
          />
          <button className="btn primary small" type="submit" disabled={!personName.trim()}>
            Add person
          </button>
        </form>
        {persons === null ? (
          <div className="muted" style={{ padding: '0 16px 16px' }}>
            Loading people…
          </div>
        ) : persons.length === 0 ? (
          <div className="muted" style={{ padding: '0 16px 16px' }}>
            No people added yet.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {persons.map((person) => (
                <tr key={person.id}>
                  <td>
                    {editingPerson[person.id] !== undefined ? (
                      <input
                        value={editingPerson[person.id]}
                        onChange={(e) =>
                          setEditingPerson({ ...editingPerson, [person.id]: e.target.value })
                        }
                      />
                    ) : (
                      <strong>{person.name}</strong>
                    )}
                  </td>
                  <td>
                    {editingPerson[person.id] !== undefined ? (
                      <>
                        <button className="btn small primary" onClick={() => savePerson(person)}>
                          Save
                        </button>
                        <button
                          className="btn small ghost"
                          onClick={() =>
                            setEditingPerson((previous) => {
                              const next = { ...previous };
                              delete next[person.id];
                              return next;
                            })
                          }
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn small ghost"
                        onClick={() =>
                          setEditingPerson({ ...editingPerson, [person.id]: person.name })
                        }
                      >
                        Edit
                      </button>
                    )}
                    <button className="btn small danger" onClick={() => removePerson(person)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
