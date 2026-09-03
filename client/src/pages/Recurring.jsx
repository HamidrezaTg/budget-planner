import { useEffect, useState } from 'react';
import { api, eur } from '../api.js';
import { useDialogs } from '../components/Dialog.jsx';

export default function Recurring() {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState({ accounts: [], groups: [] });
  const [cats, setCats] = useState([]);
  const [template, setTemplate] = useState(false);
  const [parts, setParts] = useState([
    { category_id: '', amount: '' },
    { category_id: '', amount: '' },
  ]);
  const [form, setForm] = useState({
    name: '',
    amount: '',
    day_of_month: '1',
    account_id: '',
    category_id: '',
    auto_post: false,
    start_month: '',
    end_month: '',
    skip_months: [],
  });
  const [skipDraft, setSkipDraft] = useState('');
  // Inline schedule editor: { [id]: { start_month, end_month, skip_months, skipDraft } }
  const [scheduleEdits, setScheduleEdits] = useState({});
  const { toast, confirm } = useDialogs();

  const load = () =>
    api
      .post('/recurrences/auto-post')
      .then(() => api.get('/recurrences'))
      .then(setData)
      .catch((e) => toast(e.message, 'error'));
  useEffect(() => {
    load();
    api
      .get('/categories/meta/all')
      .then(setMeta)
      .catch(() => {});
    api
      .get('/categories')
      .then(setCats)
      .catch(() => {});
  }, []);
  if (!data) return <div className="loading">Loading…</div>;

  const add = async (e) => {
    e.preventDefault();
    try {
      await api.post('/recurrences', {
        ...form,
        amount: Number(form.amount),
        day_of_month: Number(form.day_of_month),
        account_id: form.account_id || null,
        category_id: template ? null : form.category_id || null,
        start_month: form.start_month || null,
        end_month: form.end_month || null,
        skip_months: form.skip_months,
        ...(template ? { parts } : {}),
      });
      setForm({
        name: '',
        amount: '',
        day_of_month: '1',
        account_id: '',
        category_id: '',
        auto_post: false,
        start_month: '',
        end_month: '',
        skip_months: [],
      });
      setTemplate(false);
      setParts([
        { category_id: '', amount: '' },
        { category_id: '', amount: '' },
      ]);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const toggle = async (r, field) => {
    await api.patch(`/recurrences/${r.id}`, { [field]: !r[field] });
    load();
  };

  const startScheduleEdit = (r) =>
    setScheduleEdits((p) => ({
      ...p,
      [r.id]: {
        start_month: r.start_month ?? '',
        end_month: r.end_month ?? '',
        skip_months: [...(r.skip_months ?? [])],
        skipDraft: '',
      },
    }));
  const cancelScheduleEdit = (id) =>
    setScheduleEdits((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
  const saveScheduleEdit = async (r) => {
    const edit = scheduleEdits[r.id];
    if (!edit) return;
    try {
      await api.patch(`/recurrences/${r.id}`, {
        start_month: edit.start_month || null,
        end_month: edit.end_month || null,
        skip_months: edit.skip_months,
      });
      toast(`Schedule for "${r.name}" saved.`);
      cancelScheduleEdit(r.id);
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const scheduleLabel = (r) => {
    if (r.start_month && r.end_month) return `${r.start_month} → ${r.end_month}`;
    if (r.start_month) return `from ${r.start_month}`;
    if (r.end_month) return `until ${r.end_month}`;
    return 'every month';
  };

  const statusBadge = (r) => {
    if (r.status === 'posted')
      return (
        <span className="pill-badge" style={{ background: 'var(--teal, var(--blue))' }}>
          posted {r.status_month}
        </span>
      );
    if (r.status === 'due')
      return <span className="pill-badge accent-badge">due {r.status_month}</span>;
    if (r.status === 'paused') return <span className="pill-badge">paused</span>;
    return <span className="pill-badge">not scheduled</span>;
  };

  const post = async (u) => {
    await api.post(`/recurrences/${u.recurrence_id}/post`, { month: u.month });
    load();
  };

  const remove = async (r) => {
    const ok = await confirm({
      title: 'Delete this recurring item?',
      message: `"${r.name}" will be removed from the schedule. Already-posted transactions are kept.`,
      danger: true,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    try {
      await api.del(`/recurrences/${r.id}`);
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const expected = data.upcoming.reduce((s, u) => s + u.amount, 0);
  const activeCats = cats.filter((c) => c.is_active);

  return (
    <div>
      <h1>Scheduled Transactions</h1>
      <p className="muted">
        Reusable monthly templates — rent, subscriptions, salary. Each month they can post the real
        transaction automatically on their day or wait for your confirmation, and imported bank rows
        matching a scheduled item are folded in instead of double-counted. This is what keeps
        repeating money in your books without re-typing it; the projection, by contrast, uses your
        income sources and plans.
      </p>

      <div className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Upcoming</p>
            <h2>Next occurrences</h2>
          </div>
          <span className="count-pill">
            {data.upcoming.length} items · {eur(expected)}
          </span>
        </div>
        {data.upcoming.length === 0 && <div className="muted">Nothing upcoming.</div>}
        {data.upcoming.map((u, i) => (
          <div key={i} className="bill-row">
            <div className="bill-date">
              <strong>{String(u.day).padStart(2, '0')}</strong>
              <span>{u.month}</span>
            </div>
            <div className="transaction-main">
              <strong>{u.name}</strong>
              <small>{u.auto_post ? 'auto-posts' : 'manual'}</small>
            </div>
            <button
              className="btn small"
              title={`Create the "${u.name}" transaction now for ${u.month}`}
              onClick={() => post(u)}
            >
              Post now
            </button>
            <b className={u.amount >= 0 ? 'income' : ''}>{eur(u.amount)}</b>
          </div>
        ))}
      </div>

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Day</th>
              <th className="num">Amount</th>
              <th>Account</th>
              <th>Category</th>
              <th>Schedule</th>
              <th>Status</th>
              <th>Auto</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.recurrences.map((r) => {
              const edit = scheduleEdits[r.id];
              return (
                <tr key={r.id} className={r.active ? '' : 'done-row'}>
                  <td>{r.name}</td>
                  <td>{r.day_of_month}</td>
                  <td className={`num ${r.amount >= 0 ? 'income' : ''}`}>{eur(r.amount)}</td>
                  <td className="muted">{r.account_name ?? '—'}</td>
                  <td className="muted">
                    {r.parts?.length
                      ? r.parts.map((p) => `${p.category_name} ${eur(p.amount)}`).join(' · ')
                      : (r.category_name ?? '—')}
                  </td>
                  <td>
                    {edit ? (
                      <div className="schedule-editor">
                        <label className="muted tiny">
                          start
                          <input
                            type="month"
                            aria-label={`${r.name} start month`}
                            value={edit.start_month}
                            onChange={(e) =>
                              setScheduleEdits((p) => ({
                                ...p,
                                [r.id]: { ...edit, start_month: e.target.value },
                              }))
                            }
                          />
                        </label>
                        <label className="muted tiny">
                          end
                          <input
                            type="month"
                            aria-label={`${r.name} end month`}
                            title="Leave empty for ongoing"
                            value={edit.end_month}
                            onChange={(e) =>
                              setScheduleEdits((p) => ({
                                ...p,
                                [r.id]: { ...edit, end_month: e.target.value },
                              }))
                            }
                          />
                        </label>
                        <div className="schedule-skips">
                          {edit.skip_months.map((m) => (
                            <button
                              key={m}
                              type="button"
                              className="btn ghost small"
                              title="Stop skipping this month"
                              onClick={() =>
                                setScheduleEdits((p) => ({
                                  ...p,
                                  [r.id]: {
                                    ...edit,
                                    skip_months: edit.skip_months.filter((x) => x !== m),
                                  },
                                }))
                              }
                            >
                              ↷ {m} ✕
                            </button>
                          ))}
                          <input
                            type="month"
                            aria-label={`${r.name} month to skip`}
                            title="Add a month this item should NOT post (e.g. vacation pause)"
                            value={edit.skipDraft}
                            onChange={(e) =>
                              setScheduleEdits((p) => ({
                                ...p,
                                [r.id]: { ...edit, skipDraft: e.target.value },
                              }))
                            }
                          />
                          {edit.skipDraft && (
                            <button
                              type="button"
                              className="btn small"
                              onClick={() =>
                                setScheduleEdits((p) => ({
                                  ...p,
                                  [r.id]: {
                                    ...edit,
                                    skip_months: [
                                      ...new Set([...edit.skip_months, edit.skipDraft]),
                                    ],
                                    skipDraft: '',
                                  },
                                }))
                              }
                            >
                              + skip
                            </button>
                          )}
                        </div>
                        <div>
                          <button className="btn small primary" onClick={() => saveScheduleEdit(r)}>
                            Save
                          </button>
                          <button
                            className="btn ghost small"
                            onClick={() => cancelScheduleEdit(r.id)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <span className="muted">{scheduleLabel(r)}</span>
                        {(r.skip_months ?? []).length > 0 && (
                          <div className="muted tiny">skipping {r.skip_months.join(', ')}</div>
                        )}
                        <button
                          className="btn ghost tiny-btn"
                          title="Edit the schedule (start, end, skip months)"
                          onClick={() => startScheduleEdit(r)}
                        >
                          ✎
                        </button>
                      </>
                    )}
                  </td>
                  <td>{statusBadge(r)}</td>
                  <td>
                    <button
                      className={`btn ghost small ${r.auto_post ? 'active' : ''}`}
                      title={
                        r.auto_post
                          ? 'Currently auto-posts on its day. Click to require manual confirmation.'
                          : 'Currently manual. Click to auto-post on its day.'
                      }
                      onClick={() => toggle(r, 'auto_post')}
                    >
                      {r.auto_post ? 'auto' : 'manual'}
                    </button>
                  </td>
                  <td>
                    <button
                      className="btn ghost small"
                      title={
                        r.active
                          ? 'Pause — the recurrence stops appearing until you resume'
                          : 'Resume — the recurrence will appear again'
                      }
                      onClick={() => toggle(r, 'active')}
                    >
                      {r.active ? 'pause' : 'resume'}
                    </button>
                  </td>
                  <td>
                    <button
                      className="btn danger small"
                      title={`Delete the "${r.name}" recurrence`}
                      onClick={() => remove(r)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {data.recurrences.length === 0 && (
              <tr>
                <td colSpan="10" className="muted">
                  No scheduled transactions yet — add your first below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} className="card inline-form">
        <input
          title="Name (e.g. Rent)"
          placeholder="Name (e.g. Rent)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          title="Amount — negative for spend, positive for income"
          placeholder="€ (− expense, + income)"
          type="number"
          step="0.01"
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
        />
        <label title="Day of the month the transaction is due (1–28)">
          Day
          <input
            type="number"
            min="1"
            max="28"
            value={form.day_of_month}
            onChange={(e) => setForm({ ...form, day_of_month: e.target.value })}
          />
        </label>
        <input
          aria-label="Scheduled transaction start month"
          type="month"
          title="First month this item is scheduled; leave empty to start from any month"
          value={form.start_month}
          onChange={(e) => setForm({ ...form, start_month: e.target.value })}
        />
        <input
          aria-label="Scheduled transaction end month"
          type="month"
          title="Last month this item is scheduled; leave empty for ongoing"
          value={form.end_month}
          onChange={(e) => setForm({ ...form, end_month: e.target.value })}
        />
        <div className="schedule-skips">
          {form.skip_months.map((m) => (
            <button
              key={m}
              type="button"
              className="btn ghost small"
              title="Stop skipping this month"
              onClick={() =>
                setForm({ ...form, skip_months: form.skip_months.filter((x) => x !== m) })
              }
            >
              ↷ {m} ✕
            </button>
          ))}
          <input
            type="month"
            aria-label="Month to skip"
            title="Months this item should NOT post (e.g. a vacation pause)"
            value={skipDraft}
            onChange={(e) => setSkipDraft(e.target.value)}
          />
          {skipDraft && (
            <button
              type="button"
              className="btn small"
              onClick={() => {
                setForm((p) => ({
                  ...p,
                  skip_months: [...new Set([...p.skip_months, skipDraft])],
                }));
                setSkipDraft('');
              }}
            >
              + skip
            </button>
          )}
        </div>
        <select
          title="Account this transaction will be booked against"
          value={form.account_id}
          onChange={(e) => setForm({ ...form, account_id: e.target.value })}
        >
          <option value="">Account…</option>
          {meta.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <label
          className="muted"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            textTransform: 'none',
            letterSpacing: 0,
          }}
        >
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={template}
            onChange={(e) => setTemplate(e.target.checked)}
          />{' '}
          split template
        </label>
        {!template && (
          <select
            title="Category to use when the transaction is posted"
            value={form.category_id}
            onChange={(e) => setForm({ ...form, category_id: e.target.value })}
          >
            <option value="">Category…</option>
            {activeCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        {template && (
          <div className="recurrence-parts">
            {parts.map((part, i) => (
              <div className="recurrence-part" key={i}>
                <select
                  title={`Category for template part ${i + 1}`}
                  value={part.category_id}
                  onChange={(e) => {
                    const next = [...parts];
                    next[i] = { ...part, category_id: e.target.value };
                    setParts(next);
                  }}
                >
                  <option value="">Part category…</option>
                  {activeCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  title={`Amount for template part ${i + 1}`}
                  placeholder="Part amount"
                  type="number"
                  step="0.01"
                  value={part.amount}
                  onChange={(e) => {
                    const next = [...parts];
                    next[i] = { ...part, amount: e.target.value };
                    setParts(next);
                  }}
                />
                {parts.length > 2 && (
                  <button
                    type="button"
                    className="btn danger small"
                    title="Remove this template part"
                    onClick={() => setParts(parts.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn ghost small"
              onClick={() => setParts([...parts, { category_id: '', amount: '' }])}
            >
              Add part
            </button>
          </div>
        )}
        <label
          className="muted"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            textTransform: 'none',
            letterSpacing: 0,
          }}
        >
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            title="Auto-post creates the real transaction on its day without confirmation"
            checked={form.auto_post}
            onChange={(e) => setForm({ ...form, auto_post: e.target.checked })}
          />{' '}
          auto-post
        </label>
        <button className="btn primary" title="Add this recurring transaction">
          Add
        </button>
      </form>
    </div>
  );
}
