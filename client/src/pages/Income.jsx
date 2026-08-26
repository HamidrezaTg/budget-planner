import React, { useEffect, useState } from 'react';
import { api, eur, currentMonth, monthLabel } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Income() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState(null);
  const [edits, setEdits] = useState({});
  const { prompt } = useDialogs();

  const load = () => api.get(`/income?month=${month}`).then((d) => { setData(d); setEdits({}); });
  useEffect(() => { load(); }, [month]);
  if (!data) return <div className="loading">Loading…</div>;

  const save = async (s) => {
    const e = edits[s.id];
    if (e === undefined) return;
    const entry = e.entry;
    await api.put(`/income/${month}/${s.id}`, {
      amount: entry !== undefined ? (entry === '' ? null : Number(entry)) : s.entry_amount,
      current_amount: e.current !== undefined ? Number(e.current) || 0 : undefined,
    });
    load();
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

      <div className="card stat big-income">
        <div className="stat-label">Total income this month</div>
        <div className="stat-value income">{eur(data.total)}</div>
      </div>

      <div className="card table-card" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr><th>Source</th><th>Person</th><th className="num">Usual</th><th className="num">Actual for {monthLabel(month)}</th><th></th></tr>
          </thead>
          <tbody>
            {data.sources.map((s) => (
              <tr key={s.id}>
                <td>{s.name}{!s.recurring && <span className="muted tiny"> one-off</span>}</td>
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
                      await api.put(`/income/${month}/${s.id}`, { current_amount: Number(v) || 0 });
                      load();
                    }}
                  >✎</button>
                </td>
                <td className="num">
                  <input
                    className="budget-input"
                    type="number" step="0.01"
                    placeholder={String(s.current_amount)}
                    defaultValue={s.entry_amount ?? ''}
                    key={`${month}-${s.id}-${String(s.entry_amount)}`}
                    onChange={(e) =>
                      setEdits((p) => ({ ...p, [s.id]: { ...(p[s.id] ?? {}), entry: e.target.value } }))
                    }
                  />
                </td>
                <td>
                  <button
                    className={`btn small ${edits[s.id] ? 'primary' : 'ghost'}`}
                    onClick={() => save(s)}
                    disabled={!edits[s.id]}
                  >
                    {s.entry_amount != null ? 'Update' : 'Enter actual'}
                  </button>
                  {s.entry_amount != null && (
                    <button
                      className="btn ghost small"
                      onClick={() => api.put(`/income/${month}/${s.id}`, { amount: null }).then(load)}
                    >Clear</button>
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
