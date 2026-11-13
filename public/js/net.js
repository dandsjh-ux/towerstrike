// WebSocket client with auto-reconnect + session resume.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.session = null;
    try { this.session = JSON.parse(localStorage.getItem('ts_session') || 'null'); } catch { this.session = null; }
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
      ws.onclose = () => {
        this.emit('close', {});
        if (!this.wanted) return;
        const delay = Math.min(5000, 400 * 2 ** this.retry++);
        setTimeout(() => this.connect().then(() => { if (this.session) this.send({ t: 'resume', code: this.session.code, token: this.session.token }); }), delay);
      };
      ws.onerror = () => {};
    });
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  saveSession(s) { this.session = s; localStorage.setItem('ts_session', JSON.stringify(s)); }
  clearSession() { this.session = null; localStorage.removeItem('ts_session'); }
  ping() { this.send({ t: 'ping', ts: performance.now() }); }
}
