import { useEffect, useState } from 'react';
import { api, eur } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Commitments() {
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ accounts: [], groups: [] });
  const [form, setForm] = useState({
    name: '',
    monthly_amount: '',
    start_month: '',
    end_month: '',
  });
  const [edits, setEdits] = useState({});
  const { confirm, toast } = useDialogs();

  const load = () =>
    api
      .get('/commitments')
      .then(setRows)
      .catch((e) => toast(e.message, 'error'));
  useEffect(() => {
    load();
    api
      .get('/categories/meta/all')
      .then(setMeta)
      .catch(() => {});
  }, []);

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post('/commitments', { ...form, end_month: form.end_month || null });
      setForm({ name: '', monthly_amount: '', start_month: '', end_month: '' });
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
        monthly_amount: e.amount !== undefined ? Number(e.amount) : undefined,
        end_month: e.end_month !== undefined ? e.end_month || null : undefined,
      });
      setEdits((p) => ({ ...p, [row.id]: undefined }));
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const activeNow = (r) => {
    const now = new Date();
    const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return m >= r.start_month && (!r.end_month || m <= r.end_month) && r.monthly_amount > 0;
  };

  return (
    <div>
      <h1>Commitments</h1>
      <p className="muted">
        Fixed dated commitments — loans, instalments, plans. Each has a start and end month; the
        projection automatically drops them out when they finish.
      </p>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Account</th>
              <th className="num">Monthly</th>
              <th>Start</th>
              <th>End</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={activeNow(r) ? '' : 'done-row'}>
                <td>
                  {r.name}
                  {r.category_name && <span className="muted tiny"> → {r.category_name}</span>}
                </td>
                <td className="muted">{r.account_name ?? '—'}</td>
                <td className="num">{eur(r.monthly_amount)}</td>
                <td>{r.start_month}</td>
                <td>
                  <input
                    type="month"
                    title="Month this commitment ends — leave empty for an open-ended commitment"
                    defaultValue={r.end_month ?? ''}
                    key={r.id + String(r.end_month)}
                    style={{ width: 150 }}
                    onChange={(e) =>
                      setEdits((p) => ({
                        ...p,
                        [r.id]: { ...(p[r.id] ?? {}), end_month: e.target.value },
                      }))
                    }
                  />
                </td>
                <td>
                  <button
                    className={`btn small ${edits[r.id]?.end_month !== undefined ? 'primary' : 'ghost'}`}
                    title="Save the new end month"
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
        <form onSubmit={add} className="inline-form commit-form">
          <input
            title="Commitment name (e.g. Car loan)"
            placeholder="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            title="Monthly amount — positive number"
            placeholder="€/month"
            type="number"
            step="0.01"
            min="0"
            style={{ width: 110 }}
            value={form.monthly_amount}
            onChange={(e) => setForm({ ...form, monthly_amount: e.target.value })}
          />
          <input
            title="Start month (YYYY-MM)"
            type="month"
            value={form.start_month}
            onChange={(e) => setForm({ ...form, start_month: e.target.value })}
          />
          <input
            title="Optional end month (YYYY-MM) — leave empty for an open-ended commitment"
            type="month"
            value={form.end_month}
            onChange={(e) => setForm({ ...form, end_month: e.target.value })}
          />
          <select
            title="Account this commitment is paid from"
            value={form.account_id ?? ''}
            onChange={(e) => setForm({ ...form, account_id: e.target.value || null })}
          >
            <option value="">Account…</option>
            {meta.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button className="btn primary" title="Add this commitment">
            Add commitment
          </button>
        </form>
      </div>
    </div>
  );
}
