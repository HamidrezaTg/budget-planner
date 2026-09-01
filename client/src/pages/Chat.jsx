import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Chat() {
  const [tab, setTab] = useState('finance');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState([]);
  const [aiReady, setAiReady] = useState(null);
  const composerRef = React.useRef(null);
  const messagesRef = React.useRef(null);
  // Switching tabs clears the conversation; an in-flight response from the
  // previous tab must not repopulate the new one.
  const tabRef = React.useRef(tab);

  useEffect(() => {
    api
      .get('/settings')
      .then((s) => setAiReady(!!s.base_url))
      .catch(() => setAiReady(false));
  }, [tab]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

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
        if (tabRef.current === forTab)
          setMessages([...next, { role: 'assistant', content: r.reply }]);
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
            r.results
              .map(
                (x) =>
                  `${x.ok ? '[ok]' : '[failed]'} ${x.summary || x.type}${x.error ? ` — ${x.error}` : ''}`,
              )
              .join('\n'),
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

  const prompts =
    tab === 'finance'
      ? [
          'How much did I spend this month?',
          'Which categories are over budget?',
          'Show my biggest expenses',
        ]
      : [
          'Raise the Groceries budget to 650',
          'List my active commitments',
          'Add a monthly income source',
        ];

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
      <div className="chat-hero">
        <div className="chat-identity">
          <div className="chat-avatar" aria-hidden="true">
            ✦
          </div>
          <div>
            <p className="eyebrow">Your private assistant</p>
            <h1>{tab === 'finance' ? 'Ask your finances' : 'Build with the assistant'}</h1>
            <p className="muted">
              {tab === 'finance'
                ? 'Read-only answers from your budget data.'
                : 'Changes are proposed first and never applied automatically.'}
            </p>
          </div>
        </div>
        <div className="chat-mode-tabs" role="tablist" aria-label="Assistant mode">
          <button
            className={`chat-mode ${tab === 'finance' ? 'active' : ''}`}
            onClick={() => switchTab('finance')}
            role="tab"
            aria-selected={tab === 'finance'}
          >
            Finance
          </button>
          <button
            className={`chat-mode ${tab === 'dev' ? 'active' : ''}`}
            onClick={() => switchTab('dev')}
            role="tab"
            aria-selected={tab === 'dev'}
          >
            Dev mode
          </button>
        </div>
      </div>

      {tab === 'dev' && (
        <p className="muted">
          The assistant can only <b>propose</b> whitelisted changes (budgets, rules, categories,
          commitments, funds, income, balances). Nothing is applied until you press Apply — no raw
          SQL, no deletions, everything logged.
        </p>
      )}

      <div className="chat-shell">
        <div className="chat-box" ref={messagesRef}>
          {messages.length === 0 && (
            <div className="chat-welcome">
              <div className="chat-welcome-mark" aria-hidden="true">
                ✦
              </div>
              <h2>
                {tab === 'finance' ? 'What would you like to know?' : 'What should we change?'}
              </h2>
              <p className="muted">
                {tab === 'finance'
                  ? 'Ask a plain-language question. The assistant only reads your private budget data.'
                  : 'Describe an adjustment and review the proposed changes before applying them.'}
              </p>
              <div className="chat-prompts">
                {prompts.map((prompt) => (
                  <button
                    key={prompt}
                    className="chat-prompt"
                    onClick={() => {
                      setInput(prompt);
                      composerRef.current?.focus();
                    }}
                  >
                    {prompt}
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
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
      </div>

      {tab === 'dev' && proposals.length > 0 && (
        <div className="card proposal-box">
          <h3>Proposed changes ({proposals.length})</h3>
          {proposals.map((p, i) => (
            <div key={i} className={`proposal ${p.error ? 'bad' : ''}`}>
              <span>{p.error ? p.summary : `→ ${p.summary}`}</span>
              <button className="btn danger small" onClick={() => dismiss(i)}>
                Dismiss
              </button>
            </div>
          ))}
          <button className="btn primary" onClick={applyAll} disabled={busy}>
            Apply {proposals.filter((p) => !p.error).length} proposal(s)
          </button>
        </div>
      )}

      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={composerRef}
          rows="1"
          placeholder={
            tab === 'finance' ? 'Message your budget assistant…' : 'Describe a proposed change…'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={busy}
          aria-label="Message"
        />
        <div className="chat-composer-footer">
          <span className="muted tiny">Enter to send · Shift + Enter for a new line</span>
          <button
            className="chat-send"
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Send message"
          >
            {busy ? '…' : '↑'}
          </button>
        </div>
      </form>
    </div>
  );
}
