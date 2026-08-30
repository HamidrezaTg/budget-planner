// Pause/resume for API requests. A backup restore swaps the user's database
// file on disk; in-flight requests still holding the old handle would either
// write to the detached inode (silently lost) or crash on the closed handle.
// pauseRequests() drains the API first — all handlers here are short pieces of
// synchronous SQLite work — and resumeRequests() releases the queued ones.

let paused = false;
let inFlight = 0;
let waiter = null;
const queued = [];

export function gate(req, res, next) {
  // The restore request itself must pass while everything else waits.
  if (req.method === 'POST' && req.path === '/settings/restore') return next();
  const enter = () => {
    inFlight++;
    // 'close' fires exactly once per response (also on client aborts).
    res.on('close', () => {
      inFlight--;
      if (paused && inFlight === 0 && waiter) {
        const w = waiter;
        waiter = null;
        w();
      }
    });
    next();
  };
  if (paused) queued.push(enter);
  else enter();
}

// Waits until no API request is in flight. On timeout it un-pauses (queued
// requests proceed) and rejects, so a hung AI call cannot wedge restores
// forever — the caller just reports the failure.
export function pauseRequests(timeoutMs = 30000) {
  paused = true;
  if (inFlight === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiter = null;
      paused = false;
      const q = queued.splice(0);
      for (const fn of q) fn();
      const err = new Error('Server is busy — please try the restore again in a moment');
      err.status = 409;
      reject(err);
    }, timeoutMs);
    waiter = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

export function resumeRequests() {
  paused = false;
  const q = queued.splice(0);
  for (const fn of q) fn();
}
