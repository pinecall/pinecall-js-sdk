// ── WebRTC Page Logic ──────────────────────────────────────
const AGENT = '__AGENT_ID__';
const LANG_PRESETS = __LANG_PRESETS__;
const DEFAULT_CONFIG = __DEFAULT_CONFIG__;
const { PinecallWebRTC } = Pinecall;

let webrtc = null, events = [], dtimer = null, cstart = 0, bots = {}, selectedConfig = DEFAULT_CONFIG;

const micSVG = '<svg class="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/></svg>';
const xSVG = '<svg class="w-[22px] h-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>';

function $(id) { return document.getElementById(id) }

// ── Language switching ─────────────────────────────────────
function switchLang(k) {
  const p = LANG_PRESETS[k]; if (!p) return;
  const c = {};
  if (p.voice) c.voice = p.voice;
  if (p.stt) c.stt = p.stt;
  if (p.language) c.language = p.language;
  if (p.turnDetection) c.turnDetection = p.turnDetection;
  if (p.greeting) c.greeting = p.greeting;
  if (webrtc) {
    webrtc.send({ action: 'configure', ...c });
    addChatMsg('system', 'Language → ' + (p.label || k));
  } else {
    selectedConfig = (k === 'default') ? null : c;
    $('statusPill').textContent = 'Ready — ' + (p.label || k);
  }
}

// ── Chat messages ──────────────────────────────────────────
function addChatMsg(role, text, opts = {}) {
  const es = $('emptyState'); if (es) es.remove();
  const row = document.createElement('div');
  row.className = 'fade-in flex ' + (role === 'user' ? 'justify-end' : role === 'system' ? 'justify-center' : 'justify-start');

  const b = document.createElement('div');
  if (role === 'system') {
    b.className = 'msg-system';
  } else if (role === 'user') {
    b.className = 'msg-user' + (opts.interim ? ' interim' : '');
  } else {
    b.className = 'msg-bot';
  }
  b.textContent = text;
  if (opts.id) b.id = opts.id;
  row.appendChild(b);
  $('chat').appendChild(row);
  $('chat').scrollTop = $('chat').scrollHeight;
  return b;
}

function addToolCall(name, args) {
  const es = $('emptyState'); if (es) es.remove();
  const row = document.createElement('div');
  row.className = 'fade-in flex justify-center';
  const b = document.createElement('div');
  b.className = 'msg-tool';
  b.innerHTML = '<span class="text-violet-400">⚡ ' + name + '</span><span class="text-zinc-500">' + args.slice(0, 100) + '</span>';
  row.appendChild(b);
  $('chat').appendChild(row);
  $('chat').scrollTop = $('chat').scrollHeight;
}

function addToolResult(text) {
  const es = $('emptyState'); if (es) es.remove();
  const row = document.createElement('div');
  row.className = 'fade-in flex justify-center';
  const b = document.createElement('div');
  b.className = 'msg-result';
  b.innerHTML = '<span class="text-emerald-500">✓</span> <span class="text-zinc-500">' + text + '</span>';
  row.appendChild(b);
  $('chat').appendChild(row);
  $('chat').scrollTop = $('chat').scrollHeight;
}

function updateMsg(id, text, opts = {}) {
  const el = $(id); if (!el) return;
  if (text) el.textContent = text;
  if (opts.interrupted) {
    // Remove empty placeholder messages entirely
    if (!el.textContent || el.textContent === '…') { el.parentElement?.remove(); return; }
    el.style.opacity = '.3';
    el.style.textDecoration = 'line-through';
  }
  if (opts.done) el.classList.remove('pulse');
}

// ── Events sidebar ─────────────────────────────────────────
function addEvent(e) {
  events.push(e);
  $('eventCount').textContent = events.length;
  const el = document.createElement('div');
  el.className = 'evt-row';
  const color = e.event?.startsWith('user') ? 'bg-emerald-500'
    : e.event?.startsWith('bot') ? 'bg-violet-400'
    : e.event?.startsWith('llm') ? 'bg-amber-400'
    : 'bg-zinc-600';
  el.innerHTML = '<div class="flex items-center gap-2"><div class="w-1 h-1 rounded-full flex-shrink-0 ' + color + '"></div><span class="font-mono text-[11px] text-zinc-400 truncate">' + e.event + '</span></div>';
  el.onclick = () => {
    const p = el.querySelector('pre');
    if (p) { p.remove(); return; }
    const pr = document.createElement('pre');
    pr.className = 'mt-1.5 font-mono text-[10px] p-2 rounded bg-zinc-950 text-zinc-500 overflow-x-auto max-h-28';
    pr.style.whiteSpace = 'pre-wrap';
    pr.style.wordBreak = 'break-all';
    pr.textContent = JSON.stringify(e, null, 2);
    el.appendChild(pr);
  };
  $('eventsList').appendChild(el);
  $('eventsList').scrollTop = $('eventsList').scrollHeight;
}
function clearEvents() { events = []; $('eventsList').innerHTML = ''; $('eventCount').textContent = '0'; }
function toggleEvents() { const p = $('eventsPanel'); p.classList.toggle('hidden'); p.classList.toggle('flex'); }

// ── Duration ───────────────────────────────────────────────
function startDur() {
  cstart = Date.now();
  $('duration').classList.remove('hidden');
  dtimer = setInterval(() => {
    const s = Math.floor((Date.now() - cstart) / 1000);
    $('duration').textContent = Math.floor(s / 60) + ':' + (s % 60).toString().padStart(2, '0');
  }, 1000);
}
function stopDur() { if (dtimer) { clearInterval(dtimer); dtimer = null; } }

