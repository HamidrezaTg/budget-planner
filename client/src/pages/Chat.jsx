import React, { useEffect, useState } from 'react';
import { api, eur } from '../api.js';

export default function Chat() {
  const [tab, setTab] = useState('finance');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState([]);
  const [aiReady, setAiReady] = useState(null);
  // Switching tabs clears the conversation; an in-flight response from the
  // previous tab must not repopulate the new one.
  const tabRef = React.useRef(tab);

  useEffect(() => {
    api.get('/settings').then((s) => setAiReady(!!s.base_url)).catch(() => setAiReady(false));
  }, [tab]);

  const switchTab = (t) => {
    tabRef.current = t;
    setTab(t);
    setMessages([]);
    setProposals([]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const forTab = tabRef.current;
    setInput('');
    const next = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setBusy(true);
    try {
      if (forTab === 'finance') {
        const r = await api.post('/ai/chat', { messages: next });
        if (tabRef.current === forTab) setMessages([...next, { role: 'assistant', content: r.reply }]);
      } else {
        const r = await api.post('/ai/dev-chat', { messages: next });
        if (tabRef.current === forTab) {
          setMessages([...next, { role: 'assistant', content: r.reply }]);
          setProposals((p) => [...p, ...(r.proposals ?? [])]);
        }
      }
    } catch (e) {
      if (tabRef.current === forTab)
        setMessages([...next, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const applyAll = async () => {
    setBusy(true);
    try {
      const r = await api.post('/ai/dev-apply', { proposals });
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content:
            'Applied:\n' +
            r.results.map((x) => `${x.ok ? '[ok]' : '[failed]'} ${x.summary || x.type}${x.error ? ` — ${x.error}` : ''}`).join('\n'),
        },
      ]);
      setProposals([]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = (i) => setProposals((p) => p.filter((_, j) => j !== i));

  if (aiReady === false) {
    return (
      <div>
        <h1>Chat</h1>
        <div className="card warn-box">
          AI is not configured yet. Set your OpenAI-compatible endpoint in{' '}
          <a href="/settings">Settings</a> first.
        </div>
      </div>
    );
  }

  return (
    <div className="chat-page">
      <div className="page-head">
        <h1>{tab === 'finance' ? 'Ask your finances' : 'Dev mode (guarded)'}</h1>
        <div className="month-nav">
          <button className={`btn ghost ${tab === 'finance' ? 'active' : ''}`} onClick={() => switchTab('finance')}>
            Finance — read-only
          </button>
          <button className={`btn ghost ${tab === 'dev' ? 'active' : ''}`} onClick={() => switchTab('dev')}>
            Dev mode
          </button>
        </div>
      </div>

      {tab === 'dev' && (
        <p className="muted">
          The assistant can only <b>propose</b> whitelisted changes (budgets, rules, categories,
          commitments, funds, income, balances). Nothing is applied until you press Apply — no
          raw SQL, no deletions, everything logged.
        </p>
      )}

      <div className="card chat-box">
        {messages.length === 0 && (
          <div className="muted chat-empty">
            {tab === 'finance'
              ? 'Try: “How much did we spend on Groceries since July?” or “Which category is most over budget?”'
              : 'Try: “Raise the Groceries budget to 650” or “End the Barclays commitment in December 2027”'}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-who">{m.role === 'user' ? 'You' : 'AI'}</div>
            <div className="chat-text">{m.content}</div>
          </div>
        ))}
        {busy && <div className="muted chat-empty">Thinking…</div>}
      </div>

      {tab === 'dev' && proposals.length > 0 && (
        <div className="card proposal-box">
          <h3>Proposed changes ({proposals.length})</h3>
          {proposals.map((p, i) => (
            <div key={i} className={`proposal ${p.error ? 'bad' : ''}`}>
              <span>{p.error ? p.summary : `→ ${p.summary}`}</span>
              <button className="btn danger small" onClick={() => dismiss(i)}>Dismiss</button>
            </div>
          ))}
          <button className="btn primary" onClick={applyAll} disabled={busy}>
            Apply {proposals.filter((p) => !p.error).length} proposal(s)
          </button>
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <input
          placeholder="Ask something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
