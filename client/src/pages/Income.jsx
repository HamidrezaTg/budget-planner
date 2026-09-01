import { useEffect, useState } from 'react';
import { api, eur, monthLabel } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';
import { useWorkingMonth } from '../components/WorkingMonth.jsx';

export default function Income() {
  const { month } = useWorkingMonth();
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const [error, setError] = useState('');
  const { prompt, confirm, toast } = useDialogs();
  const [persons, setPersons] = useState([]);
  const [sourceForm, setSourceForm] = useState({
    name: '',
    current_amount: '',
    person_id: '',
    recurring: true,
  });
  const [sourceEdits, setSourceEdits] = useState({});

  const load = () =>
    api
      .get(`/income?month=${month}`)
      .then((d) => {
        setData(d);
        setEdits({});
        setSourceEdits(
          Object.fromEntries(
            d.sources.map((source) => [
              source.id,
              {
                name: source.name,
                current_amount: String(source.current_amount ?? 0),
                person_id: source.person_id ?? '',
                recurring: !!source.recurring,
              },
            ]),
          ),
        );
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [month]);
  useEffect(() => {
    api
      .get('/persons')
      .then(setPersons)
      .catch(() => {});
  }, []);

  const addSource = async (event) => {
    event.preventDefault();
    if (!sourceForm.name.trim()) return;
    try {
      await api.post('/income/sources', {
        ...sourceForm,
        name: sourceForm.name.trim(),
        current_amount: Number(sourceForm.current_amount) || 0,
        person_id: sourceForm.person_id || null,
      });
      setSourceForm({ name: '', current_amount: '', person_id: '', recurring: true });
      toast(`Income source "${sourceForm.name.trim()}" added.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveSource = async (source) => {
    const edit = sourceEdits[source.id];
    if (!edit?.name.trim()) return setError('Income source name is required.');
    try {
      await api.patch(`/income/sources/${source.id}`, {
        ...edit,
        name: edit.name.trim(),
        current_amount: Number(edit.current_amount) || 0,
        person_id: edit.person_id || null,
      });
      toast(`Income source "${edit.name.trim()}" saved.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeSource = async (source) => {
    const ok = await confirm({
      title: `Delete income source "${source.name}"?`,
      message:
        'Its monthly actual entries will also be removed. Other income sources are unchanged.',
      danger: true,
      confirmLabel: 'Delete source',
    });
    if (!ok) return;
    try {
      await api.del(`/income/sources/${source.id}`);
      toast(`Income source "${source.name}" deleted.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };
  if (!data)
    return <div className="loading">{error ? `Failed to load: ${error}` : 'Loading…'}</div>;

  const save = async (s) => {
    const e = edits[s.id];
    if (e === undefined) return;
    try {
      const entry = e.entry;
      await api.put(`/income/${month}/${s.id}`, {
        amount: entry !== undefined ? (entry === '' ? null : Number(entry)) : s.entry_amount,
        current_amount: e.current !== undefined ? Number(e.current) || 0 : undefined,
      });
      setError('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Income — {monthLabel(month)}</h1>
      </div>
      <p className="muted">
        Actual income must be entered, not assumed. The “usual” amount is used by the projection
        unless a month has its own entry.
      </p>

      {error && <div className="error">{error}</div>}

      <div className="card income-sources-card">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Income setup</p>
            <h2>Income sources</h2>
          </div>
          <span className="muted tiny">Add each salary or recurring income separately.</span>
        </div>
        <form className="income-source-form" onSubmit={addSource}>
          <input
            placeholder="Source name, e.g. Salary"
            value={sourceForm.name}
            onChange={(e) => setSourceForm({ ...sourceForm, name: e.target.value })}
            maxLength={80}
            required
          />
          <input
            type="number"
            step="0.01"
            placeholder="Usual amount"
            value={sourceForm.current_amount}
            onChange={(e) => setSourceForm({ ...sourceForm, current_amount: e.target.value })}
          />
          <select
            value={sourceForm.person_id}
            onChange={(e) => setSourceForm({ ...sourceForm, person_id: e.target.value })}
          >
            <option value="">No person</option>
            {persons.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <label className="check-label">
            <input
              type="checkbox"
              checked={sourceForm.recurring}
              onChange={(e) => setSourceForm({ ...sourceForm, recurring: e.target.checked })}
            />
            Recurring
          </label>
          <button className="btn primary" type="submit" disabled={!sourceForm.name.trim()}>
            Add source
          </button>
        </form>
        <div className="income-source-list">
          {data.sources.map((source) => {
            const edit = sourceEdits[source.id] ?? {};
            return (
              <div className="income-source-row" key={source.id}>
                <input
                  aria-label={`${source.name} source name`}
                  value={edit.name ?? ''}
                  onChange={(e) =>
                    setSourceEdits((p) => ({
                      ...p,
                      [source.id]: { ...edit, name: e.target.value },
                    }))
                  }
                />
                <input
                  aria-label={`${source.name} usual amount`}
                  type="number"
                  step="0.01"
                  value={edit.current_amount ?? ''}
                  onChange={(e) =>
                    setSourceEdits((p) => ({
                      ...p,
                      [source.id]: { ...edit, current_amount: e.target.value },
                    }))
                  }
                />
                <select
                  aria-label={`${source.name} person`}
                  value={edit.person_id ?? ''}
                  onChange={(e) =>
                    setSourceEdits((p) => ({
                      ...p,
                      [source.id]: { ...edit, person_id: e.target.value },
                    }))
                  }
                >
                  <option value="">No person</option>
                  {persons.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={!!edit.recurring}
                    onChange={(e) =>
                      setSourceEdits((p) => ({
                        ...p,
                        [source.id]: { ...edit, recurring: e.target.checked },
                      }))
                    }
                  />
                  Recurring
                </label>
                <button className="btn small primary" onClick={() => saveSource(source)}>
                  Save
                </button>
                <button className="btn small danger" onClick={() => removeSource(source)}>
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card stat big-income">
        <div className="stat-label">Total income this month</div>
        <div className="stat-value income">{eur(data.total)}</div>
      </div>

      <div className="card table-card" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Person</th>
              <th className="num">Usual</th>
              <th className="num">Actual for {monthLabel(month)}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name}
                  {!s.recurring && <span className="muted tiny"> one-off</span>}
                </td>
                <td className="muted">{s.person_name ?? '—'}</td>
                <td className="num">
                  {eur(s.current_amount)}
                  <button
                    className="btn ghost tiny-btn"
                    title="Edit usual amount"
                    onClick={async () => {
                      const v = await prompt({
                        title: `Usual monthly amount — ${s.name}`,
                        label: 'Used by the projection for months without an actual entry',
                        initial: String(s.current_amount),
                      });
                      if (v === null) return;
                      // Include the month's current entry: a PUT without an
                      // `amount` means "remove this month's actual entry" on
                      // the server, which silently wiped real income.
                      await api.put(`/income/${month}/${s.id}`, {
                        current_amount: Number(v) || 0,
                        amount: s.entry_amount ?? null,
                      });
                      load();
                    }}
                  >
                    ✎
                  </button>
                </td>
                <td className="num">
                  <input
                    className="budget-input"
                    type="number"
                    step="0.01"
                    title="Actual income for this month — leave blank to use the usual amount"
                    placeholder={String(s.current_amount)}
                    defaultValue={s.entry_amount ?? ''}
                    key={`${month}-${s.id}-${String(s.entry_amount)}`}
                    onChange={(e) =>
                      setEdits((p) => ({
                        ...p,
                        [s.id]: { ...(p[s.id] ?? {}), entry: e.target.value },
                      }))
                    }
                  />
                </td>
                <td>
                  <button
                    className={`btn small ${edits[s.id] ? 'primary' : 'ghost'}`}
                    title={
                      s.entry_amount != null
                        ? 'Replace the actual for this month'
                        : 'Save the actual amount you typed'
                    }
                    onClick={() => save(s)}
                    disabled={!edits[s.id]}
                  >
                    {s.entry_amount != null ? 'Update' : 'Enter actual'}
                  </button>
                  {s.entry_amount != null && (
                    <button
                      className="btn ghost small"
                      title="Remove the actual for this month — the projection will fall back to the usual amount"
                      onClick={async () => {
                        const ok = await confirm({
                          title: 'Clear this month’s actual?',
                          message: `"${s.name}" will fall back to its usual amount for the projection.`,
                          danger: true,
                          confirmLabel: 'Clear',
                        });
                        if (!ok) return;
                        await api.put(`/income/${month}/${s.id}`, { amount: null });
                        load();
                      }}
                    >
                      Clear
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
