import { useEffect, useState } from 'react';
import { api, eur, currentMonth, monthLabel } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Income() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const [error, setError] = useState('');
  const { prompt, confirm } = useDialogs();

  const load = () =>
    api
      .get(`/income?month=${month}`)
      .then((d) => {
        setData(d);
        setEdits({});
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [month]);
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
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>
      <p className="muted">
        Actual income must be entered, not assumed. The “usual” amount is used by the projection
        unless a month has its own entry.
      </p>

      {error && <div className="error">{error}</div>}

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
