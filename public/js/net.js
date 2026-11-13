// WebSocket client with auto-reconnect + session resume.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.session = null;
    // Per-tab session: a refresh resumes the seat, while two tabs are two independent players.
    try { this.session = JSON.parse(sessionStorage.getItem('ts_session') || 'null'); } catch { this.session = null; }
    try { localStorage.removeItem('ts_session'); } catch { /* old builds stored it here */ }
    this.retry = 0;
    this.wanted = false;
    this.rtt = 0;
  }
  on(t, fn) { if (!this.handlers.has(t)) this.handlers.set(t, []); this.handlers.get(t).push(fn); }
  emit(t, m) { for (const fn of this.handlers.get(t) || []) fn(m); for (const fn of this.handlers.get('*') || []) fn(m); }
  url() { return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`; }
  connect() {
    this.wanted = true;
    return new Promise((resolve) => {
      const ws = new WebSocket(this.url());
      this.ws = ws;
      ws.onopen = () => { this.retry = 0; this.emit('open', {}); resolve(); };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.t === 'pong') this.rtt = performance.now() - m.ts; this.emit(m.t, m); };
      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        // 4000: this seat was taken over by another tab/device. Don't fight over it.
        if (ev.code === 4000) { this.wanted = false; this.emit('replaced', {}); return; }
        this.emit('close', {});
        if (!this.wanted) return;
        const delay = Math.min(5000, 400 * 2 ** this.retry++);
        setTimeout(() => { if (this.wanted) this.connect(); }, delay); // the 'open' handler resumes the session
      };
      ws.onerror = () => {};
    });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  saveSession(s) { this.session = s; sessionStorage.setItem('ts_session', JSON.stringify(s)); }
  clearSession() { this.session = null; sessionStorage.removeItem('ts_session'); }
  ping() { this.send({ t: 'ping', ts: performance.now() }); }
}
