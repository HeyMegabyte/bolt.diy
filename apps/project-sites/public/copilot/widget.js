/* ProjectSites Multimodal Copilot Widget — site: __SITE_SLUG__ */
/* Served via /sites/:slug/copilot.js with __SITE_SLUG__ replaced at request time. */
(function () {
  'use strict';

  var SLUG = __SITE_SLUG__;
  var BASE = 'https://projectsites.dev';

  /* ── Styles ────────────────────────────────────────────────────── */
  var style = document.createElement('style');
  style.textContent = [
    '#ps-btn{position:fixed;bottom:24px;right:24px;z-index:99999;width:52px;height:52px;',
    'border-radius:50%;background:#00e5ff;border:none;cursor:pointer;',
    'box-shadow:0 4px 14px rgba(0,229,255,0.4);display:flex;align-items:center;',
    'justify-content:center;transition:transform .15s;}',
    '#ps-btn:hover{transform:scale(1.08);}',
    '#ps-panel{display:none;position:fixed;bottom:88px;right:24px;z-index:99999;width:320px;',
    'max-height:80vh;background:#0d0d20;border:1px solid rgba(0,229,255,0.2);',
    'border-radius:16px;padding:20px;color:#f4f4ff;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    'box-shadow:0 8px 32px rgba(0,0,0,0.4);overflow-y:auto;}',
    '#ps-panel h3{margin:0 0 12px;font-size:15px;font-weight:600;color:#00e5ff;}',
    '#ps-text{width:100%;box-sizing:border-box;background:rgba(255,255,255,0.05);',
    'border:1px solid rgba(0,229,255,0.15);border-radius:8px;padding:10px;',
    'color:#f4f4ff;font-size:14px;resize:none;outline:none;font-family:inherit;}',
    '#ps-text:focus{border-color:#00e5ff;}',
    '.ps-attach-row{display:flex;align-items:center;gap:8px;margin-top:10px;',
    'font-size:13px;color:#94a3b8;cursor:pointer;}',
    '#ps-send{margin-top:12px;width:100%;background:#00e5ff;color:#060610;border:none;',
    'border-radius:8px;padding:10px;font-weight:600;cursor:pointer;font-size:14px;',
    'transition:opacity .15s;}',
    '#ps-send:disabled{opacity:0.5;cursor:default;}',
    '#ps-result{margin-top:12px;font-size:13px;min-height:0;line-height:1.5;}',
  ].join('');
  document.head.appendChild(style);

  /* ── FAB button ─────────────────────────────────────────────────── */
  var btn = document.createElement('button');
  btn.id = 'ps-btn';
  btn.setAttribute('aria-label', 'Open AI assistant');
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#060610" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  document.body.appendChild(btn);

  /* ── Panel ──────────────────────────────────────────────────────── */
  var panel = document.createElement('div');
  panel.id = 'ps-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'AI assistant');
  panel.innerHTML = [
    '<h3>How can we help?</h3>',
    '<textarea id="ps-text" rows="3" placeholder="Describe what you need…" aria-label="Your message"></textarea>',
    '<label class="ps-attach-row" for="ps-img">',
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>',
    '<polyline points="21 15 16 10 5 21"/></svg>',
    'Attach a photo (optional)',
    '<input id="ps-img" type="file" accept="image/*" style="display:none;" aria-label="Attach image">',
    '</label>',
    '<button id="ps-send">Send</button>',
    '<div id="ps-result" aria-live="polite" aria-atomic="true"></div>',
  ].join('');
  document.body.appendChild(panel);

  var textarea = document.getElementById('ps-text');
  var imgInput = document.getElementById('ps-img');
  var sendBtn = document.getElementById('ps-send');
  var resultEl = document.getElementById('ps-result');

  /* ── Toggle ─────────────────────────────────────────────────────── */
  btn.addEventListener('click', function () {
    var open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    btn.setAttribute('aria-expanded', String(!open));
    if (!open) {
      requestAnimationFrame(function () { textarea.focus(); });
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.style.display !== 'none') {
      panel.style.display = 'none';
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  });

  /* ── Send ───────────────────────────────────────────────────────── */
  sendBtn.addEventListener('click', sendIntent);
  textarea.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') sendIntent();
  });

  function sendIntent() {
    var text = textarea.value.trim();
    var file = imgInput.files && imgInput.files[0];
    if (!text && !file) {
      resultEl.innerHTML = '<span style="color:#ef4444;">Please enter a message or attach a photo.</span>';
      return;
    }

    sendBtn.disabled = true;
    resultEl.innerHTML = '<span style="color:#00e5ff;">Analyzing…</span>';

    var fd = new FormData();
    if (text) fd.append('text', text);
    if (file) fd.append('image', file);

    fetch(BASE + '/api/sites/' + SLUG + '/copilot/intent', {
      method: 'POST',
      body: fd,
      headers: {
        'X-Visitor-Id': getVisitorId(),
        'X-Anon-Id': getAnonId(),
      },
    })
      .then(function (res) { return res.json().then(function (d) { return { ok: res.ok, data: d }; }); })
      .then(function (r) {
        sendBtn.disabled = false;
        if (!r.ok) {
          resultEl.innerHTML = '<span style="color:#ef4444;">Something went wrong. Please try again.</span>';
          return;
        }
        var d = r.data;
        var route = d.suggested_route && d.suggested_route !== '/' ? d.suggested_route : null;
        var msg = route
          ? 'It looks like you want to <strong>' + d.intent + '</strong>. <a href="' + route + '" style="color:#00e5ff;font-weight:600;">Continue →</a>'
          : 'Thanks! We received your request.';
        resultEl.innerHTML = '<span style="color:#22c55e;">✓ </span>' + msg;
        textarea.value = '';
        if (imgInput.files) imgInput.value = '';
      })
      .catch(function () {
        sendBtn.disabled = false;
        resultEl.innerHTML = '<span style="color:#ef4444;">Something went wrong. Please try again.</span>';
      });
  }

  /* ── Visitor ID helpers ─────────────────────────────────────────── */
  function getVisitorId() {
    try {
      var k = 'ps_vid';
      var v = localStorage.getItem(k);
      if (!v) { v = 'v_' + Math.random().toString(36).slice(2); localStorage.setItem(k, v); }
      return v;
    } catch (e) { return ''; }
  }

  function getAnonId() {
    try {
      var k = 'ps_anon';
      var v = sessionStorage.getItem(k);
      if (!v) { v = 'a_' + Math.random().toString(36).slice(2); sessionStorage.setItem(k, v); }
      return v;
    } catch (e) { return ''; }
  }
})();
