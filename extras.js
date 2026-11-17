/* Case Desk phone extras:
   1. Scan a forwarding letter: text recognition runs on the phone (Tesseract, English), then the
      memo no., RC/FIR, sections, seal, parcels and bearer are picked out for review.
   2. Voice typing: a microphone button that dictates into whichever field was last tapped. */
(function () {
  'use strict';

  /* ---------- small helpers ---------- */
  function note(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false; clearTimeout(note._t);
    note._t = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function mk(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  var css = document.createElement('style');
  css.textContent =
    '.scanrows{display:flex;flex-direction:column;gap:6px}' +
    '.scanrow{display:grid;grid-template-columns:auto minmax(0,9rem) minmax(0,1fr);gap:8px;align-items:center}' +
    '.scanrow input[type=checkbox]{accent-color:var(--accent);width:18px;height:18px;margin:0}' +
    '.scanrow label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}' +
    '.scanrow input[type=text]{width:100%;box-sizing:border-box}' +
    '@media (max-width:520px){.scanrow{grid-template-columns:auto minmax(0,1fr)}.scanrow input[type=text]{grid-column:1/-1}}' +
    '.scantext{white-space:pre-wrap;font-family:var(--f-mono);font-size:12px;max-height:220px;overflow:auto;background:var(--panel-2);border-radius:6px;padding:8px;margin:8px 0 0}' +
    '.micbtn{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:31;width:52px;height:52px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center;background:var(--accent);border-color:var(--accent);color:var(--accent-fg);box-shadow:var(--shadow)}' +
    '.micbtn svg{width:24px;height:24px}' +
    '.micbtn.on{background:var(--bad);border-color:var(--bad);color:#fff;animation:micpulse 1.2s ease-in-out infinite}' +
    '@keyframes micpulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--bad) 55%,transparent)}50%{box-shadow:0 0 0 10px color-mix(in srgb,var(--bad) 0%,transparent)}}' +
    '@media (prefers-reduced-motion:reduce){.micbtn.on{animation:none}}' +
    '.michint{position:fixed;right:calc(76px + env(safe-area-inset-right,0px));bottom:calc(92px + env(safe-area-inset-bottom,0px));z-index:31;max-width:min(60vw,320px);background:var(--fg);color:var(--bg);border-radius:8px;padding:7px 11px;font-size:13px}';
  document.head.appendChild(css);

  /* ---------- 1. scanning ---------- */
  var BASE = new URL('ocr/', location.href).href;
  var S = {};            // per case id: {status, progress, step, fields, text, error}
  var live = null;       // the box currently on screen
  var workerP = null, readingFor = null;

  function getWorker() {
    if (!workerP) {
      workerP = Tesseract.createWorker('eng', 1, {
        workerPath: BASE + 'worker.min.js', corePath: BASE, langPath: BASE.replace(/\/$/, ''),
        gzip: true, workerBlobURL: false,
        logger: function (m) {
          var st = readingFor && S[readingFor];
          if (st && st.status === 'reading' && m && typeof m.progress === 'number') {
            st.progress = m.progress; st.detail = m.status; draw();
          }
        }
      }).catch(function (e) { workerP = null; throw e; });
    }
    return workerP;
  }
  function loadImage(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () { res(im); setTimeout(function () { URL.revokeObjectURL(u); }, 1000); };
      im.onerror = function () { rej(new Error('That file is not a photo this phone can open')); };
      im.src = u;
    });
  }
  /* Scales the photo to a size the recogniser handles well and makes it greyscale. */
  function prep(im) {
    var max = 2400, w = im.naturalWidth, h = im.naturalHeight, s = Math.min(1, max / Math.max(w, h));
    if (Math.max(w, h) < 1400) s = 1400 / Math.max(w, h);
    var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    var g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height);
    var d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    for (var i = 0; i < p.length; i += 4) { var y = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = y; }
    g.putImageData(d, 0, 0);
    return c;
  }
  async function run(id, files) {
    var st = S[id] = { status: 'reading', progress: 0, step: 'Preparing the reader (first time takes a little longer)', fields: null, text: '' };
    draw();
    try {
      var w = await getWorker(), text = '';
      for (var i = 0; i < files.length; i++) {
        st.step = files.length > 1 ? 'Reading page ' + (i + 1) + ' of ' + files.length : 'Reading the letter';
        st.progress = 0; draw();
        var im = await loadImage(files[i]);
        readingFor = id;
        var r = await w.recognize(prep(im));
        text += (text ? '\n\n' : '') + r.data.text;
      }
      readingFor = null;
      st.text = text; st.fields = parse(text); st.status = 'review';
    } catch (e) {
      readingFor = null; st.status = 'error'; st.error = (e && e.message) || String(e);
    }
    draw();
  }

  /* ---------- reading the details out of the text ---------- */
  var WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
  var DATE = '(\\d{1,2}\\s*[.\\/-]\\s*\\d{1,2}\\s*[.\\/-]\\s*\\d{2,4})';
  function toNum(s) { s = String(s || '').toLowerCase().trim(); return /^\d+$/.test(s) ? Number(s) : (WORDNUM[s] || 0); }
  function dmy(s) {
    var m = /(\d{1,2})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{2,4})/.exec(s || ''); if (!m) return '';
    var y = m[3].length === 2 ? '20' + m[3] : m[3];
    return String(m[1]).padStart(2, '0') + '/' + String(m[2]).padStart(2, '0') + '/' + y;
  }
  function isoDate(s) {
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy(s)); if (!m) return null;
    var d = +m[1], mo = +m[2]; if (!d || d > 31 || !mo || mo > 12) return null;
    return m[3] + '-' + m[2] + '-' + m[1];
  }
  function tidy(s) { return String(s || '').replace(/\s+/g, ' ').replace(/^[\s:.,;\-–]+|[\s:.,;\-–]+$/g, '').trim(); }

  function parse(raw) {
    var t = raw.replace(/\r/g, '').replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[|]/g, '/');
    var flat = t.replace(/\s*\n\s*/g, ' ');
    var f = [];
    function add(key, label, value) { value = tidy(value); if (value && !f.some(function (x) { return x.key === key; })) f.push({ key: key, label: label, value: value, on: true }); }

    // Letter / memo number with its date: the first "No. … dated …" not belonging to an RC, FIR, diary or phone number
    var reNo = new RegExp('\\bNo\\.?\\s*[:\\-]?\\s*([A-Za-z0-9][A-Za-z0-9\\/\\-.()&, ]{2,80}?)\\s*,?\\s*(?:Dated|Dtd\\.?|Dt\\.?|Date)\\s*[:\\-.]?\\s*' + DATE, 'gi');
    var m;
    while ((m = reNo.exec(flat))) {
      var before = flat.slice(Math.max(0, m.index - 14), m.index);
      if (/(RC|R\.C\.|FIR|Crime|Case|Diary|Mob(ile)?|Tel|Phone|Fax|Report|Seal)\s*\.?\s*$/i.test(before)) continue;
      if (/^(RC|FIR)\b/i.test(m[1])) continue;
      add('memoNo', 'Memo / reference no.', m[1]); add('memoDate', 'Memo dated', dmy(m[2])); break;
    }
    // RC / FIR number and date
    // needs the word "No." so an RC number inside the memo number is not taken
    m = new RegExp('\\b(?:R\\.?\\s?C\\.?|FIR|Crime|Case)\\s*No\\.?\\s*[:\\-.]?\\s*([A-Z0-9][A-Z0-9\\/()\\-.]{2,30}[A-Z0-9)])(?:[^.\\n]{0,40}?(?:dated|dtd\\.?|dt\\.?|date)\\s*[:\\-.]?\\s*' + DATE + ')?', 'i').exec(flat);
    if (m) { add('rcNo', 'RC / FIR no.', m[1]); if (m[2]) add('rcDate', 'RC / FIR dated', dmy(m[2])); }
    else {
      var reRC = /\bRC\s?\d{6,}[A-Z]\d{3,}\b/g;
      while ((m = reRC.exec(flat))) { if (flat.charAt(m.index - 1) === '/') continue; add('rcNo', 'RC / FIR no.', m[0].replace(/\s/g, '')); break; }
    }
    // Sections
    m = /\bu\s*\/\s*s\.?\s*[:\-]?\s*([^\n]{3,160})/i.exec(t);
    if (m) add('us', 'Under section', m[1].split(/\s(?:dated|registered|against|in the matter|and forwarded)\b|\.\s+[A-Z]/i)[0].replace(/\s*[-–]+\s*reg\.?\s*$/i, ''));
    // Bearer
    m = /(?:through|by hand of|bearer|carried by|handed over to)\s*[:,\-]?\s*((?:Insp(?:ector)?|S\.?I\.?|A\.?S\.?I\.?|H\.?C\.?|Ct\.?|Constable|Sh(?:ri)?\.?|Smt\.?|Dy\.?\s*S\.?P\.?|D\.?S\.?P\.?|S\.?H\.?O\.?|I\.?O\.?)\.?\s+[A-Z][A-Za-z.\s]{1,40}?(?:\s*[,\-–]\s*(?:No\.?\s*)?\d{3,7})?)(?=\s*[,.;\n(]|\s+(?:who|is|of|for|along|with|bearing|Mob)\b)/i.exec(t);
    if (m) add('through', 'Received through', m[1]);
    // CFSL diary number (stamped on the letter)
    m = /Diary\s*No\.?\s*[:\-.]?\s*(\d{1,7})/i.exec(flat); if (m) add('diaryNo', 'CFSL diary no.', m[1]);
    // Parcels, seals
    m = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:\(\s*\d{1,2}\s*\)\s*)?(?:sealed\s+|nos?\.?\s+(?:of\s+)?)?(?:parcels?|packets?|envelopes?|pullandas?)\b/i.exec(flat);
    if (m && toNum(m[1])) add('parcelCount', 'Number of parcels', String(toNum(m[1])));
    m = /seal\s+impressions?\s+(?:of\s+)?[:\-]?\s*['"]([^'"\n]{2,30})['"]/i.exec(flat)
      || /(?:with|bearing)\s+(?:the\s+)?seals?\s+(?:of\s+)?['"]([^'"\n]{2,30})['"]/i.exec(flat)
      || /seal\s+impressions?\s+(?:of\s+)?[:\-]?\s*([A-Z][A-Z0-9 \-]{1,20}[A-Z0-9])\b/.exec(flat);
    if (m) add('sealText', 'Seal impression reads', m[1]);
    m = /sealed\s+(?:at|with)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:\(\s*\d+\s*\))?\s*(?:places|seals)/i.exec(flat);
    if (m && toNum(m[1])) add('seals', 'Seals on each parcel', String(toNum(m[1])));
    // Labels written on the parcels, in order
    // "marked 'A' and 'B'" / "labelled as 'A', 'B' & 'C'"
    var reL = /(?:marked|labell?ed)\s+(?:as\s+)?((?:['"][^'"\n]{2,50}['"]\s*(?:,|and|&)?\s*)+)/gi, n = 0, q, reQ;
    while ((m = reL.exec(flat)) && n < 12) {
      reQ = /['"]([^'"\n]{2,50})['"]/g;
      while ((q = reQ.exec(m[1])) && n < 12) {
        if (/^parcel[\s\-]*\d+$/i.test(q[1].trim())) continue;
        n++; add('label' + n, 'Parcel-' + n + ' label', q[1]);
      }
    }
    return f;
  }

  function applyFields(ctx, fields) {
    var d = ctx.docs(), patch = {}, ps = (d.parcels || []).map(function (p) { return Object.assign({}, p); }), touched = false, count = 0;
    function on(k) { var x = fields.find(function (y) { return y.key === k; }); return x && x.on && tidy(x.value) ? tidy(x.value) : null; }
    function newParcel() { return { colour: 'Yellow', container: 'paper envelope', items: [] }; }
    ['memoNo', 'rcNo', 'us', 'through', 'diaryNo'].forEach(function (k) { var v = on(k); if (v) { patch[k] = v; count++; } });
    ['memoDate', 'rcDate'].forEach(function (k) { var v = on(k); var iso = v && isoDate(v); if (iso) { patch[k] = iso; count++; } });
    var pc = toNum(on('parcelCount'));
    if (pc) { while (ps.length < pc) ps.push(newParcel()); touched = true; count++; }
    fields.forEach(function (x) {
      var mm = /^label(\d+)$/.exec(x.key); if (!mm || !x.on || !tidy(x.value)) return;
      var i = Number(mm[1]) - 1; while (ps.length <= i) ps.push(newParcel());
      ps[i].label = tidy(x.value); touched = true; count++;
    });
    var seal = on('sealText'), seals = on('seals');
    if ((seal || seals) && !ps.length) ps.push(newParcel());
    if (seal) { ps.forEach(function (p) { p.sealText = seal; }); touched = true; count++; }
    if (seals) { ps.forEach(function (p) { p.seals = String(toNum(seals) || seals); }); touched = true; count++; }
    if (touched) patch.parcels = ps;
    if (!count) { note('Nothing selected to fill'); return; }
    ctx.apply(patch, 'Filled ' + count + ' details from a scanned letter');
    S[ctx.id] = null;
    note(count + ' detail' + (count > 1 ? 's' : '') + ' filled. Check them below.');
  }

  function draw() { if (live && document.contains(live.box)) render(live.box, live.ctx); }

  function render(box, ctx) {
    live = { box: box, ctx: ctx };
    var st = S[ctx.id];
    box.replaceChildren();
    box.append(mk('h2', '', 'Scan the forwarding letter'),
      mk('p', 'sub', 'Photograph the letter that came with the parcels, one photo per page, flat and well lit. The phone reads it without internet and suggests the memo no., RC/FIR, sections, seal, parcels and bearer. Check every value against the letter before filling.'));
    var row = mk('div', 'rowbtns');
    function picker(label, primary, capture, multiple, id) {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true; inp.id = id;
      if (capture) inp.setAttribute('capture', 'environment'); if (multiple) inp.multiple = true;
      inp.onchange = function () { var fs = Array.prototype.slice.call(inp.files || []); inp.value = ''; if (fs.length) run(ctx.id, fs); };
      var b = mk('button', primary ? 'primary' : '', label); b.type = 'button';
      b.disabled = !ctx.canWrite || (st && st.status === 'reading');
      b.onclick = function () { inp.click(); };
      row.append(b, inp);
    }
    picker('Take photo', true, true, false, 'scn-cam');
    picker('Choose photos', false, false, true, 'scn-pick');
    box.append(row);

    if (st && st.status === 'reading') {
      var pct = Math.round((st.progress || 0) * 100);
      box.append(mk('p', 'sub', st.step + (pct ? ' · ' + pct + '%' : '')));
      var pr = mk('div', 'prog'), bar = mk('i'); bar.style.width = Math.max(3, pct) + '%'; pr.append(bar); box.append(pr);
    }
    if (st && st.status === 'error') {
      box.append(mk('p', 'banner', 'The letter could not be read: ' + st.error + '. Try again, or fill the fields by hand.'));
    }
    if (st && st.status === 'review') {
      var fields = st.fields || [];
      if (!fields.length) {
        box.append(mk('p', 'banner', 'No details were recognised. Try a sharper photo taken straight on in good light, or fill the fields by hand.'));
      } else {
        box.append(mk('p', 'minihead', 'Found in the letter: untick anything wrong, correct the rest'));
        var g = mk('div', 'scanrows');
        fields.forEach(function (x, i) {
          var r = mk('div', 'scanrow');
          var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'scn-c-' + i; cb.checked = !!x.on;
          cb.onchange = function () { x.on = cb.checked; };
          var lb = mk('label', '', x.label); lb.htmlFor = 'scn-v-' + i;
          var v = document.createElement('input'); v.type = 'text'; v.id = 'scn-v-' + i; v.value = x.value;
          v.oninput = function () { x.value = v.value; };
          r.append(cb, lb, v); g.append(r);
        });
        box.append(g);
      }
      var acts = mk('div', 'rowbtns');
      if (fields.length) { var ap = mk('button', 'primary', 'Fill selected fields'); ap.type = 'button'; ap.disabled = !ctx.canWrite; ap.onclick = function () { applyFields(ctx, fields); }; acts.append(ap); }
      var ds = mk('button', 'ghost', 'Discard'); ds.type = 'button'; ds.onclick = function () { S[ctx.id] = null; draw(); }; acts.append(ds);
      box.append(acts);
      if (st.text) {
        var det = mk('details'); det.append(mk('summary', 'muted', 'Show the recognised text'));
        det.append(mk('pre', 'scantext', st.text)); box.append(det);
      }
    }
  }
  if (!window.CASEDESK_NO_SCAN) window.CASEDESK_SCAN = render;
  window.__cdParse = location.hostname === 'localhost' ? parse : undefined;

  /* ---------- 2. voice typing ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var FIELD = 'input[type=text],input[type=search],input:not([type]),textarea';
  var lastId = null, lastEl = null, rec = null;
  var mic = mk('button', 'micbtn'); mic.type = 'button'; mic.id = 'micBtn'; mic.hidden = true;
  mic.setAttribute('aria-label', 'Voice typing into the selected field');
  mic.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
  var hint = mk('div', 'michint'); hint.hidden = true;
  document.body.append(mic, hint);

  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t && t.matches && t.matches(FIELD) && !t.disabled && !t.readOnly && t.id !== 'q') {
      lastEl = t; lastId = t.id || null; mic.hidden = false;
    }
  });
  function target() {
    if (lastId) { var e = document.getElementById(lastId); if (e) return e; }
    return lastEl && document.contains(lastEl) ? lastEl : null;
  }
  function fieldName(el) { var l = el.closest('label'); return l ? (l.firstChild && l.firstChild.textContent || '').trim() : ''; }
  function spoken(s) {
    return s.replace(/\s+(?:slash|forward slash)\s+/gi, '/').replace(/\s+(?:dash|hyphen)\s+/gi, '-')
      .replace(/\b(?:full stop|period)\b/gi, '.').replace(/\bcomma\b/gi, ',').replace(/\s+([.,])/g, '$1').replace(/\s+/g, ' ').trim();
  }
  function stopUI() { mic.classList.remove('on'); hint.hidden = true; }
  // keep the keyboard focus on the field while the button is pressed
  mic.addEventListener('pointerdown', function (e) { e.preventDefault(); });
  mic.addEventListener('mousedown', function (e) { e.preventDefault(); });
  mic.onclick = function () {
    if (rec) { rec.stop(); return; }
    var el = target();
    if (!el) { note('Tap a field first, then the microphone.'); return; }
    if (!SR) { note('Voice typing is not available in this view. Tap the microphone on the iPhone keyboard to dictate instead.'); return; }
    var finalTxt = '';
    rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalTxt += ev.results[i][0].transcript; else interim += ev.results[i][0].transcript;
      }
      hint.textContent = (finalTxt + ' ' + interim).trim() || 'Listening…';
    };
    rec.onerror = function (ev) {
      var e2 = ev && ev.error;
      if (e2 === 'no-speech' || e2 === 'aborted') return;
      note(e2 === 'not-allowed' || e2 === 'service-not-allowed'
        ? 'Microphone access was refused. Allow it in Settings, or use the microphone on the keyboard.'
        : e2 === 'network'
          ? 'Voice typing needs internet here. The microphone on the iPhone keyboard can dictate offline instead.'
          : 'Voice typing stopped (' + e2 + ').');
    };
    rec.onend = function () {
      rec = null; stopUI();
      var txt = spoken(finalTxt); if (!txt) return;
      var f = target(); if (!f) return;
      var v = f.value || '';
      f.value = v && !/\s$/.test(v) ? v + ' ' + txt : v + txt;
      f.dispatchEvent(new Event('input', { bubbles: true }));
      f.dispatchEvent(new Event('change', { bubbles: true }));
      var again = target(); if (again) again.focus({ preventScroll: true });
    };
    try {
      rec.start(); mic.classList.add('on');
      var nm = fieldName(el); hint.textContent = 'Listening' + (nm ? ' for ' + nm.toLowerCase() : '') + '…'; hint.hidden = false;
    } catch (e) { rec = null; stopUI(); note('Could not start voice typing.'); }
  };
})();
