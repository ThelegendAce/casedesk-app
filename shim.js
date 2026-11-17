/* Offline replacement for the claude.ai runtime: the page's database, user and
   downloads calls are served from this browser's own storage. Nothing is sent anywhere.
   Used by the phone web app and by the desktop offline file. */
(function () {
  var KEY = 'casedesk-db-v1';
  var state = null;
  var subs = {};
  var FORMATS = ['report', 'worksheet', 'forwarding', 'notesheet', 'bsa63'];
  var KNOWN = ['cases', 'reminders', 'activity', 'reports', 'courts', 'scenes', 'rnd'];
  // the desktop file carries the Word formats inside it; the public phone app does not
  var BUILT_IN = !!window.CASEDESK_FORMATS_PACK;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (raw) { try { state = JSON.parse(raw); } catch (e) { state = null; } }
    if (!state || typeof state !== 'object') {
      state = window.CASEDESK_SEED ? clone(window.CASEDESK_SEED) : { cases: {} };
      persist();
    }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { note('Could not save: storage is full or blocked'); return false; }
  }
  function note(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false; clearTimeout(note._t); note._t = setTimeout(function () { t.hidden = true; }, 3200);
  }
  function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
  function col(name) { return state[name] || (state[name] = {}); }
  function snapshot(name) {
    var c = col(name);
    return { docs: Object.keys(c).map(function (id) { var d = clone(c[id]); return { id: id, data: function () { return d; } }; }) };
  }
  function notify(name) {
    (subs[name] || []).forEach(function (cb) { setTimeout(function () { try { cb(snapshot(name)); } catch (e) {} }, 0); });
  }
  function ref(name, id) {
    return {
      id: id,
      set: async function (data) { col(name)[id] = clone(data); persist(); notify(name); },
      update: async function (patch) { col(name)[id] = Object.assign({}, col(name)[id] || {}, clone(patch)); persist(); notify(name); },
      delete: async function () { delete col(name)[id]; persist(); notify(name); },
      get: async function () { var d = clone(col(name)[id]); return { id: id, exists: d !== undefined, data: function () { return d; } }; }
    };
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  var db = {
    doc: function (path) { var i = path.lastIndexOf('/'); return ref(path.slice(0, i), path.slice(i + 1)); },
    collection: function (name) {
      return {
        doc: function (id) { return ref(name, id || newId()); },
        onSnapshot: function (cb) {
          (subs[name] = subs[name] || []).push(cb);
          setTimeout(function () { cb(snapshot(name)); }, 0);
          return function () { subs[name] = (subs[name] || []).filter(function (x) { return x !== cb; }); };
        }
      };
    }
  };
  var user = { can: async function () { return true; } };

  /* Hands a file to the person: the share sheet on iPhone (Save to Files, Print, Mail),
     an ordinary download elsewhere. */
  async function deliver(name, blob) {
    var file = null;
    var touch = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    try { file = new File([blob], name, { type: blob.type || 'application/octet-stream' }); } catch (e) {}
    if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }
  var downloads = { save: function (o) { return deliver(o.filename, o.data instanceof Blob ? o.data : new Blob([o.data])); } };

  load();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}

  window.claude = {
    use: async function (name) {
      if (name === 'db') return db;
      if (name === 'user') return user;
      if (name === 'downloads') return downloads;
      throw new Error('unavailable');
    }
  };

  /* ---------- Word formats kept on this device (phone app) ---------- */
  function idb(mode, fn) {
    return new Promise(function (resolve, reject) {
      var o = indexedDB.open('casedesk-formats', 1);
      o.onupgradeneeded = function () { o.result.createObjectStore('f'); };
      o.onerror = function () { reject(o.error); };
      o.onsuccess = function () {
        var tx = o.result.transaction('f', mode); var rq = fn(tx.objectStore('f'));
        tx.oncomplete = function () { resolve(rq && rq.result); o.result.close(); };
        tx.onerror = function () { reject(tx.error); };
      };
    });
  }
  function b64buf(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
  async function storeFormats(map) {   // map: name -> ArrayBuffer
    var n = 0;
    for (var i = 0; i < FORMATS.length; i++) {
      var b = map[FORMATS[i]]; if (!b) continue;
      await idb('readwrite', (function (k, v) { return function (s) { return s.put(v, k); }; })(FORMATS[i], b)); n++;
    }
    return n;
  }
  async function formatsFromZip(file) {
    var zip = await JSZip.loadAsync(await file.arrayBuffer()), map = {};
    for (var i = 0; i < FORMATS.length; i++) { var e = zip.file(FORMATS[i] + '.docx'); if (e) map[FORMATS[i]] = await e.async('arraybuffer'); }
    return map;
  }
  if (!BUILT_IN) {
    window.CASEDESK_FORMATS = function (name) { return idb('readonly', function (s) { return s.get(name); }).catch(function () { return null; }); };
    window.CASEDESK_HAS_FORMATS = async function () {
      try { var b = await idb('readonly', function (s) { return s.get('report'); }); return !!b; } catch (e) { return false; }
    };
  }

  /* A backup or setup file: case data, optionally with the Word formats under "_formats" */
  async function importData(raw) {
    var s = JSON.parse(raw);
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('bad file');
    var fm = s._formats; delete s._formats;
    var hasData = Object.keys(s).some(function (k) { return KNOWN.indexOf(k) >= 0; });
    if (!hasData && !fm) throw new Error('bad file');
    var n = 0;
    if (fm && !BUILT_IN) { var map = {}; Object.keys(fm).forEach(function (k) { map[k] = b64buf(fm[k]); }); n = await storeFormats(map); }
    if (hasData) { state = s; if (!persist()) throw new Error('not saved'); KNOWN.concat(Object.keys(subs)).forEach(notify); }
    return { data: hasData, formats: n };
  }

  /* One picker for everything: a backup/setup .json, or the formats .zip */
  var pick = null;
  function openPicker() { if (pick) pick.click(); }
  window.CASEDESK_LOAD_FORMATS = BUILT_IN ? undefined : openPicker;

  document.addEventListener('DOMContentLoaded', function () {
    var host = document.querySelector('.savectl'); if (!host) return;
    pick = document.createElement('input'); pick.type = 'file'; pick.id = 'restorePick'; pick.hidden = true;
    pick.accept = BUILT_IN ? '.json,application/json' : '.json,.zip,application/json,application/zip';
    pick.onchange = async function () {
      var f = pick.files && pick.files[0]; pick.value = ''; if (!f) return;
      try {
        if (/\.zip$/i.test(f.name) || f.type === 'application/zip') {
          if (BUILT_IN) throw new Error('bad file');
          var n = await storeFormats(await formatsFromZip(f));
          note(n ? n + ' Word formats loaded. Documents can now be prepared.' : 'That zip has no Case Desk formats');
        } else {
          var r = await importData(await f.text());
          note(r.data && r.formats ? 'Data and ' + r.formats + ' Word formats loaded' : r.formats ? r.formats + ' Word formats loaded' : 'Data restored');
        }
        if (typeof window.CASEDESK_REFRESH === 'function') window.CASEDESK_REFRESH();
      } catch (e) { note('That file is not a Case Desk backup, setup or formats file'); }
    };
    var bk = document.createElement('button'); bk.textContent = 'Backup'; bk.title = 'Save all data to a file';
    bk.onclick = function () {
      var d = new Date(); var day = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      deliver('CaseDesk_backup_' + day + '.json', new Blob([JSON.stringify(state)], { type: 'application/json' }));
    };
    var rs = document.createElement('button'); rs.textContent = 'Restore'; rs.id = 'btnRestore';
    rs.title = BUILT_IN ? 'Replace all data from a backup file' : 'Load a backup or setup file (data and Word formats)';
    rs.onclick = openPicker;
    host.appendChild(bk); host.appendChild(rs); host.appendChild(pick);
  });

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
