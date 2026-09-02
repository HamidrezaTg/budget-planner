import { useEffect, useState } from 'react';
import { api, eur, monthLabel } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';
import { useWorkingMonth } from '../components/WorkingMonth.jsx';

export default function Commitments() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ accounts: [], groups: [] });
  const [form, setForm] = useState({
    name: '',
    monthly_amount: '',
    start_month: '',
    end_month: '',
    account_id: '',
    note: '',
  });
  const [edits, setEdits] = useState({});
  const { confirm, toast } = useDialogs();
  const { month } = useWorkingMonth();

  const load = () =>
    api
      .get(`/commitments?month=${month}`)
      .then(setRows)
      .catch((e) => toast(e.message, 'error'));
  useEffect(() => {
    load();
    api
      .get('/categories/meta/all')
      .then(setMeta)
      .catch(() => {});
  }, [month]);

  const startEdit = (row) => ({
    name: row.name,
    amount: String(row.monthly_amount),
    start_month: row.start_month,
    end_month: row.end_month ?? '',
    account_id: row.account_id ?? '',
    note: row.note ?? '',
  });

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post('/commitments', {
        ...form,
        account_id: form.account_id || null,
        end_month: form.end_month || null,
        note: form.note || null,
      });
      setForm({
        name: '',
        monthly_amount: '',
        start_month: '',
        end_month: '',
        account_id: '',
        note: '',
      });
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const save = async (row) => {
    const e = edits[row.id];
    if (!e) return;
    try {
      await api.patch(`/commitments/${row.id}`, {
        name: e.name.trim(),
        monthly_amount: e.amount !== undefined ? Number(e.amount) : undefined,
        start_month: e.start_month,
        end_month: e.end_month !== undefined ? e.end_month || null : undefined,
        account_id: e.account_id || null,
        note: e.note || null,
      });
      setEdits((p) => ({ ...p, [row.id]: undefined }));
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const activeAt = (r, m) => {
    return m >= r.start_month && (!r.end_month || m <= r.end_month) && r.monthly_amount > 0;
  };
  const activeTotal = rows
    .filter((row) => activeAt(row, month))
    .reduce((sum, row) => sum + row.monthly_amount, 0);

  return (
    <div>
      <h1>Commitments</h1>
      <p className="muted">
        Fixed dated commitments — loans, instalments, plans. Each has a start and end month; the
        projection automatically drops them out when they finish. Payment status below is for{' '}
        {monthLabel(month)}.
      </p>

      <div className="stats-row commitment-month-summary">
        <div className="card stat">
          <div className="stat-label">Active commitments in {monthLabel(month)}</div>
          <div className="stat-value expense">{eur(activeTotal)}</div>
          <div className="muted tiny">planned monthly cash outflow</div>
        </div>
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Account</th>
              <th className="num">Monthly</th>
              <th className="num">Paid</th>
              <th>Start</th>
              <th>End</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={activeAt(r, month) ? '' : 'done-row'}>
                <td>
                  {edits[r.id] ? (
                    <div className="commit-edit-stack">
                      <input
                        aria-label={`Name for ${r.name}`}
                        value={edits[r.id].name}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [r.id]: { ...p[r.id], name: e.target.value } }))
                        }
                      />
                      <input
                        aria-label={`Note for ${r.name}`}
                        placeholder="Note (optional)"
                        value={edits[r.id].note}
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [r.id]: { ...p[r.id], note: e.target.value } }))
                        }
                      />
                    </div>
                  ) : (
                    r.name
                  )}
                  {r.category_name && <span className="muted tiny"> → {r.category_name}</span>}
                  {!edits[r.id] && r.note && <span className="muted tiny"> · {r.note}</span>}
                </td>
                <td className="muted">
                  {edits[r.id] ? (
                    <select
                      aria-label={`Account for ${r.name}`}
                      value={edits[r.id].account_id}
                      onChange={(e) =>
                        setEdits((p) => ({
                          ...p,
                          [r.id]: { ...p[r.id], account_id: e.target.value },
                        }))
                      }
                    >
                      <option value="">No account</option>
                      {meta.accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    (r.account_name ?? '—')
                  )}
                </td>
                <td className="num">
                  {edits[r.id] ? (
                    <input
                      className="budget-input"
                      type="number"
                      min="0"
                      step="0.01"
                      aria-label={`Monthly amount for ${r.name}`}
                      value={edits[r.id].amount}
                      onChange={(e) =>
                        setEdits((p) => ({ ...p, [r.id]: { ...p[r.id], amount: e.target.value } }))
                      }
                    />
                  ) : (
                    eur(r.monthly_amount)
                  )}
                </td>
                <td className={`num ${r.payment_status === 'paid' ? 'good' : ''}`}>
                  {eur(r.paid_amount)}
                  <span className="muted tiny"> · {r.payment_status}</span>
                </td>
                <td>
                  {edits[r.id] ? (
                    <input
                      type="month"
                      aria-label={`Start month for ${r.name}`}
                      value={edits[r.id].start_month}
                      onChange={(e) =>
                        setEdits((p) => ({
                          ...p,
                          [r.id]: { ...p[r.id], start_month: e.target.value },
                        }))
                      }
                    />
                  ) : (
                    r.start_month
                  )}
                </td>
                <td>
                  <input
                    type="month"
                    title="Month this commitment ends — leave empty for an open-ended commitment"
                    value={edits[r.id]?.end_month ?? r.end_month ?? ''}
                    key={r.id + String(r.end_month)}
                    style={{ width: 150 }}
                    onChange={(e) =>
                      setEdits((p) => ({
                        ...p,
                        [r.id]: { ...(p[r.id] ?? startEdit(r)), end_month: e.target.value },
                      }))
                    }
                  />
                </td>
                <td>
                  {edits[r.id] ? (
                    <button
                      className="btn ghost small"
                      title="Cancel editing"
                      onClick={() => setEdits((p) => ({ ...p, [r.id]: undefined }))}
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      className="btn ghost small"
                      title={`Edit the "${r.name}" commitment`}
                      onClick={() => setEdits((p) => ({ ...p, [r.id]: startEdit(r) }))}
                    >
                      Edit
                    </button>
                  )}
                  <button
                    className={`btn small ${edits[r.id] ? 'primary' : 'ghost'}`}
                    title="Save commitment changes"
                    onClick={() => save(r)}
                    disabled={!edits[r.id]}
                  >
                    ✓
                  </button>
                  <button
                    className="btn danger small"
                    title={`Delete the "${r.name}" commitment`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete "${r.name}"?`,
                        message: 'The projection will stop charging it immediately.',
                        danger: true,
                        confirmLabel: 'Delete',
                      });
                      if (ok) {
                        try {
                          await api.del(`/commitments/${r.id}`);
                          load();
                        } catch (err) {
                          toast(err.message, 'error');
                        }
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={add} className="commit-form">
          <p className="eyebrow">Add commitment</p>
          <div className="commit-form-grid">
            <label>
              Name
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Monthly amount
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.monthly_amount}
                onChange={(e) => setForm({ ...form, monthly_amount: e.target.value })}
              />
            </label>
            <label>
              Start month
              <input
                required
                type="month"
                value={form.start_month}
                onChange={(e) => setForm({ ...form, start_month: e.target.value })}
              />
            </label>
            <label>
              End month
              <input
                type="month"
                value={form.end_month}
                onChange={(e) => setForm({ ...form, end_month: e.target.value })}
              />
            </label>
            <label>
              Account
              <select
                value={form.account_id}
                onChange={(e) => setForm({ ...form, account_id: e.target.value })}
              >
                <option value="">No account</option>
                {meta.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Note
              <input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
          </div>
          <button className="btn primary" title="Add this commitment">
            Add commitment
          </button>
        </form>
      </div>
    </div>
  );
}