// ── Mute ───────────────────────────────────────────────────
function doMute() {
  if (!webrtc) return;
  webrtc.toggleMute();
  $('muteBtn').textContent = webrtc.isMuted ? '🔇' : '🎙';
}

// ── Call toggle ────────────────────────────────────────────
async function toggleCall() {
  if (webrtc) {
    webrtc.disconnect(); webrtc = null; stopDur();
    $('callBtn').innerHTML = micSVG;
    $('callBtn').className = 'relative z-10 w-[52px] h-[52px] rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/10 hover:bg-emerald-500 hover:shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer';
    $('callRing').classList.add('hidden');
    $('muteBtn').classList.add('hidden');
    $('statusDot').className = 'w-1.5 h-1.5 rounded-full bg-zinc-600 transition-colors duration-300';
    $('statusPill').textContent = 'Disconnected';
    return;
  }

  $('statusPill').textContent = 'Connecting…';
  $('callRing').classList.remove('hidden');
  bots = {};

  try {
    const opts = selectedConfig ? { config: selectedConfig } : {};
    webrtc = new PinecallWebRTC(AGENT, opts);

    webrtc.on('connected', () => {
      $('callBtn').innerHTML = xSVG;
      $('callBtn').className = 'relative z-10 w-[52px] h-[52px] rounded-2xl bg-red-500 text-white flex items-center justify-center shadow-lg shadow-red-500/10 hover:bg-red-400 hover:shadow-red-400/20 active:scale-95 transition-all cursor-pointer';
      $('callRing').classList.add('hidden');
      $('muteBtn').classList.remove('hidden');
      $('statusDot').className = 'w-1.5 h-1.5 rounded-full bg-emerald-500 transition-colors duration-300';
      $('statusPill').textContent = 'Connected';
      $('chat').innerHTML = '';
      startDur();
    });

    webrtc.on('disconnected', () => {
      stopDur();
      $('callBtn').innerHTML = micSVG;
      $('callBtn').className = 'relative z-10 w-[52px] h-[52px] rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/10 hover:bg-emerald-500 hover:shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer';
      $('callRing').classList.add('hidden');
      $('muteBtn').classList.add('hidden');
      $('statusDot').className = 'w-1.5 h-1.5 rounded-full bg-zinc-600 transition-colors duration-300';
      $('statusPill').textContent = 'Disconnected';
      webrtc = null;
    });

    webrtc.on('session.started', (d) => addEvent({ event: 'session.started', ...d }));

    // ── User speech ──────────────────────────────────────
    let intEl = null;
    webrtc.on('user.speaking', (d) => {
      if (!d.text) return;
      if (!intEl) intEl = addChatMsg('user', d.text, { interim: true });
      else intEl.textContent = d.text;
      addEvent({ event: 'user.speaking', text: d.text });
    });
    webrtc.on('user.message', (d) => {
      if (!d.text) return;
      if (intEl) {
        intEl.textContent = d.text;
        intEl.className = 'msg-user';
        intEl = null;
      } else {
        addChatMsg('user', d.text);
      }
      addEvent({ event: 'user.message', text: d.text });
    });

    // ── Bot speech ───────────────────────────────────────
    webrtc.on('bot.speaking', (d) => {
      if (!d.message_id) return;
      // Skip empty messages (tool-only LLM responses without text)
      if (!d.text || d.text.trim() === '') {
        bots[d.message_id] = { words: [], el: null };
        addEvent({ event: 'bot.speaking', message_id: d.message_id });
        return;
      }
      const id = 'b-' + d.message_id;
      const el = addChatMsg('bot', d.text, { id });
      el.classList.add('pulse');
      bots[d.message_id] = { words: [], el: id };
      addEvent({ event: 'bot.speaking', message_id: d.message_id });
    });

    webrtc.on('bot.word', (d) => {
      const e = bots[d.message_id]; if (!e) return;
      // Auto-create bot message on first word if bot.speaking had no text
      if (!e.el) {
        const id = 'b-' + d.message_id;
        const el = addChatMsg('bot', d.word, { id });
        el.classList.add('pulse');
        e.el = id;
      }
      e.words[d.word_index ?? e.words.length] = d.word;
      updateMsg(e.el, e.words.filter(Boolean).join(' '));
    });

    webrtc.on('bot.finished', (d) => {
      const e = bots[d.message_id];
      if (e && e.el) { if (d.text) updateMsg(e.el, d.text); updateMsg(e.el, null, { done: true }); }
      addEvent({ event: 'bot.finished', message_id: d.message_id });
    });

    webrtc.on('bot.interrupted', (d) => {
      const e = bots[d.message_id];
      if (e && e.el) updateMsg(e.el, null, { interrupted: true, done: true });
      addEvent({ event: 'bot.interrupted', message_id: d.message_id });
    });

    // ── Tool events ──────────────────────────────────────
    webrtc.on('llm.tool_call', (d) => {
      (d.tool_calls || []).forEach(tc => {
        let a = '{}';
        try { a = JSON.stringify(JSON.parse(tc.arguments)); } catch { a = tc.arguments || '{}'; }
        addToolCall(tc.name, a);
      });
      addEvent({ event: 'llm.tool_call', tools: (d.tool_calls || []).map(t => t.name) });
    });

    webrtc.on('llm.tool_result', (d) => {
      const r = typeof d.result === 'string' ? d.result : JSON.stringify(d.result || '');
      addToolResult(r.length > 150 ? r.slice(0, 150) + '…' : r);
      addEvent({ event: 'llm.tool_result' });
    });

    webrtc.on('turn.end', (d) => addEvent({ event: 'turn.end', ...d }));

    await webrtc.connect();
  } catch (e) {
    $('statusPill').textContent = 'Error: ' + e.message;
    $('callRing').classList.add('hidden');
    webrtc = null;
  }
}
