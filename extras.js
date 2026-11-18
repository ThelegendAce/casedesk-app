/* Case Desk phone extras:
   1. Photos read on the phone (Tesseract, English, offline):
      - forwarding letter: memo no., date, RC/FIR, CFSL diary no., U/S
      - case acceptance: messenger name and belt number
      - device label / SIM card: make, model, model no., serial no., IMEI 1, IMEI 2, ICCID
      Every photo is kept with the case, so it can be opened and read by eye if recognition fails.
   2. Voice typing: a microphone button that dictates into whichever field was last tapped. */
(function () {
  'use strict';

  function note(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false; clearTimeout(note._t);
    note._t = setTimeout(function () { t.hidden = true; }, 3400);
  }
  function mk(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  var css = document.createElement('style');
  css.textContent =
    '.scanrows{display:flex;flex-direction:column;gap:6px}' +
    '.scanrow{display:grid;grid-template-columns:auto minmax(0,10rem) minmax(0,1fr);gap:8px;align-items:center}' +
    '.scanrow input[type=checkbox]{accent-color:var(--accent);width:18px;height:18px;margin:0}' +
    '.scanrow label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}' +
    '.scanrow input[type=text]{width:100%;box-sizing:border-box}' +
    '@media (max-width:520px){.scanrow{grid-template-columns:auto minmax(0,1fr)}.scanrow input[type=text]{grid-column:1/-1}}' +
    '.scantext{white-space:pre-wrap;font-family:var(--f-mono);font-size:12px;max-height:220px;overflow:auto;background:var(--panel-2);border-radius:6px;padding:8px;margin:8px 0 0}' +
    '.photostrip{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
    '.photostrip .ph{position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid var(--line);padding:0;background:var(--panel-2)}' +
    '.photostrip .ph img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.photostrip .ph small{position:absolute;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);color:#fff;font-size:10px;padding:1px 3px;text-align:center}' +
    '.labelscan{border:1px dashed var(--line);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}' +
    '.phview{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.88);display:flex;flex-direction:column;padding:calc(12px + env(safe-area-inset-top,0px)) 12px calc(12px + env(safe-area-inset-bottom,0px))}' +
    '.phview .bar{display:flex;gap:8px;justify-content:flex-end;margin-bottom:8px}' +
    '.phview .img{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;display:flex;align-items:flex-start;justify-content:center}' +
    '.phview img{max-width:none;width:100%;height:auto}' +
    '.phview.zoom img{width:220%}' +
    '.micbtn{position:fixed;right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:31;width:52px;height:52px;border-radius:50%;padding:0;display:flex;align-items:center;justify-content:center;background:var(--accent);border-color:var(--accent);color:var(--accent-fg);box-shadow:var(--shadow)}' +
    '.micbtn svg{width:24px;height:24px}' +
    '.micbtn.on{background:var(--bad);border-color:var(--bad);color:#fff;animation:micpulse 1.2s ease-in-out infinite}' +
    '@keyframes micpulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--bad) 55%,transparent)}50%{box-shadow:0 0 0 10px color-mix(in srgb,var(--bad) 0%,transparent)}}' +
    '@media (prefers-reduced-motion:reduce){.micbtn.on{animation:none}}' +
    '.michint{position:fixed;right:calc(76px + env(safe-area-inset-right,0px));bottom:calc(92px + env(safe-area-inset-bottom,0px));z-index:31;max-width:min(60vw,320px);background:var(--fg);color:var(--bg);border-radius:8px;padding:7px 11px;font-size:13px}';
  document.head.appendChild(css);

  /* ---------- photos kept on the phone ---------- */
  function pdb(mode, fn) {
    return new Promise(function (resolve, reject) {
      var o = indexedDB.open('casedesk-photos', 1);
      o.onupgradeneeded = function () { o.result.createObjectStore('p'); };
      o.onerror = function () { reject(o.error); };
      o.onsuccess = function () {
        var tx = o.result.transaction('p', mode), rq = fn(tx.objectStore('p'));
        tx.oncomplete = function () { resolve(rq && rq.result); o.result.close(); };
        tx.onerror = function () { reject(tx.error); };
      };
    });
  }
  function range(owner) { return IDBKeyRange.bound(owner + '|', owner + '|￿'); }
  var PH = {};   // owner -> [{key, kind, at, url}]
  async function loadPhotos(owner) {
    try {
      var keys = await pdb('readonly', function (s) { return s.getAllKeys(range(owner)); }) || [];
      var vals = await pdb('readonly', function (s) { return s.getAll(range(owner)); }) || [];
      (PH[owner] || []).forEach(function (p) { URL.revokeObjectURL(p.url); });
      PH[owner] = vals.map(function (v, i) { return { key: keys[i], kind: v.kind, at: v.at, blob: v.blob, url: URL.createObjectURL(v.blob) }; });
    } catch (e) { PH[owner] = []; }
    redrawAll();
  }
  async function savePhoto(owner, kind, blob) {
    var at = new Date().toISOString();
    try { await pdb('readwrite', function (s) { return s.put({ kind: kind, at: at, blob: blob }, owner + '|' + at); }); } catch (e) { note('Could not keep the photo: storage is full or blocked'); }
  }
  async function deletePhoto(owner, key) {
    try { await pdb('readwrite', function (s) { return s.delete(key); }); } catch (e) {}
    await loadPhotos(owner);
  }
  function viewPhoto(owner, p) {
    var v = mk('div', 'phview'), bar = mk('div', 'bar'), box = mk('div', 'img'), img = document.createElement('img');
    img.src = p.url; img.alt = 'Saved photo';
    var zb = mk('button', '', 'Zoom'); zb.type = 'button'; zb.onclick = function () { v.classList.toggle('zoom'); zb.textContent = v.classList.contains('zoom') ? 'Fit' : 'Zoom'; };
    var del = mk('button', 'ghost', 'Delete photo'); del.type = 'button'; del.style.color = '#fff';
    del.onclick = function () { if (del.dataset.sure) { v.remove(); deletePhoto(owner, p.key); } else { del.dataset.sure = '1'; del.textContent = 'Tap again to delete'; } };
    var cl = mk('button', 'primary', 'Close'); cl.type = 'button'; cl.onclick = function () { v.remove(); };
    bar.append(del, zb, cl); box.append(img); v.append(bar, box); document.body.append(v);
  }
  var KINDNAME = { letter: 'Letter', accept: 'Accept.', label: 'Label', photo: 'Photo' };
  function photoStrip(owner) {
    var wrap = mk('div', 'photostrip'), list = PH[owner];
    if (!list) { loadPhotos(owner); return wrap; }
    list.forEach(function (p) {
      var b = mk('button', 'ph'); b.type = 'button'; b.title = 'Open photo';
      var im = document.createElement('img'); im.src = p.url; im.alt = '';
      b.append(im, mk('small', '', KINDNAME[p.kind] || 'Photo')); b.onclick = function () { viewPhoto(owner, p); };
      wrap.append(b);
    });
    return wrap;
  }

  /* ---------- reading photos ---------- */
  var BASE = new URL('ocr/', location.href).href;
  var S = {};          // owner -> {status, kind, progress, step, fields, text, error}
  var live = {};       // owner -> function that redraws its box if still on screen
  var workerP = null, readingFor = null;
  function redraw(owner) { var f = live[owner]; if (f) f(); }
  function redrawAll() { Object.keys(live).forEach(redraw); }

  function getWorker() {
    if (!workerP) {
      workerP = Tesseract.createWorker('eng', 1, {
        workerPath: BASE + 'worker.min.js', corePath: BASE, langPath: BASE.replace(/\/$/, ''),
        gzip: true, workerBlobURL: false,
        logger: function (m) {
          var st = readingFor && S[readingFor];
          if (st && st.status === 'reading' && m && typeof m.progress === 'number') { st.progress = m.progress; redraw(readingFor); }
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
  function canvasOf(im, max, grey) {
    var w = im.naturalWidth, h = im.naturalHeight, s = Math.min(1, max / Math.max(w, h));
    if (grey && Math.max(w, h) < 1400) s = 1400 / Math.max(w, h);
    var c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
    var g = c.getContext('2d'); g.drawImage(im, 0, 0, c.width, c.height);
    if (grey) {
      var d = g.getImageData(0, 0, c.width, c.height), p = d.data;
      for (var i = 0; i < p.length; i += 4) { var y = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = p[i + 1] = p[i + 2] = y; }
      g.putImageData(d, 0, 0);
    }
    return c;
  }
  function toJpeg(c) { return new Promise(function (r) { c.toBlob(function (b) { r(b); }, 'image/jpeg', 0.78); }); }

  /* kind: 'letter' | 'accept' | 'label' | 'photo' (keep only) */
  async function run(owner, kind, files, opts) {
    var st = S[owner] = { status: kind === 'photo' ? 'saving' : 'reading', kind: kind, progress: 0, step: 'Preparing', fields: null, text: '' };
    redraw(owner);
    try {
      var text = '', w = kind === 'photo' ? null : await getWorker();
      for (var i = 0; i < files.length; i++) {
        st.step = files.length > 1 ? 'Photo ' + (i + 1) + ' of ' + files.length : (kind === 'photo' ? 'Saving the photo' : 'Reading the photo');
        st.progress = 0; redraw(owner);
        var im = await loadImage(files[i]);
        await savePhoto(owner, kind, await toJpeg(canvasOf(im, 1800, false)));
        if (w) { readingFor = owner; var r = await w.recognize(canvasOf(im, 2400, true)); text += (text ? '\n\n' : '') + r.data.text; }
      }
      readingFor = null;
      if (kind === 'photo') { S[owner] = null; note('Photo kept with this case'); }
      else {
        st.text = text;
        st.fields = kind === 'letter' ? parseLetter(text) : kind === 'accept' ? parseAcceptance(text) : parseLabel(text, opts && opts.type);
        st.status = 'review';
      }
    } catch (e) { readingFor = null; st.status = 'error'; st.error = (e && e.message) || String(e); }
    await loadPhotos(owner);
  }

  /* ---------- picking details out of the text ---------- */
  var DATE = '(\\d{1,2}\\s*[.\\/-]\\s*\\d{1,2}\\s*[.\\/-]\\s*\\d{2,4})';
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
  function clean(raw) { return raw.replace(/\r/g, '').replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[|]/g, '/'); }
  function adder(f) { return function (key, label, value) { value = tidy(value); if (value && !f.some(function (x) { return x.key === key; })) f.push({ key: key, label: label, value: value, on: true }); }; }
  var NOT_MEMO = /(RC|R\.C\.|FIR|Crime|Case|Diary|D\.|Mob(ile)?|Tel|Phone|Fax|Report|Seal|Belt|Pin|PIN|IMEI|Serial)\s*\.?\s*$/i;

  function parseLetter(raw) {
    var t = clean(raw), flat = t.replace(/\s*\n\s*/g, ' '), f = [], add = adder(f), m;
    // Forwarding memo no.: the longest "No. …" reference (usually partly handwritten)
    var reNo = /\bNo\.?\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\/\-.()&]{3,80}(?:\s?\/\s?[A-Za-z0-9\-.()&]{1,40})*)/gi, best = '';
    while ((m = reNo.exec(flat))) {
      if (NOT_MEMO.test(flat.slice(Math.max(0, m.index - 12), m.index))) continue;
      var v = m[1].replace(/\s+/g, '').replace(/[.,]+$/, '');
      if (/^(RC|FIR)/i.test(v) || (v.match(/\d/g) || []).length < 3) continue;
      if (v.length > best.length) best = v;
    }
    if (!best) { (flat.match(/\b[A-Za-z0-9]*\d[A-Za-z0-9\-.]*(?:\/[A-Za-z0-9\-.()]+){2,}\b/g) || []).forEach(function (v) { if ((v.match(/\d/g) || []).length >= 4 && v.length > best.length && !/^RC/i.test(v)) best = v; }); }
    if (best) add('memoNo', 'Forwarding memo no.', best);
    // Date: the date written at the top of the letter
    var lines = t.split('\n').filter(function (l) { return l.trim(); }), topN = Math.max(8, Math.ceil(lines.length * 0.3)), dt = null, re1 = new RegExp(DATE);
    for (var i = 0; i < Math.min(topN, lines.length) && !dt; i++) { var dm = re1.exec(lines[i]); if (dm) dt = dm[1]; }
    if (!dt) { var dm2 = new RegExp('(?:Dated|Dtd\\.?|Dt\\.?|Date)\\s*[:\\-.]?\\s*' + DATE, 'i').exec(flat); if (dm2) dt = dm2[1]; }
    if (dt) add('memoDate', 'Memo date', dmy(dt));
    // RC / FIR no. and date
    m = new RegExp('\\b(?:R\\.?\\s?C\\.?|FIR|Crime|Case)\\s*No\\.?\\s*[:\\-.]?\\s*([A-Z0-9][A-Z0-9\\/()\\-.]{2,30}[A-Z0-9)])(?:[^.\\n]{0,40}?(?:dated|dtd\\.?|dt\\.?|date)\\s*[:\\-.]?\\s*' + DATE + ')?', 'i').exec(flat);
    if (m) { add('rcNo', 'RC No. / FIR', m[1]); if (m[2]) add('rcDate', 'RC / FIR dated', dmy(m[2])); }
    else { var reRC = /\bRC\s?\d{6,}[A-Z]\d{3,}\b/g; while ((m = reRC.exec(flat))) { if (flat.charAt(m.index - 1) === '/') continue; add('rcNo', 'RC No. / FIR', m[0].replace(/\s/g, '')); break; } }
    // CFSL diary no. (stamped on the letter)
    m = /(?:Diary|Dy\.?|D\.)\s*No\.?\s*[:\-.]?\s*(\d[\d\/\-]{0,15})/i.exec(flat); if (m) add('diaryNo', 'Diary no. CFSL', m[1]);
    // Sections
    m = /\bu\s*\/\s*s\.?\s*[:\-]?\s*([^\n]{3,160})/i.exec(t);
    if (m) add('us', 'U/S', m[1].split(/\s(?:dated|registered|against|in the matter|and forwarded)\b|\.\s+[A-Z]/i)[0].replace(/\s*[-–]+\s*reg\.?\s*$/i, ''));
    return f;
  }

  var RANK = '(?:Insp(?:ector)?|S\\.?\\s?I\\.?|A\\.?\\s?S\\.?\\s?I\\.?|H\\.?\\s?C\\.?|Head\\s+Constable|Ct\\.?|Constable|Sh(?:ri)?\\.?|Smt\\.?|Dy\\.?\\s*S\\.?P\\.?|D\\.?S\\.?P\\.?|S\\.?H\\.?O\\.?|I\\.?O\\.?)';
  function parseAcceptance(raw) {
    var t = clean(raw), flat = t.replace(/\s*\n\s*/g, ' '), f = [], add = adder(f), m;
    m = new RegExp('(?:Name\\s+of\\s+(?:the\\s+)?(?:messenger|bearer|official|officer|person)|Messenger(?:\\s+name)?|Bearer(?:\\s+name)?|Name|Received\\s+from|Deposited\\s+by|Submitted\\s+by|Brought\\s+by|through)\\s*[:.\\-]?\\s*(' + RANK + '?\\.?\\s*[A-Z][A-Za-z.]+(?:\\s+[A-Z][A-Za-z.]+){0,3})', 'i').exec(t)
      || new RegExp('(' + RANK + '\\.?\\s+[A-Z][A-Za-z.]+(?:\\s+[A-Z][A-Za-z.]+){0,3})').exec(t);
    if (m) add('messenger', 'Messenger name', m[1].replace(/\s+(?:Belt|No|Rank|Designation)\b.*$/i, ''));
    m = /Belt\s*(?:No\.?|Number|#)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\/\-]{1,12})/i.exec(flat)
      || new RegExp(RANK + '\\.?\\s+[A-Z][A-Za-z.\\s]{1,40}?[,\\-–]\\s*(?:No\\.?\\s*)?(\\d{3,7})\\b').exec(flat);
    if (m) add('beltNo', 'Belt no.', m[1]);
    return f;
  }

  var BRANDS = [['samsung', 'Samsung'], ['apple', 'Apple'], ['iphone', 'Apple'], ['realme', 'Realme'], ['xiaomi', 'Xiaomi'], ['redmi', 'Xiaomi'], ['poco', 'Xiaomi'], ['vivo', 'Vivo'], ['oppo', 'Oppo'], ['oneplus', 'OnePlus'], ['motorola', 'Motorola'], ['nokia', 'Nokia'], ['infinix', 'Infinix'], ['tecno', 'Tecno'], ['itel', 'itel'], ['lava', 'Lava'], ['micromax', 'Micromax'], ['google', 'Google'], ['honor', 'Honor'], ['huawei', 'Huawei'], ['asus', 'Asus'], ['lenovo', 'Lenovo'], ['sandisk', 'SanDisk'], ['kingston', 'Kingston'], ['seagate', 'Seagate'], ['western digital', 'Western Digital'], ['toshiba', 'Toshiba'], ['transcend', 'Transcend'], ['strontium', 'Strontium'], ['lexar', 'Lexar'], ['dell', 'Dell'], ['acer', 'Acer'], ['hp ', 'HP'], ['simmtronics', 'Simmtronics'], ['hikvision', 'Hikvision'], ['cp plus', 'CP Plus'], ['dahua', 'Dahua']];
  var CARRIERS = [['jio', 'Jio'], ['airtel', 'Airtel'], ['bsnl', 'BSNL'], ['vodafone', 'Vodafone'], ['vi ', 'Vi (Vodafone Idea)'], ['idea', 'Idea'], ['mtnl', 'MTNL'], ['docomo', 'Tata Docomo'], ['aircel', 'Aircel'], ['uninor', 'Telenor (Uninor)'], ['telenor', 'Telenor (Uninor)']];
  function luhn(s) { var sum = 0; for (var i = 0; i < s.length; i++) { var d = +s.charAt(s.length - 1 - i); if (i % 2) { d *= 2; if (d > 9) d -= 9; } sum += d; } return sum % 10 === 0; }
  function parseLabel(raw, type) {
    var t = clean(raw), low = ' ' + t.toLowerCase().replace(/\s+/g, ' ') + ' ', f = [], add = adder(f), m;
    var joined = t.replace(/(\d)[ \t]+(?=\d)/g, '$1');               // "8991 0009 …" -> one number
    // ICCID: 19-20 digits starting 89
    m = /\b(89\d{17,18}[0-9F]?)\b/i.exec(joined); var iccid = m ? m[1].toUpperCase() : null;
    if (iccid) add('iccid', 'ICCID', iccid);
    if (type === 'sim') {
      for (var c = 0; c < CARRIERS.length; c++) if (low.indexOf(CARRIERS[c][0]) >= 0) { add('vendor', 'Vendor', CARRIERS[c][1] + (/\b4g\b/.test(low) ? ' 4G' : /\b5g\b/.test(low) ? ' 5G' : '')); break; }
      return f;
    }
    for (var b = 0; b < BRANDS.length; b++) if (low.indexOf(BRANDS[b][0]) >= 0) { add('make', 'Make', BRANDS[b][1]); break; }
    m = /Model\s*Name\s*[:#.]?\s*([^\n]{2,30})/i.exec(t); if (m) add('model', 'Model name', m[1]);
    m = /Model\s*(?:No\.?|Number|Code)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/]{2,20})/i.exec(t)
      || /\b(SM-[A-Z0-9]+(?:\/[A-Z]+)?|RMX\d{4}|CPH\d{4}|V\d{4}|A\d{4}|M\d{4}[A-Z0-9]{3,}|XT\d{4}(?:-\d)?|TA-\d{4})\b/.exec(t);
    if (m && !/^name$/i.test(m[1])) add('modelNo', 'Model no.', m[1]);
    // IMEI numbers: 15 digits, labelled or bare; kept apart from the serial number
    var imeis = [], reI = /IMEI\s*(?:No\.?)?\s*(?:[12]|\(?slot\s*[12]\)?)?\s*[:#.]?\s*((?:\d[\s\/-]?){14}\d)/gi;
    while ((m = reI.exec(t))) { var d = m[1].replace(/\D/g, ''); if (d.length === 15 && imeis.indexOf(d) < 0) imeis.push(d); }
    (joined.match(/\b\d{15}\b/g) || []).forEach(function (d) { if (imeis.indexOf(d) < 0 && (!iccid || iccid.indexOf(d) < 0) && luhn(d)) imeis.push(d); });
    if (imeis[0]) add('imei1', 'IMEI 1', imeis[0]);
    if (imeis[1]) add('imei2', 'IMEI 2', imeis[1]);
    // Serial number: labelled S/N, never one of the IMEIs
    var reS = /(?:S\/N|SN|Serial\s*(?:No\.?|Number)?)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-]{5,24})/gi;
    while ((m = reS.exec(t))) { var sv = m[1].toUpperCase(); if (imeis.indexOf(sv) >= 0 || sv === iccid) continue; add('serial', 'Serial no.', sv); break; }
    return f;
  }

  /* ---------- shared review block ---------- */
  function reviewBlock(owner, onApply, canWrite) {
    var st = S[owner], box = mk('div'); box.style.display = 'flex'; box.style.flexDirection = 'column'; box.style.gap = '8px';
    if (!st) return box;
    if (st.status === 'reading' || st.status === 'saving') {
      var pct = Math.round((st.progress || 0) * 100);
      box.append(mk('p', 'sub', st.step + (pct ? ' · ' + pct + '%' : '')));
      var pr = mk('div', 'prog'), bar = mk('i'); bar.style.width = Math.max(3, pct) + '%'; pr.append(bar); box.append(pr);
    }
    if (st.status === 'error') box.append(mk('p', 'banner', 'The photo could not be read: ' + st.error + '. It is kept below; open it and fill the fields by hand.'));
    if (st.status === 'review') {
      var fields = st.fields || [];
      if (!fields.length) box.append(mk('p', 'banner', 'Nothing was recognised. The photo is kept below: open it, zoom in, and fill the fields by hand, or try a sharper photo taken straight on.'));
      else {
        box.append(mk('p', 'minihead', 'Found in the photo: untick anything wrong, correct the rest'));
        var g = mk('div', 'scanrows');
        fields.forEach(function (x, i) {
          var r = mk('div', 'scanrow'), id = owner.replace(/\W/g, '') + '-' + i;
          var cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'scn-c-' + id; cb.checked = !!x.on; cb.onchange = function () { x.on = cb.checked; };
          var lb = mk('label', '', x.label); lb.htmlFor = 'scn-v-' + id;
          var v = document.createElement('input'); v.type = 'text'; v.id = 'scn-v-' + id; v.value = x.value; v.oninput = function () { x.value = v.value; };
          r.append(cb, lb, v); g.append(r);
        });
        box.append(g);
      }
      var acts = mk('div', 'rowbtns');
      if (fields.length) { var ap = mk('button', 'primary', 'Fill selected fields'); ap.type = 'button'; ap.disabled = !canWrite; ap.onclick = function () { onApply(fields); }; acts.append(ap); }
      var ds = mk('button', 'ghost', 'Discard'); ds.type = 'button'; ds.onclick = function () { S[owner] = null; redraw(owner); }; acts.append(ds);
      box.append(acts);
      if (st.text) { var det = mk('details'); det.append(mk('summary', 'muted', 'Show the recognised text'), mk('pre', 'scantext', st.text)); box.append(det); }
    }
    return box;
  }
  function pickBtn(label, primary, capture, multiple, disabled, onFiles) {
    var frag = document.createDocumentFragment();
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
    if (capture) inp.setAttribute('capture', 'environment'); if (multiple) inp.multiple = true;
    inp.onchange = function () { var fs = Array.prototype.slice.call(inp.files || []); inp.value = ''; if (fs.length) onFiles(fs); };
    var b = mk('button', primary ? 'primary' : '', label); b.type = 'button'; b.disabled = disabled; b.onclick = function () { inp.click(); };
    frag.append(b, inp); return frag;
  }
  function picked(f) { return f && f.on && tidy(f.value) ? tidy(f.value) : null; }
  function get(fields, k) { return picked(fields.find(function (x) { return x.key === k; })); }

  /* ---------- forwarding letter + case acceptance (Documents tab) ---------- */
  function applyLetter(ctx, fields) {
    var patch = {}, n = 0;
    ['memoNo', 'rcNo', 'us', 'diaryNo'].forEach(function (k) { var v = get(fields, k); if (v) { patch[k] = v; n++; } });
    var md = get(fields, 'memoDate'), rd = get(fields, 'rcDate');
    if (md && isoDate(md)) { patch.memoDate = isoDate(md); n++; }
    if (rd && isoDate(rd)) { patch.rcDate = isoDate(rd); n++; }
    var nm = get(fields, 'messenger'), belt = get(fields, 'beltNo');
    if (nm || belt) { var d = ctx.docs(); var name = nm || d.messenger || '', bn = belt || d.beltNo || '';
      if (nm) { patch.messenger = nm; n++; } if (belt) { patch.beltNo = belt; n++; }
      patch.through = name + (bn ? ' - Belt No. ' + bn : ''); }
    if (!n) { note('Nothing selected to fill'); return; }
    ctx.apply(patch, 'Filled ' + n + ' details from a scanned photo');
    S['case:' + ctx.id] = null;
    note(n + ' detail' + (n > 1 ? 's' : '') + ' filled. Check them below.');
  }
  function renderLetter(box, ctx) {
    var owner = 'case:' + ctx.id, st = S[owner], busy = !!st && (st.status === 'reading' || st.status === 'saving'), off = !ctx.canWrite || busy;
    live[owner] = function () { if (document.contains(box)) renderLetter(box, ctx); else delete live[owner]; };
    box.replaceChildren();
    box.append(mk('h2', '', 'Scan the forwarding letter and case acceptance'),
      mk('p', 'sub', 'The phone reads the photo without internet. From the forwarding letter: memo no. (the longest number, often handwritten), the date at the top, RC no./FIR, CFSL diary no. and U/S. From the case acceptance: messenger name and belt no. Handwriting is often misread, so check every value. Every photo is kept below so you can open and read it yourself.'));
    var r1 = mk('div', 'rowbtns');
    r1.append(pickBtn('Scan forwarding letter', true, true, false, off, function (fs) { run(owner, 'letter', fs); }),
      pickBtn('Letter from gallery', false, false, true, off, function (fs) { run(owner, 'letter', fs); }));
    var r2 = mk('div', 'rowbtns');
    r2.append(pickBtn('Scan case acceptance', false, true, false, off, function (fs) { run(owner, 'accept', fs); }),
      pickBtn('Click photo only', false, true, false, off, function (fs) { run(owner, 'photo', fs); }));
    box.append(r1, r2, reviewBlock(owner, function (fields) { applyLetter(ctx, fields); }, ctx.canWrite));
    var strip = photoStrip(owner);
    if ((PH[owner] || []).length) box.append(mk('p', 'minihead', 'Photos of this case · tap to open'), strip); else box.append(strip);
  }

  /* ---------- device label / SIM card (Exhibits and Documents tabs) ---------- */
  function renderLabel(ctx) {
    var owner = 'label:' + ctx.key, wrap = mk('div', 'labelscan');
    function draw() {
      var st = S[owner], busy = !!st && (st.status === 'reading' || st.status === 'saving'), off = !ctx.canWrite || busy;
      wrap.replaceChildren();
      var head = mk('div', 'rowbtns');
      var what = ctx.type === 'sim' ? 'SIM card' : 'device label';
      head.append(pickBtn('Scan ' + what, true, true, false, off, function (fs) { run(owner, 'label', fs, { type: ctx.type }); }),
        pickBtn('From gallery', false, false, false, off, function (fs) { run(owner, 'label', fs, { type: ctx.type }); }));
      wrap.append(head, mk('span', 'muted', ctx.type === 'sim' ? 'Reads the ICCID and the carrier.' : 'Reads make, model no., serial no. and IMEI 1 / IMEI 2 separately.'));
      wrap.append(reviewBlock(owner, function (fields) {
        var patch = {}, n = 0;
        fields.forEach(function (x) { var v = picked(x); if (v) { patch[x.key] = v; n++; } });
        if (!n) { note('Nothing selected to fill'); return; }
        S[owner] = null; ctx.apply(patch); note(n + ' detail' + (n > 1 ? 's' : '') + ' filled from the photo');
      }, ctx.canWrite));
      var ps = PH[owner];
      if (ps && ps.length) wrap.append(photoStrip(owner)); else if (!ps) photoStrip(owner);
    }
    live[owner] = function () { if (document.contains(wrap)) draw(); else delete live[owner]; };
    draw();
    return wrap;
  }

  if (!window.CASEDESK_NO_SCAN && window.Tesseract) {
    window.CASEDESK_SCAN = renderLetter;
    window.CASEDESK_LABELSCAN = renderLabel;
  }
  if (location.hostname === 'localhost') window.__cdParse = { letter: parseLetter, accept: parseAcceptance, label: parseLabel };

  /* ---------- voice typing ---------- */
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
    if (t && t.matches && t.matches(FIELD) && !t.disabled && !t.readOnly && t.id !== 'q') { lastEl = t; lastId = t.id || null; mic.hidden = false; }
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
  mic.addEventListener('pointerdown', function (e) { e.preventDefault(); });
  mic.addEventListener('mousedown', function (e) { e.preventDefault(); });
  mic.onclick = function () {
    if (rec) { rec.stop(); return; }
    var el = target();
    if (!el) { note('Tap a field first, then the microphone.'); return; }
    if (!SR) { note('Voice typing is not available in this view. Tap the microphone on the keyboard to dictate instead.'); return; }
    var finalTxt = '';
    rec = new SR(); rec.lang = 'en-IN'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    rec.onresult = function (ev) {
      var interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) { if (ev.results[i].isFinal) finalTxt += ev.results[i][0].transcript; else interim += ev.results[i][0].transcript; }
      hint.textContent = (finalTxt + ' ' + interim).trim() || 'Listening…';
    };
    rec.onerror = function (ev) {
      var e2 = ev && ev.error; if (e2 === 'no-speech' || e2 === 'aborted') return;
      note(e2 === 'not-allowed' || e2 === 'service-not-allowed' ? 'Microphone access was refused. Allow it in Settings, or use the microphone on the keyboard.'
        : e2 === 'network' ? 'Voice typing needs internet here. The microphone on the keyboard can dictate offline instead.' : 'Voice typing stopped (' + e2 + ').');
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
    try { rec.start(); mic.classList.add('on'); var nm = fieldName(el); hint.textContent = 'Listening' + (nm ? ' for ' + nm.toLowerCase() : '') + '…'; hint.hidden = false; }
    catch (e) { rec = null; stopUI(); note('Could not start voice typing.'); }
  };
})();
