import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const DialogContext = createContext(null);

let idCounter = 0;

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);   // { kind, title, message, label, initial, danger, resolve }
  const [input, setInput] = useState('');
  const [toasts, setToasts] = useState([]);
  const resolver = useRef(null);

  const close = (value) => {
    resolver.current?.(value);
    resolver.current = null;
    setDialog(null);
  };

  const confirm = useCallback((opts) => {
    const { title = 'Are you sure?', message = '', danger = false, confirmLabel = 'Confirm' } =
      typeof opts === 'string' ? { message: opts } : opts;
    return new Promise((resolve) => {
      resolver.current = resolve;
      setInput('');
      setDialog({ kind: 'confirm', title, message, danger, confirmLabel });
    });
  }, []);

  const prompt = useCallback((opts) => {
    const { title, label = '', initial = '', placeholder = '', password = false } =
      typeof opts === 'string' ? { title: opts } : opts;
    return new Promise((resolve) => {
      resolver.current = resolve;
      setInput(initial ?? '');
      setDialog({ kind: 'prompt', title, label, initial, placeholder, password });
    });
  }, []);

  const toast = useCallback((message, type = 'ok') => {
    const id = ++idCounter;
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const value = useMemo(() => ({ confirm, prompt, toast }), [confirm, prompt, toast]);

  return (
    <DialogContext.Provider value={value}>
      {children}

      {dialog && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close(null)}>
          <div className="modal-card" role="dialog" aria-modal="true">
            <h3 className="modal-title">{dialog.title}</h3>
            {dialog.message && <p className="modal-message">{dialog.message}</p>}

            {dialog.kind === 'prompt' && (
              <input
                autoFocus
                type={dialog.password ? 'password' : 'text'}
                className="modal-input"
                placeholder={dialog.placeholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') close(input);
                  if (e.key === 'Escape') close(null);
                }}
              />
            )}

            <div className="modal-actions">
              <button className="btn ghost" onClick={() => close(null)}>Cancel</button>
              <button
                className={`btn ${dialog.danger ? 'danger' : 'primary'}`}
                onClick={() => close(dialog.kind === 'prompt' ? input : true)}
              >
                {dialog.kind === 'prompt' ? 'OK' : dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>
        ))}
      </div>
    </DialogContext.Provider>
  );
}

export function useDialogs() {
  return useContext(DialogContext);
}
