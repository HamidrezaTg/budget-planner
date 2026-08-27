import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const DialogContext = createContext(null);

let idCounter = 0;

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);   // { kind, title, message, label, initial, danger, confirmLabel, placeholder, password }
  const [input, setInput] = useState('');
  const [toasts, setToasts] = useState([]);
  const resolver = useRef(null);
  const lastFocus = useRef(null);
  const panelRef = useRef(null);
  const inputId = useRef(`dlg-input-${++idCounter}`);
  const titleId = useRef(`dlg-title-${++idCounter}`);
  const bodyId = useRef(`dlg-body-${++idCounter}`);

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

  // Save the trigger element and move focus into the dialog when it opens.
  useEffect(() => {
    if (dialog) {
      lastFocus.current = document.activeElement;
      const focusable = panelRef.current?.querySelector(
        'input, select, textarea, button:not(:disabled)'
      );
      (focusable || panelRef.current)?.focus();
    }
  }, [dialog]);

  // Restore focus to the triggering control when the dialog closes.
  useEffect(() => {
    if (!dialog && lastFocus.current) {
      lastFocus.current.focus?.();
      lastFocus.current = null;
    }
  }, [dialog]);

  const trapFocus = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close(null);
      return;
    }
    if (e.key === 'Tab' && panelRef.current) {
      const focusables = panelRef.current.querySelectorAll(
        'input, select, textarea, button:not(:disabled)'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const value = useMemo(() => ({ confirm, prompt, toast }), [confirm, prompt, toast]);

  return (
    <DialogContext.Provider value={value}>
      {children}

      {dialog && (
        <div
          className="overlay"
          onMouseDown={(e) => {
            // Destructive confirmations must not be dismissed by an accidental
            // click outside the dialog.
            if (e.target === e.currentTarget && !dialog.danger) close(null);
          }}
        >
          <div
            ref={panelRef}
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId.current}
            aria-describedby={dialog.message ? bodyId.current : undefined}
            onKeyDown={trapFocus}
          >
            <h3 className="modal-title" id={titleId.current}>{dialog.title}</h3>
            {dialog.message && <p className="modal-message" id={bodyId.current}>{dialog.message}</p>}

            {dialog.kind === 'prompt' && (
              <>
                {dialog.label && <label className="modal-label" htmlFor={inputId.current}>{dialog.label}</label>}
                <input
                  id={inputId.current}
                  autoFocus
                  type={dialog.password ? 'password' : 'text'}
                  className="modal-input"
                  placeholder={dialog.placeholder}
                  aria-label={dialog.label || undefined}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') close(input);
                  }}
                />
              </>
            )}

            <div className="modal-actions">
              <button type="button" className="btn ghost" onClick={() => close(null)}>Cancel</button>
              <button
                type="button"
                className={`btn ${dialog.danger ? 'danger' : 'primary'}`}
                onClick={() => close(dialog.kind === 'prompt' ? input : true)}
              >
                {dialog.kind === 'prompt' ? 'OK' : dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} role="status">{t.message}</div>
        ))}
      </div>
    </DialogContext.Provider>
  );
}

export function useDialogs() {
  return useContext(DialogContext);
}
