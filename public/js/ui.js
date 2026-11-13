// DOM UI: title, lobby, chat, toasts, scoreboard, host panel, results, how-to.
import { SETTINGS_SCHEMA, BAN_LISTS, PRESETS, TOWERS, WEAPONS, EQUIPMENT, TROOPS, ABILITIES, MAX_PLAYERS, REWARD_SCALE, BASE_HP, BASE_HP_SCALE, RESPAWN_SCALE } from '/shared/defs.js';
import { MAPS, buildMap, mapBalance } from '/shared/maps.js';
import { parseQuestionCSV, validateQuestions, questionsToCSV } from '/shared/csv.js';
import { escapeHtml as esc } from '/shared/util.js';

export const $ = (id) => document.getElementById(id);
const ROLE_LABEL = { defender: 'Defender', striker: 'Striker', spectator: 'Spectator' };
const BAN_META = {
  bannedTowers: ['Towers', TOWERS], bannedWeapons: ['Weapons', WEAPONS], bannedEquipment: ['Equipment', EQUIPMENT], bannedTroops: ['Support troops', TROOPS], bannedAbilities: ['Defender abilities', ABILITIES],
};

export class UI {
  constructor(net, sfx) {
    this.net = net; this.sfx = sfx;
    this.room = null; this.myId = 0;
    this.chatOpen = false;
    this.bindStatic();
  }
  get isHost() { return this.room && this.room.hostId === this.myId; }
  me() { return this.room ? this.room.players.find((p) => p.id === this.myId) : null; }

  show(screen) {
    for (const s of ['title-screen', 'lobby-screen', 'results-screen']) $(s).classList.add('hidden');
    $('game-hud').classList.toggle('hidden', screen !== 'game');
    if (screen !== 'game') $(screen + '-screen').classList.remove('hidden');
    this.screen = screen;
  }
  toast(msg, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }
  modal(html) { $('modal-body').innerHTML = html; $('modal').classList.remove('hidden'); }
  closeModal() { $('modal').classList.add('hidden'); }

