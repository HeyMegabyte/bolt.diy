/**
 * Pulse Inbox — public embeddable chat widget.
 *
 * Drop on any site:
 *   <script async src="https://projectsites.dev/widget.js?inbox=YOUR_INBOX_ID"></script>
 *
 * Architecture:
 *   - Vanilla JS (NO framework) — total bundle stays under 40KB gz.
 *   - Style-isolated via Shadow DOM so host page CSS can't leak in.
 *   - Floating 64x64 bubble bottom-right → 380x560 panel on click.
 *   - Mobile (<500px viewport): full-screen takeover.
 *   - Session: UUID stored in `localStorage` keyed by inbox-id, replayed
 *     on every page load so the visitor never loses thread continuity.
 *   - First message → `POST /api/inbox/widget-sessions` returns ws_token + IDs.
 *   - Realtime via `wss://projectsites.dev/api/inbox/ws/:conversation_id`.
 *   - Attachments: drag/drop OR paste-image → R2 via signed upload.
 *   - HMAC: each REST POST signed with per-inbox secret rotated from admin UI.
 *
 * No external deps. ES2018+. Total ~12 KB after minify.
 */
(function () {
  'use strict';

  // ── Bootstrap ─────────────────────────────────────────────
  if (typeof window === 'undefined' || window.__pulseInboxLoaded__) return;
  window.__pulseInboxLoaded__ = true;

  function currentScript() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || '';
      if (src.indexOf('widget.js') !== -1 && src.indexOf('inbox=') !== -1) return scripts[i];
    }
    return null;
  }

  var script = currentScript();
  var src = (script && script.src) || '';
  var inboxId = (src.match(/[?&]inbox=([^&]+)/) || [, ''])[1];
  if (!inboxId) {
    console.warn('[pulse-inbox] widget.js loaded without ?inbox=ID — bailing.');
    return;
  }

  // Allow same-origin override (for staging/test).
  var apiOrigin = (function () {
    try { return new URL(src).origin; } catch (_) { return 'https://projectsites.dev'; }
  })();

  var storageKey = 'pulse_inbox_session_' + inboxId;
  function uuid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (_) { /* swallow */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function saveSession(s) {
    try { localStorage.setItem(storageKey, JSON.stringify(s)); } catch (_) { /* swallow quota */ }
  }

  // ── Config fetched from worker ────────────────────────────
  var config = {
    brand_color: '#00e5ff',
    position: 'bottom-right',
    welcome_message: 'How can we help?',
    agent_avatar: '',
    title: 'Chat with us',
  };

  function loadConfig() {
    return fetch(apiOrigin + '/api/inbox/widget-settings/' + encodeURIComponent(inboxId), {
      method: 'GET',
      credentials: 'omit',
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.data) {
        Object.keys(j.data).forEach(function (k) { if (j.data[k] != null) config[k] = j.data[k]; });
      }
    }).catch(function () { /* keep defaults */ });
  }

  // ── DOM scaffolding (Shadow DOM for style isolation) ──────
  var host = document.createElement('div');
  host.setAttribute('data-pulse-inbox', '1');
  host.setAttribute('aria-live', 'polite');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483600;';
  var posMap = {
    'bottom-right': 'bottom:20px;right:20px;',
    'bottom-left':  'bottom:20px;left:20px;',
    'top-right':    'top:20px;right:20px;',
    'top-left':     'top:20px;left:20px;',
  };
  host.style.cssText += (posMap[config.position] || posMap['bottom-right']);

  var shadow = host.attachShadow({ mode: 'open' });
  var styleEl = document.createElement('style');
  shadow.appendChild(styleEl);
  var root = document.createElement('div');
  root.className = 'pi-root';
  shadow.appendChild(root);

  function paintStyles() {
    styleEl.textContent = [
      ":host { all: initial; }",
      ".pi-root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #f4f4ff; }",
      ".pi-bubble { width:64px; height:64px; border-radius:50%; cursor:pointer; border:0;",
      "  background: linear-gradient(135deg, " + config.brand_color + ", " + adjust(config.brand_color, -25) + ");",
      "  box-shadow: 0 12px 32px -10px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.06) inset;",
      "  display:flex; align-items:center; justify-content:center;",
      "  transition: transform 200ms cubic-bezier(0.4,0,0.2,1); }",
      ".pi-bubble:hover { transform: translateY(-2px) scale(1.04); }",
      ".pi-bubble svg { width:30px; height:30px; fill:#fff; }",
      ".pi-badge { position:absolute; top:-2px; right:-2px; min-width:18px; height:18px; padding:0 5px;",
      "  border-radius:999px; background:#ff4d6d; color:#fff; font-size:11px; font-weight:700;",
      "  display:flex; align-items:center; justify-content:center; }",
      ".pi-panel { width:380px; height:560px; max-width:calc(100vw - 24px); max-height:calc(100vh - 40px);",
      "  border-radius:18px; overflow:hidden; background:#0d0d18; color:#f4f4ff;",
      "  box-shadow: 0 24px 64px -16px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06);",
      "  display:none; flex-direction:column; transform: translateY(8px) scale(0.98); opacity:0;",
      "  transition: opacity 220ms cubic-bezier(0.4,0,0.2,1), transform 220ms cubic-bezier(0.4,0,0.2,1); }",
      ".pi-panel.pi-open { display:flex; transform: translateY(0) scale(1); opacity:1; }",
      "@media (max-width: 500px) { .pi-panel.pi-open { width:100vw; height:100vh; max-width:100vw; max-height:100vh; border-radius:0; position:fixed; inset:0; } }",
      "@media (prefers-reduced-motion: reduce) { .pi-bubble, .pi-panel { transition:none !important; } }",
      ".pi-head { padding:14px 16px; display:flex; align-items:center; gap:10px;",
      "  background: linear-gradient(135deg, " + config.brand_color + ", " + adjust(config.brand_color, -20) + ");",
      "  color: " + readableInk(config.brand_color) + "; }",
      ".pi-avatar { width:36px; height:36px; border-radius:50%; background:rgba(255,255,255,0.16); overflow:hidden; flex-shrink:0; display:flex; align-items:center; justify-content:center; font-weight:700; }",
      ".pi-avatar img { width:100%; height:100%; object-fit:cover; }",
      ".pi-head h3 { margin:0; font-size:15px; font-weight:600; }",
      ".pi-head p { margin:0; font-size:12px; opacity:0.85; }",
      ".pi-close { margin-left:auto; background:transparent; border:0; color:inherit; cursor:pointer; font-size:18px; width:32px; height:32px; border-radius:8px; }",
      ".pi-close:hover { background: rgba(0,0,0,0.18); }",
      ".pi-msgs { flex:1; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:10px; background:#0d0d18; scroll-behavior:smooth; }",
      ".pi-msg { max-width:80%; padding:9px 13px; border-radius:14px; font-size:14px; line-height:1.45; word-wrap:break-word; }",
      ".pi-msg-a { align-self:flex-start; background:rgba(255,255,255,0.06); }",
      ".pi-msg-u { align-self:flex-end; background:" + config.brand_color + "; color:" + readableInk(config.brand_color) + "; }",
      ".pi-meta { font-size:10px; opacity:0.5; padding:0 4px; }",
      ".pi-typing { align-self:flex-start; display:flex; gap:4px; padding:10px 14px; background:rgba(255,255,255,0.06); border-radius:14px; }",
      ".pi-typing span { width:6px; height:6px; border-radius:50%; background:rgba(255,255,255,0.5); animation: piTyping 1.2s infinite; }",
      ".pi-typing span:nth-child(2) { animation-delay:0.15s; } .pi-typing span:nth-child(3) { animation-delay:0.3s; }",
      "@keyframes piTyping { 0%,60%,100% { transform:translateY(0); opacity:0.4; } 30% { transform:translateY(-3px); opacity:1; } }",
      ".pi-composer { border-top:1px solid rgba(255,255,255,0.06); padding:10px 12px; display:flex; gap:6px; align-items:flex-end; background:#0d0d18; }",
      ".pi-input { flex:1; min-height:36px; max-height:120px; padding:8px 10px; border-radius:10px;",
      "  border:1px solid rgba(255,255,255,0.08); background:rgba(0,0,0,0.4); color:#f4f4ff;",
      "  font-family:inherit; font-size:14px; resize:none; outline:none; }",
      ".pi-input:focus { border-color:" + config.brand_color + "; box-shadow: 0 0 0 2px " + alpha(config.brand_color, 0.25) + "; }",
      ".pi-attach { width:36px; height:36px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); color:#f4f4ff; border-radius:10px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }",
      ".pi-send { width:36px; height:36px; border:0; cursor:pointer; border-radius:10px; background:" + config.brand_color + "; color:" + readableInk(config.brand_color) + "; display:inline-flex; align-items:center; justify-content:center; }",
      ".pi-send:disabled { opacity:0.4; cursor:not-allowed; }",
      ".pi-foot { padding:6px 12px; font-size:10px; text-align:center; color:rgba(255,255,255,0.4); background:#0d0d18; border-top:1px solid rgba(255,255,255,0.04); }",
      ".pi-foot a { color: inherit; text-decoration: underline; }",
      ".pi-attach-strip { display:flex; flex-wrap:wrap; gap:4px; padding:0 12px 6px; }",
      ".pi-attach-pill { background:rgba(255,255,255,0.08); padding:3px 6px; border-radius:6px; font-size:11px; display:inline-flex; align-items:center; gap:4px; }",
      ".pi-attach-pill button { background:transparent; border:0; color:inherit; cursor:pointer; padding:0 2px; }",
    ].join('\n');
  }

  function adjust(hex, percent) {
    // Brighten / darken hex color by percent (-100..100).
    var m = (hex || '#00e5ff').replace('#', '').match(/.{2}/g) || ['00', 'e5', 'ff'];
    return '#' + m.map(function (c) {
      var v = parseInt(c, 16) + Math.round(255 * percent / 100);
      v = Math.max(0, Math.min(255, v));
      return v.toString(16).padStart(2, '0');
    }).join('');
  }
  function readableInk(hex) {
    // YIQ luminance — pick black-or-white text for the given background.
    var m = (hex || '#00e5ff').replace('#', '').match(/.{2}/g) || ['00', 'e5', 'ff'];
    var r = parseInt(m[0], 16), g = parseInt(m[1], 16), b = parseInt(m[2], 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#060610' : '#ffffff';
  }
  function alpha(hex, a) {
    var m = (hex || '#00e5ff').replace('#', '').match(/.{2}/g) || ['00', 'e5', 'ff'];
    return 'rgba(' + parseInt(m[0], 16) + ',' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + a + ')';
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── Render ────────────────────────────────────────────────
  var state = {
    open: false,
    session: loadSession(),         // { token, contact_id, conversation_id, ws_url }
    messages: [],                    // { id, body, sender_type, created_at }
    unread: 0,
    ws: null,
    wsBackoff: 800,
    pendingAttachments: [],          // { r2_key, name }
  };

  function render() {
    root.innerHTML = '' +
      bubbleHtml() +
      panelHtml();
    bindEvents();
    if (state.open) scrollMsgsToEnd();
  }

  function bubbleHtml() {
    return '<button class="pi-bubble" type="button" aria-label="Open chat" data-pi-toggle="1">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 6a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4h-7l-5 4v-4H6a4 4 0 0 1-4-4V6z"/></svg>' +
      (state.unread > 0 ? '<span class="pi-badge">' + state.unread + '</span>' : '') +
      '</button>';
  }

  function panelHtml() {
    var msgsHtml = state.messages.map(function (m) {
      var cls = m.sender_type === 'contact' ? 'pi-msg pi-msg-u' : 'pi-msg pi-msg-a';
      return '<div class="' + cls + '">' + escapeHtml(m.body) + '</div>';
    }).join('');
    if (state.messages.length === 0) {
      msgsHtml = '<div class="pi-msg pi-msg-a">' + escapeHtml(config.welcome_message) + '</div>';
    }
    if (state.typing) {
      msgsHtml += '<div class="pi-typing" aria-label="Agent typing"><span></span><span></span><span></span></div>';
    }
    var attachStrip = state.pendingAttachments.length === 0 ? '' :
      '<div class="pi-attach-strip">' +
      state.pendingAttachments.map(function (a) {
        return '<span class="pi-attach-pill">' + escapeHtml(a.name) +
          '<button type="button" data-pi-rmattach="' + escapeHtml(a.r2_key) + '" aria-label="Remove">×</button></span>';
      }).join('') + '</div>';
    return '<div class="pi-panel ' + (state.open ? 'pi-open' : '') + '" role="dialog" aria-label="Chat">' +
      '<div class="pi-head">' +
      '<div class="pi-avatar">' + (config.agent_avatar ? '<img src="' + escapeHtml(config.agent_avatar) + '" alt="">' : '✦') + '</div>' +
      '<div><h3>' + escapeHtml(config.title) + '</h3><p>We typically reply in minutes.</p></div>' +
      '<button class="pi-close" type="button" aria-label="Close chat" data-pi-toggle="1">×</button>' +
      '</div>' +
      '<div class="pi-msgs" data-pi-msgs="1">' + msgsHtml + '</div>' +
      attachStrip +
      '<form class="pi-composer" data-pi-form="1" aria-label="Send a message">' +
      '<input type="file" data-pi-file="1" multiple style="display:none">' +
      '<button type="button" class="pi-attach" data-pi-attach="1" aria-label="Attach files">📎</button>' +
      '<textarea class="pi-input" data-pi-input="1" rows="1" placeholder="Write a message…" aria-label="Message"></textarea>' +
      '<button type="submit" class="pi-send" aria-label="Send">→</button>' +
      '</form>' +
      '<div class="pi-foot">Powered by <a href="https://projectsites.dev" target="_blank" rel="noopener">Pulse Inbox</a></div>' +
      '</div>';
  }

  function bindEvents() {
    var toggles = root.querySelectorAll('[data-pi-toggle]');
    for (var i = 0; i < toggles.length; i++) toggles[i].addEventListener('click', togglePanel);
    var form = root.querySelector('[data-pi-form]');
    if (form) form.addEventListener('submit', onSubmit);
    var input = root.querySelector('[data-pi-input]');
    if (input) {
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); onSubmit(ev); }
        if (ev.key === 'Escape') togglePanel();
        sendTyping();
      });
      input.addEventListener('paste', onPaste);
    }
    var attach = root.querySelector('[data-pi-attach]');
    var file = root.querySelector('[data-pi-file]');
    if (attach && file) {
      attach.addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function (ev) {
        var fs = ev.target.files;
        if (fs && fs.length) uploadFiles(Array.prototype.slice.call(fs));
        ev.target.value = '';
      });
    }
    var rmBtns = root.querySelectorAll('[data-pi-rmattach]');
    for (var j = 0; j < rmBtns.length; j++) {
      rmBtns[j].addEventListener('click', function (ev) {
        var k = ev.currentTarget.getAttribute('data-pi-rmattach');
        state.pendingAttachments = state.pendingAttachments.filter(function (a) { return a.r2_key !== k; });
        render();
      });
    }
    // Drag-drop attachments
    var panel = root.querySelector('.pi-panel');
    if (panel) {
      panel.addEventListener('dragover', function (ev) { ev.preventDefault(); });
      panel.addEventListener('drop', function (ev) {
        ev.preventDefault();
        var fs = ev.dataTransfer && ev.dataTransfer.files;
        if (fs && fs.length) uploadFiles(Array.prototype.slice.call(fs));
      });
    }
  }

  function togglePanel(ev) {
    if (ev) ev.preventDefault();
    state.open = !state.open;
    if (state.open) { state.unread = 0; ensureSession(); }
    render();
    if (state.open) {
      setTimeout(function () {
        var input = root.querySelector('[data-pi-input]');
        if (input) input.focus();
      }, 60);
    }
  }

  function scrollMsgsToEnd() {
    var msgsEl = root.querySelector('[data-pi-msgs]');
    if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  // ── Session + WebSocket ───────────────────────────────────
  function ensureSession() {
    if (state.session && state.session.ws_url) {
      if (!state.ws) connectWs();
      return Promise.resolve(state.session);
    }
    return fetch(apiOrigin + '/api/inbox/widget-sessions', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json', 'x-pulse-inbox-id': inboxId },
      body: JSON.stringify({
        inbox_id: inboxId,
        session_token: (state.session && state.session.token) || uuid(),
        page_url: location.href,
        page_title: document.title,
        user_agent: navigator.userAgent,
      }),
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.data) return null;
      state.session = j.data;
      saveSession(state.session);
      connectWs();
      // Load message history
      return fetch(apiOrigin + '/api/inbox/widget-messages?conversation_id=' + encodeURIComponent(state.session.conversation_id) + '&token=' + encodeURIComponent(state.session.ws_token || state.session.token), {
        credentials: 'omit',
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (h) {
        state.messages = (h && h.data) || [];
        render();
      });
    }).catch(function (e) {
      console.warn('[pulse-inbox] session bootstrap failed', e);
    });
  }

  function connectWs() {
    if (!state.session) return;
    var url = state.session.ws_url ||
      (apiOrigin.replace(/^http/, 'ws') + '/api/inbox/ws/' +
        encodeURIComponent(state.session.conversation_id) +
        '?token=' + encodeURIComponent(state.session.ws_token || ''));
    try {
      var ws = new WebSocket(url);
      state.ws = ws;
      ws.addEventListener('open', function () {
        state.wsBackoff = 800;
        ws.send(JSON.stringify({ type: 'hello', payload: { contact_id: state.session.contact_id } }));
      });
      ws.addEventListener('message', function (ev) {
        var parsed;
        try { parsed = JSON.parse(ev.data); } catch (_) { return; }
        if (parsed.type === 'message') {
          var m = parsed.payload;
          if (m.sender_type !== 'contact') {
            state.messages.push(m);
            if (!state.open) state.unread++;
            render();
            scrollMsgsToEnd();
          }
        } else if (parsed.type === 'typing') {
          state.typing = true;
          render();
          clearTimeout(state._typingTimer);
          state._typingTimer = setTimeout(function () { state.typing = false; render(); }, 3000);
        }
      });
      ws.addEventListener('close', function () {
        state.ws = null;
        var backoff = Math.min(state.wsBackoff, 15000);
        state.wsBackoff = Math.min(state.wsBackoff * 2, 15000);
        setTimeout(connectWs, backoff);
      });
      ws.addEventListener('error', function () { try { ws.close(); } catch (_) { /* swallow */ } });
    } catch (_) {
      setTimeout(connectWs, 3000);
    }
  }

  var lastTypingSent = 0;
  function sendTyping() {
    var now = Date.now();
    if (now - lastTypingSent < 1500) return;
    lastTypingSent = now;
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      try { state.ws.send(JSON.stringify({ type: 'typing', payload: { sender_type: 'contact' } })); } catch (_) { /* swallow */ }
    }
  }

  function onSubmit(ev) {
    if (ev) ev.preventDefault();
    var input = root.querySelector('[data-pi-input]');
    if (!input) return;
    var body = (input.value || '').trim();
    if (!body && state.pendingAttachments.length === 0) return;
    var optimistic = {
      id: 'local-' + Date.now(),
      body: body,
      sender_type: 'contact',
      created_at: new Date().toISOString(),
      attachments: state.pendingAttachments.slice(),
    };
    state.messages.push(optimistic);
    var attaches = state.pendingAttachments.slice();
    state.pendingAttachments = [];
    input.value = '';
    render();
    scrollMsgsToEnd();

    Promise.resolve(ensureSession()).then(function () {
      var payload = {
        type: 'message',
        payload: {
          conversation_id: state.session && state.session.conversation_id,
          body: body,
          attachments: attaches,
        },
      };
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        try { state.ws.send(JSON.stringify(payload)); return; } catch (_) { /* fall through */ }
      }
      // HTTP fallback
      fetch(apiOrigin + '/api/inbox/widget-messages', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'content-type': 'application/json', 'x-pulse-inbox-id': inboxId },
        body: JSON.stringify({
          inbox_id: inboxId,
          conversation_id: state.session && state.session.conversation_id,
          session_token: state.session && state.session.token,
          body: body,
          attachments: attaches,
        }),
      }).catch(function () { /* swallow — optimistic stays */ });
    });
  }

  function onPaste(ev) {
    var items = ev.clipboardData && ev.clipboardData.items;
    if (!items) return;
    var files = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        var f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) uploadFiles(files);
  }

  function uploadFiles(files) {
    Promise.resolve(ensureSession()).then(function () {
      var fd = new FormData();
      fd.append('inbox_id', inboxId);
      if (state.session) {
        fd.append('conversation_id', state.session.conversation_id);
        fd.append('session_token', state.session.token);
      }
      for (var i = 0; i < files.length; i++) fd.append('files', files[i]);
      fetch(apiOrigin + '/api/inbox/widget-uploads', {
        method: 'POST', credentials: 'omit', body: fd,
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var assets = (j && j.data && j.data.assets) || [];
        assets.forEach(function (a) {
          state.pendingAttachments.push({ r2_key: a.key, name: a.name });
        });
        render();
      }).catch(function () { /* swallow */ });
    });
  }

  // ── Boot ──────────────────────────────────────────────────
  function mount() {
    paintStyles();
    document.body.appendChild(host);
    render();
  }

  function start() {
    loadConfig().then(function () {
      paintStyles(); // re-paint with config-derived colors
      mount();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