  bindStatic() {
    const nameIn = $('name-input');
    nameIn.value = localStorage.getItem('ts_name') || '';
    const params = new URLSearchParams(location.search);
    if (params.get('room')) $('code-input').value = params.get('room').toUpperCase();
    const name = () => { const n = nameIn.value.trim() || 'Player'; localStorage.setItem('ts_name', n); return n; };
    $('btn-create').onclick = () => { this.sfx.init(); this.net.send({ t: 'create', name: name() }); };
    $('btn-join').onclick = () => {
      this.sfx.init();
      const code = $('code-input').value.trim().toUpperCase();
      if (!code) { $('title-error').textContent = 'Enter a room code.'; return; }
      this.net.send({ t: 'join', code, name: name() });
    };
    $('code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('code-input').value ? $('btn-join') : $('btn-create')).click(); });
    $('btn-howto').onclick = $('btn-howto2').onclick = () => this.howTo();
    $('modal-close').onclick = () => this.closeModal();
    $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') this.closeModal(); });
    $('btn-leave').onclick = () => { if (confirm('Leave this room?')) { this.net.send({ t: 'leave' }); this.net.clearSession(); location.href = location.pathname; } };
    $('btn-copy-link').onclick = () => {
      const link = `${location.origin}${location.pathname}?room=${this.room.code}`;
      navigator.clipboard?.writeText(link).then(() => this.toast('Invite link copied!', 'good'), () => this.toast(link));
    };
    $('btn-add-bot-striker').onclick = () => this.net.send({ t: 'addBot', role: 'striker' });
    $('btn-add-bot-defender').onclick = () => this.net.send({ t: 'addBot', role: 'defender' });
    $('btn-start').onclick = () => this.net.send({ t: 'start' });
    $('csv-input').addEventListener('change', (e) => this.uploadCsv(e.target.files[0], this.csvTarget ?? 0));
    const lobbyChat = $('lobby-chat-input');
    lobbyChat.addEventListener('keydown', (e) => { if (e.key === 'Enter' && lobbyChat.value.trim()) { this.net.send({ t: 'chat', text: lobbyChat.value }); lobbyChat.value = ''; } });
  }

  // Pick a CSV for a bank. target: 0 main bank, N round N, 'now' current round, 'next' next round.
  pickCsv(target) { this.csvTarget = target; $('csv-input').value = ''; $('csv-input').click(); }
  uploadCsv(file, target = 0) {
    if (!file) return;
    if (file.size > 400000) { this.toast('File too large (max ~400 KB).', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const res = parseQuestionCSV(text);
      if (!res.questions.length) { this.renderQReport({ count: 0, errors: res.errors, errorCount: res.errorCount, truncated: false, total: res.total }); this.toast('No valid questions in that file.', 'error'); return; }
      this.net.send({ t: 'questions', csv: text, name: file.name.replace(/\.(csv|txt)$/i, ''), target });
    };
    reader.readAsText(file);
  }
  bankLabel(round) { return round ? `round ${round}` : 'the main bank'; }
  renderQReport(r) {
    let h = r.count ? `<div class="ok">✔ Loaded ${r.count} question${r.count === 1 ? '' : 's'} into ${this.bankLabel(r.round || 0)}.</div>` : '<div class="warn">No valid questions found.</div>';
    if (r.truncated) h += `<div class="warn">File had ${r.total} valid questions. Only the first 100 are used.</div>`;
    if (r.errors && r.errors.length) h += `<div class="warn">${r.errorCount} row(s) skipped:</div><ul>${r.errors.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`;
    $('q-report').innerHTML = h;
  }
  // Main bank + one row per round. Used in the lobby and (compact) in the in-game host panel.
  banksHtml(q, rounds, host, current = 0) {
    const byRound = new Map((q.rounds || []).map((r) => [r.round, r]));
    const main = `<div class="bank main"><div class="bank-name">📚 Main bank: <b>${q.count}</b> questions · ${esc(q.name)}<div class="muted small">${(q.categories || []).map(esc).join(' · ')}</div></div>
      ${host ? `<div class="bank-acts"><button class="btn tiny" data-up="0">Upload CSV</button><button class="btn tiny" data-edit="0">Edit</button>${q.source === 'custom' ? '<button class="btn tiny ghost" data-reset="0" title="Back to the built-in quiz">Built-in</button>' : ''}</div>` : ''}</div>`;
    let rows = '';
    for (let r = 1; r <= rounds; r++) {
      const b = byRound.get(r);
      rows += `<div class="bank ${r === current ? 'live' : ''}"><div class="bank-name"><span class="rd">R${r}${r === current ? ' ▶' : ''}</span> ${b ? `<b>${b.count}</b> · ${esc(b.name)}` : '<span class="muted">main bank</span>'}</div>
        ${host ? `<div class="bank-acts"><button class="btn tiny" data-up="${r}">Upload</button><button class="btn tiny" data-edit="${r}">Edit</button>${b ? `<button class="btn tiny ghost" data-reset="${r}" title="Use the main bank">✕</button>` : ''}</div>` : ''}</div>`;
    }
    return main + `<div class="bank-sub muted small">Per-round banks (optional)</div>` + rows;
  }
  bindBanks(root) {
    root.querySelectorAll('[data-up]').forEach((el) => el.onclick = () => this.pickCsv(Number(el.dataset.up)));
    root.querySelectorAll('[data-edit]').forEach((el) => el.onclick = () => this.net.send({ t: 'getQuestions', target: Number(el.dataset.edit) }));
    root.querySelectorAll('[data-reset]').forEach((el) => el.onclick = () => this.net.send({ t: 'resetQuestions', target: Number(el.dataset.reset) }));
  }

  // ------------------------------------------------------------------ question editor
  openEditor(m) {
    const pad = (o) => [0, 1, 2, 3].map((i) => o[i] ?? '');
    this.ed = { round: m.round, name: m.name, list: m.questions.map((q) => ({ q: q.q, options: pad(q.options), answer: q.answer, category: q.category, difficulty: q.difficulty })) };
    if (!this.ed.list.length) this.ed.list.push(this.blankQ());
    this.renderEditor();
  }
  blankQ() { return { q: '', options: ['', '', '', ''], answer: 0, category: 'General', difficulty: 'medium' }; }
  renderEditor() {
    const ed = this.ed;
    const qs = ed.list.map((q, i) => `<div class="ed-q" data-i="${i}">
      <div class="ed-row"><b class="ed-n">${i + 1}</b><textarea class="ed-text" data-f="q" rows="2" maxlength="400" placeholder="Question text">${esc(q.q)}</textarea>
        <button class="btn tiny danger" data-del="${i}" title="Delete question">✕</button></div>
      <div class="ed-opts">${q.options.map((o, k) => `<label class="ed-opt ${q.answer === k ? 'right' : ''}"><input type="radio" name="ans${i}" data-f="answer" value="${k}" ${q.answer === k ? 'checked' : ''} title="Correct answer"><span>${'ABCD'[k]}</span><input data-f="opt" data-k="${k}" maxlength="140" value="${esc(o)}" placeholder="${k < 2 ? 'Option' : 'Optional'}"></label>`).join('')}</div>
      <div class="ed-row small"><input data-f="category" maxlength="40" value="${esc(q.category)}" placeholder="Category"><select data-f="difficulty">${['easy', 'medium', 'hard'].map((d) => `<option ${q.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
    </div>`).join('');
    this.modal(`<h2>Edit questions · ${ed.round ? `Round ${ed.round}` : 'Main bank'}</h2>
      <div class="ed-bar"><input id="ed-name" maxlength="60" value="${esc(ed.name)}" placeholder="Bank name"><span class="muted" id="ed-count">${ed.list.length}/100</span>
        <button class="btn small" id="ed-add">+ Question</button><button class="btn small" id="ed-import">Import CSV</button><button class="btn small" id="ed-export">Export CSV</button>
        <button class="btn small primary" id="ed-save">Save & use</button></div>
      <p class="muted small">Tick the circle next to the correct answer. Options C and D are optional. ${ed.round ? `Saved questions are used in round ${ed.round}${this.liveRound === ed.round ? ' starting with the next question' : ''}.` : 'The main bank is used in every round without its own bank.'}</p>
      <div id="ed-errors" class="q-report"></div><div class="ed-list">${qs}</div>
      <input id="ed-file" type="file" accept=".csv,text/csv,.txt" hidden>`);
    const body = $('modal-body');
    body.querySelector('.ed-list').addEventListener('input', (e) => this.editorInput(e));
    body.querySelector('.ed-list').addEventListener('change', (e) => this.editorInput(e));
    body.querySelectorAll('[data-del]').forEach((el) => el.onclick = () => { this.syncEditor(); ed.list.splice(Number(el.dataset.del), 1); if (!ed.list.length) ed.list.push(this.blankQ()); this.renderEditor(); });
    $('ed-name').oninput = (e) => { ed.name = e.target.value; };
    $('ed-add').onclick = () => {
      if (ed.list.length >= 100) { this.toast('Max 100 questions per bank.', 'error'); return; }
      ed.list.push(this.blankQ()); this.renderEditor();
      const last = $('modal-body').querySelector('.ed-q:last-child .ed-text'); last?.focus(); last?.scrollIntoView({ block: 'center' });
    };
    $('ed-import').onclick = () => $('ed-file').click();
    $('ed-file').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const res = parseQuestionCSV(String(rd.result || ''));
        if (!res.questions.length) { this.toast('No valid questions in that file.', 'error'); return; }
        const blank = ed.list.length === 1 && !ed.list[0].q;
        if (blank) ed.list = [];
        for (const q of res.questions) if (ed.list.length < 100) ed.list.push({ ...q, options: [0, 1, 2, 3].map((i) => q.options[i] ?? '') });
        this.toast(`Added ${res.questions.length} questions${res.errorCount ? ` (${res.errorCount} rows skipped)` : ''}.`, 'good');
        this.renderEditor();
      };
      rd.readAsText(f);
    };
    $('ed-export').onclick = () => {
      const { questions } = validateQuestions(ed.list);
      if (!questions.length) { this.toast('Nothing complete to export yet.', 'error'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([questionsToCSV(questions)], { type: 'text/csv' }));
      a.download = `${(ed.name || 'questions').replace(/[^\w\- ]/g, '') || 'questions'}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('ed-save').onclick = () => {
      const { questions, errors } = validateQuestions(ed.list);
      const box = $('ed-errors');
      if (errors.length) { box.innerHTML = `<ul>${errors.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`; if (!questions.length || !confirm(`${errors.length} question(s) are incomplete and will be skipped. Save the other ${questions.length}?`)) return; }
      this.net.send({ t: 'setQuestions', target: ed.round, name: ed.name || 'My questions', questions: ed.list });
      this.closeModal();
    };
  }
  syncEditor() {} // inputs write straight into this.ed (see editorInput)
  editorInput(e) {
    const card = e.target.closest('.ed-q'); if (!card) return;
    const q = this.ed.list[Number(card.dataset.i)]; const f = e.target.dataset.f;
    if (f === 'q') q.q = e.target.value;
    else if (f === 'opt') q.options[Number(e.target.dataset.k)] = e.target.value;
    else if (f === 'answer') { q.answer = Number(e.target.value); card.querySelectorAll('.ed-opt').forEach((l, k) => l.classList.toggle('right', k === q.answer)); }
    else if (f === 'category') q.category = e.target.value;
    else if (f === 'difficulty') q.difficulty = e.target.value;
  }

  // ------------------------------------------------------------------ lobby
  renderLobby(room) {
    this.room = room;
    document.body.classList.toggle('is-host', this.isHost);
    $('room-code').textContent = room.code;
    const pl = $('player-list');
    const host = this.isHost;
    const rows = room.players.map((p) => {
      const roleSel = host
        ? `<select data-role="${p.id}">${['defender', 'striker', 'spectator'].map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''} ${p.isBot && r === 'spectator' ? 'disabled' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>`
        : `<span class="badge ${p.role === 'defender' ? 'def' : p.role === 'striker' ? 'str' : ''}">${ROLE_LABEL[p.role]}</span>`;
      const badges = `${p.id === room.hostId ? '<span class="badge host">Host</span>' : ''}${p.isBot ? '<span class="badge">Bot</span>' : ''}${!p.connected && !p.isBot ? '<span class="badge off">Offline</span>' : ''}${p.id === this.myId ? '<span class="badge">You</span>' : ''}`;
      const acts = host && p.id !== this.myId ? `${!p.isBot ? `<button class="btn tiny ghost" data-host="${p.id}" title="Make host">👑</button>` : ''}<button class="btn tiny danger" data-kick="${p.id}" title="Remove">✕</button>` : '';
      return `<div class="player-row ${p.role}"><span class="pname">${esc(p.name)}</span>${badges}${roleSel}${acts}</div>`;
    });
    for (let i = room.players.length; i < MAX_PLAYERS; i++) rows.push('<div class="player-row empty-slot"><span class="pname muted">Open slot</span></div>');
    pl.innerHTML = rows.join('');
    pl.querySelectorAll('[data-role]').forEach((el) => el.onchange = () => this.net.send({ t: 'role', id: Number(el.dataset.role), role: el.value }));
    pl.querySelectorAll('[data-kick]').forEach((el) => el.onclick = () => this.net.send({ t: 'kick', id: Number(el.dataset.kick) }));
    pl.querySelectorAll('[data-host]').forEach((el) => el.onclick = () => { if (confirm('Transfer host?')) this.net.send({ t: 'transferHost', id: Number(el.dataset.host) }); });
    $('player-count').textContent = `${room.players.length}/${MAX_PLAYERS}`;
    const defs = room.players.filter((p) => p.role === 'defender').length;
    const strs = room.players.filter((p) => p.role === 'striker').length;
    let status = '';
    if (defs !== 1) status = 'Assign exactly one Defender (player or bot).';
    else if (strs < 1) status = 'Assign at least one Striker (player or bot).';
    else status = `Ready: 1 defender vs ${strs} striker${strs > 1 ? 's' : ''} on ${MAPS[room.settings.mapId]?.name || 'the field'}.`;
    $('start-status').textContent = status;
    $('btn-start').disabled = !(defs === 1 && strs >= 1) || room.state === 'game';
    $('btn-add-bot-striker').disabled = $('btn-add-bot-defender').disabled = room.players.length >= MAX_PLAYERS;
    const n = Math.max(1, strs);
    const s = room.settings;
    const mb = mapBalance(buildMap(s.mapId), n);
    const df = (s.scaleRewards ? REWARD_SCALE.defender[n - 1] : 1) * mb.def, sf = s.scaleRewards ? REWARD_SCALE.striker[n - 1] : 1;
    const hp = Math.round(BASE_HP * BASE_HP_SCALE[n - 1] * s.baseHpMult * mb.hp);
    $('scaling-info').innerHTML = `<b>Reward scaling for ${n} striker${n > 1 ? 's' : ''}</b>: defender ×${(df * s.defenderRewardMult).toFixed(2)} rewards, each striker ×${(sf * s.strikerRewardMult).toFixed(2)}. Core HP ≈ <b>${hp.toLocaleString()}</b>${s.coreBreachCap ? `, lockdown after ${s.coreBreachCap}%/round` : ''}. Respawn ×${RESPAWN_SCALE[n - 1]}.`;
    this.renderSettings(room.settings, host);
    $('q-banks').innerHTML = this.banksHtml(room.qInfo, room.settings.rounds, host);
    this.bindBanks($('q-banks'));
  }

  renderSettings(s, host) {
    const form = $('settings-form');
    const focused = document.activeElement && form.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    if (!this.settingsBuilt || this.settingsHost !== host) {
      this.settingsBuilt = true; this.settingsHost = host;
      let group = '', html = '';
      for (const f of SETTINGS_SCHEMA) {
        if (f.group !== group) { group = f.group; html += `<div class="set-group">${group}</div>`; }
        let input;
        if (f.type === 'bool') input = `<input type="checkbox" data-key="${f.key}" ${host ? '' : 'disabled'}>`;
        else if (f.type === 'select') input = `<select data-key="${f.key}" ${host ? '' : 'disabled'}>${f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
        else input = `<input type="number" data-key="${f.key}" min="${f.min}" max="${f.max}" step="${f.step || (f.type === 'int' ? 1 : 0.05)}" ${host ? '' : 'disabled'}>`;
        html += `<div class="set-row"><label>${f.label}</label>${input}</div>`;
      }
      form.innerHTML = html;
      form.querySelectorAll('[data-key]').forEach((el) => {
        el.addEventListener('change', () => {
          const f = SETTINGS_SCHEMA.find((x) => x.key === el.dataset.key);
          const v = f.type === 'bool' ? el.checked : f.type === 'select' ? el.value : Number(el.value);
          this.net.send({ t: 'settings', settings: { [f.key]: v } });
        });
      });
      $('preset-row').innerHTML = Object.entries(PRESETS).map(([k, p]) => `<button class="btn small" data-preset="${k}">${p.label}</button>`).join('');
      $('preset-row').querySelectorAll('[data-preset]').forEach((el) => el.onclick = () => this.net.send({ t: 'settings', preset: el.dataset.preset }));
    }
    form.querySelectorAll('[data-key]').forEach((el) => {
      if (el.dataset.key === focused) return;
      const v = s[el.dataset.key];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    });
    // bans
    const bf = $('ban-form');
    bf.innerHTML = Object.entries(BAN_LISTS).map(([k, ids]) => `<div class="ban-group"><h4>${BAN_META[k][0]}</h4><div class="ban-items">${ids.map((id) => {
      const d = BAN_META[k][1][id];
      return `<span class="ban-item ${s[k].includes(id) ? 'banned' : ''} ${host ? '' : 'locked'}" data-ban="${k}" data-id="${id}">${d.icon || ''} ${esc(d.name)}</span>`;
    }).join('')}</div></div>`).join('');
    if (host) bf.querySelectorAll('[data-ban]').forEach((el) => el.onclick = () => {
      const k = el.dataset.ban, id = el.dataset.id;
      const cur = new Set(this.room.settings[k]);
      if (cur.has(id)) cur.delete(id); else cur.add(id);
      this.net.send({ t: 'settings', settings: { [k]: [...cur] } });
    });
  }

  // ------------------------------------------------------------------ chat
  addChat(m) {
    const line = document.createElement('div');
    if (!m.from) { line.className = 'sys'; line.textContent = m.text; }
    else line.innerHTML = `<span class="from-${m.role === 'defender' ? 'def' : m.role === 'striker' ? 'str' : 'spectator'}">${esc(m.from)}:</span> ${esc(m.text)}`;
    for (const id of ['lobby-chat', 'chat-log']) {
      const box = $(id);
      const c = line.cloneNode(true);
      box.appendChild(c);
      while (box.children.length > 40) box.firstChild.remove();
      box.scrollTop = box.scrollHeight;
      if (id === 'chat-log') { c.style.transition = 'opacity 1s'; setTimeout(() => { if (!this.chatOpen) c.style.opacity = 0.35; }, 8000); }
    }
  }
  openChat() {
    const inp = $('chat-input');
    this.chatOpen = true;
    inp.classList.remove('hidden');
    inp.focus();
    document.exitPointerLock?.();
    $('chat-log').querySelectorAll('div').forEach((d) => d.style.opacity = 1);
  }
  closeChat(send) {
    const inp = $('chat-input');
    if (send && inp.value.trim()) this.net.send({ t: 'chat', text: inp.value });
    inp.value = '';
    inp.classList.add('hidden');
    inp.blur();
    this.chatOpen = false;
  }

  // ------------------------------------------------------------------ in-game common
  feed(html, cls = '') {
    const el = document.createElement('div');
    el.className = cls; el.innerHTML = html;
    const kf = $('killfeed');
    kf.prepend(el);
    while (kf.children.length > 6) kf.lastChild.remove();
    setTimeout(() => el.remove(), 7000);
  }
  banner(text, sub = '', cls = '', ms = 2600) {
    const b = $('banner');
    b.className = 'banner ' + cls;
    b.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    b.classList.remove('hidden');
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => b.classList.add('hidden'), ms);
  }
  centerMsg(text, ms = 1500) {
    $('center-msg').textContent = text;
    clearTimeout(this.cmT);
    this.cmT = setTimeout(() => { $('center-msg').textContent = ''; }, ms);
  }
  renderScoreboard(snap, room) {
    if (!snap || !room) return;
    const rows = room.players.map((p) => {
      const a = snap.a.find((x) => x[0] === p.id);
      const st = this.statsCache && this.statsCache[p.id];
      return `<tr><td>${esc(p.name)}${p.isBot ? ' 🤖' : ''}</td><td>${ROLE_LABEL[p.role]}</td><td>${a ? (a[9] & 1 ? `${a[6]} HP` : '💀') : '-'}</td><td>${st ? st : ''}</td></tr>`;
    });
    $('scoreboard').innerHTML = `<h3 style="margin:0 0 8px">Scoreboard · Round ${snap.rd}/${snap.nr}</h3><table><tr><th>Player</th><th>Role</th><th>Status</th><th></th></tr>${rows.join('')}</table><p class="muted small" style="margin:8px 0 0">Reward scaling: defender ×${snap.df}, strikers ×${snap.sf}.</p>`;
  }

  renderHostPanel(room, snap) {
    if (!room) return;
    const paused = snap && snap.pa;
    const players = room.players.map((p) => `<div class="hp-player"><span class="nm">${esc(p.name)}${p.isBot ? ' 🤖' : ''}</span>
      <select data-hrole="${p.id}">${['defender', 'striker', 'spectator'].map((r) => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>
      ${p.role !== 'spectator' ? `<button class="btn tiny" data-coins="${p.id}" data-amt="100">+100💰</button><button class="btn tiny" data-coins="${p.id}" data-amt="-100">−100</button>` : ''}
      ${p.id !== this.myId ? `<button class="btn tiny danger" data-hkick="${p.id}">✕</button>` : ''}</div>`).join('');
    $('host-panel').innerHTML = `<div class="row" style="justify-content:space-between"><b>Host controls</b><button class="btn tiny ghost" data-hclose>✕</button></div>
      <h3>Match flow</h3><div class="grid2">
        <button class="btn small" data-cmd="${paused ? 'resume' : 'pause'}">${paused ? '▶ Resume' : '⏸ Pause'}</button>
        <button class="btn small" data-cmd="skip">⏭ Skip phase</button>
        <button class="btn small" data-cmd="time" data-sec="30">+30s</button>
        <button class="btn small" data-cmd="time" data-sec="-30">−30s</button>
        <button class="btn small" data-cmd="baseHp" data-pct="10">Core +10%</button>
        <button class="btn small" data-cmd="baseHp" data-pct="-10">Core −10%</button>
        <button class="btn small" data-cmd="botDefender">🤖 Bot defender</button>
        <button class="btn small" data-settings>⚙ Live settings</button>
        <button class="btn small danger" data-cmd="end">End match</button>
        <button class="btn small danger" data-cmd="lobby">Back to lobby</button>
      </div>
      <h3>Question bank · round ${snap ? snap.rd : 1}</h3>
      <div class="grid2"><button class="btn small" data-qnow>📤 CSV → this round</button><button class="btn small" data-qnext>📤 CSV → next round</button></div>
      <div class="hp-banks">${this.banksHtml(room.qInfo, room.settings.rounds, true, snap ? snap.rd : 0)}</div>
      <h3>Players & roles</h3>${players}
      <div class="row gap" style="margin-top:8px"><button class="btn tiny" data-addbot>+ Bot striker</button></div>
      <h3>Audio</h3><input type="range" min="0" max="1" step="0.05" value="${this.sfx.volume}" data-vol style="width:100%">`;
    const hp = $('host-panel');
    hp.querySelector('[data-hclose]').onclick = () => hp.classList.add('hidden');
    hp.querySelectorAll('[data-cmd]').forEach((el) => el.onclick = () => {
      const cmd = el.dataset.cmd;
      if ((cmd === 'end' || cmd === 'lobby') && !confirm(cmd === 'end' ? 'End the match now?' : 'Abort the match and return everyone to the lobby?')) return;
      this.net.send({ t: 'host', cmd, sec: Number(el.dataset.sec), pct: Number(el.dataset.pct) });
    });
    hp.querySelectorAll('[data-hrole]').forEach((el) => el.onchange = () => this.net.send({ t: 'role', id: Number(el.dataset.hrole), role: el.value }));
    hp.querySelectorAll('[data-coins]').forEach((el) => el.onclick = () => this.net.send({ t: 'host', cmd: 'coins', id: Number(el.dataset.coins), amount: Number(el.dataset.amt) }));
    hp.querySelectorAll('[data-hkick]').forEach((el) => el.onclick = () => { if (confirm('Kick this player?')) this.net.send({ t: 'kick', id: Number(el.dataset.hkick) }); });
    hp.querySelector('[data-addbot]').onclick = () => this.net.send({ t: 'addBot', role: 'striker' });
    hp.querySelector('[data-vol]').oninput = (e) => this.sfx.setVolume(Number(e.target.value));
    hp.querySelector('[data-settings]').onclick = () => this.liveSettings();
    hp.querySelector('[data-qnow]').onclick = () => this.pickCsv('now');
    hp.querySelector('[data-qnext]').onclick = () => this.pickCsv('next');
    this.liveRound = snap ? snap.rd : 0;
    this.bindBanks(hp.querySelector('.hp-banks'));
  }
  liveSettings() {
    const locked = new Set(['mapId', 'checkpoints', 'baseHpMult', 'defenderStartCoins', 'strikerStartCoins', 'strikerHpMult']);
    const s = this.room.settings;
    const rows = SETTINGS_SCHEMA.filter((f) => !locked.has(f.key)).map((f) => {
      let input;
      if (f.type === 'bool') input = `<input type="checkbox" data-lkey="${f.key}" ${s[f.key] ? 'checked' : ''}>`;
      else if (f.type === 'select') input = `<select data-lkey="${f.key}">${f.options.map(([v, l]) => `<option value="${v}" ${s[f.key] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
      else input = `<input type="number" data-lkey="${f.key}" value="${s[f.key]}" min="${f.min}" max="${f.max}" step="${f.step || (f.type === 'int' ? 1 : 0.05)}">`;
      return `<div class="set-row"><label>${f.label}</label>${input}</div>`;
    }).join('');
    this.modal(`<h2>Live settings</h2><p class="muted">Changes apply immediately (timers & reward multipliers from the next phase/round).</p><div class="settings-form">${rows}</div>`);
    document.querySelectorAll('[data-lkey]').forEach((el) => el.addEventListener('change', () => {
      const f = SETTINGS_SCHEMA.find((x) => x.key === el.dataset.lkey);
      const v = f.type === 'bool' ? el.checked : f.type === 'select' ? el.value : Number(el.value);
      this.net.send({ t: 'settings', settings: { [f.key]: v } });
    }));
  }

  renderResults(r, room) {
    const win = r.winner === 'defender' ? '<h1 class="def">🛡 DEFENDER WINS</h1>' : r.winner === 'strikers' ? '<h1 class="str">💥 STRIKERS WIN</h1>' : '<h1>MATCH ENDED</h1>';
    const sub = `${esc(r.mapName || '')} · ${r.rounds}/${r.totalRounds} rounds · Core ${r.baseHp.toLocaleString()}/${r.baseMax.toLocaleString()} HP`;
    const bars = (r.roundLog || []).map((l) => `<div style="height:${Math.max(2, (l.baseHp / l.baseMax) * 100)}%" title="Round ${l.round}: ${l.baseHp} HP"><span>R${l.round}</span></div>`).join('');
    const sorted = [...r.players].sort((a, b) => b.points - a.points);
    const mvp = sorted[0];
    const rows = sorted.map((p) => p.role === 'defender'
      ? `<tr><td>${esc(p.name)}${p.isBot ? ' 🤖' : ''}</td><td>🛡 Defender</td><td>${p.points}</td><td>${p.correct}✔ ${p.wrong}✘ ${p.timeouts || 0}⏱ · best streak ${p.bestStreak}</td><td>${p.kills} kills · ${p.built} built</td><td>${p.coinsEarned}</td></tr>`
      : `<tr><td>${esc(p.name)}${p.isBot ? ' 🤖' : ''}</td><td>⚔ Striker</td><td>${p.points}</td><td>${p.disables} towers disabled · ${p.baseDmg} core dmg</td><td>${p.deaths} deaths · ${p.accuracy}% acc</td><td>${p.coinsEarned}</td></tr>`).join('');
    const host = room && room.hostId === this.myId;
    $('results').innerHTML = `${win}<p class="sub">${sub}</p>${bars ? `<div class="muted small">Core HP after each round</div><div class="round-bars">${bars}</div>` : ''}
      ${mvp ? `<p class="mvp">⭐ MVP: ${esc(mvp.name)} (${mvp.points} pts)</p>` : ''}
      <table><tr><th>Player</th><th>Role</th><th>Points</th><th>Performance</th><th></th><th>Coins earned</th></tr>${rows}</table>
      <div class="row gap" style="justify-content:center;margin-top:18px">${host ? '<button class="btn primary big" id="btn-to-lobby">Back to lobby</button>' : '<span class="muted">Waiting for the host…</span>'}</div>`;
    if (host) $('btn-to-lobby').onclick = () => this.net.send({ t: 'lobby' });
  }

  howTo() {
    this.modal(`<h2>How to play TowerStrike</h2>
      <p>One <b style="color:var(--def)">Defender</b> protects the crystal core with towers. Up to five <b style="color:var(--str)">Strikers</b> fight along the fenced route to break it. Each round has a <b>Prep</b> phase (build, scout, shop) followed by an <b>Assault</b>. The core never regenerates, but towers always come back online at the start of each round.</p>
      <div class="howto-cols"><div>
        <h3>🛡 Defender (isometric)</h3><ul>
          <li>Answer quiz questions (keys <kbd>1</kbd>–<kbd>4</kbd>) to earn coins. Fast answers and streaks pay more; wrong answers lock you out briefly.</li>
          <li>Pick a tower from the left palette and click a green pad beside the route. Traps (spikes, barricades, mines) go <i>on</i> the route.</li>
          <li>Click a tower to upgrade, sell or change its targeting.</li>
          <li>Abilities: <kbd>Z</kbd> Airstrike · <kbd>X</kbd> Cryo · <kbd>C</kbd> Overcharge · <kbd>V</kbd> Reboot · <kbd>F</kbd> Fortify.</li>
          <li>Camera: <kbd>WASD</kbd>/arrows or right-drag to pan, wheel to zoom, <kbd>Q</kbd>/<kbd>E</kbd> to rotate. <kbd>Esc</kbd> cancels.</li>
          <li>Support towers matter: Repair Bays reboot disabled towers, Shield Generators protect them, Radar exposes cloaks.</li>
        </ul></div><div>
        <h3>⚔ Striker (first person)</h3><ul>
          <li><kbd>WASD</kbd> move, <kbd>Shift</kbd> sprint, <kbd>Space</kbd> jump, mouse to aim, <kbd>LMB</kbd> fire, <kbd>RMB</kbd> aim/scope, <kbd>R</kbd> reload.</li>
          <li><kbd>B</kbd> opens the shop (during prep, in spawn, or at captured checkpoints). <kbd>1</kbd>/<kbd>2</kbd> switch weapons, <kbd>3</kbd>–<kbd>0</kbd> use gear.</li>
          <li>Shooting a tower to zero <b>disables</b> it for the round. Clear the route, then attack the core from inside its plaza: the core's shield blocks damage from further away.</li>
          <li>Capture checkpoints (stand on the ring with no online tower nearby) to respawn further forward and resupply.</li>
          <li>Weapons lose damage over range. Get close, use smoke, EMP and domes, and bring support troops.</li>
        </ul></div></div>
      <h3>Shared</h3><ul><li><kbd>Enter</kbd> chat · <kbd>Tab</kbd> scoreboard · <kbd>H</kbd> host panel (host only) · <kbd>M</kbd> mute.</li>
      <li>Rewards scale with team size: the defender earns more against bigger squads, while each striker's share shrinks.</li>
      <li><b>Core lockdown:</b> the core seals itself after losing a set share of its HP in one round, so strikers need several successful assaults.</li></ul>`);
  }
}
