/* Offline replacement for the claude.ai runtime: the page's database, user and
   downloads calls are served from this browser's own storage. Nothing is sent anywhere. */
(function () {
  var KEY = 'casedesk-db-v1';
  var state = null;
  var subs = {};

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) {}
    if (raw) { try { state = JSON.parse(raw); } catch (e) { state = null; } }
    if (!state || typeof state !== 'object') { state = { cases: {} }; persist(); }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
    catch (e) { note('Could not save: storage is full or blocked'); return false; }
  }
  function note(msg) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false; clearTimeout(note._t); note._t = setTimeout(function () { t.hidden = true; }, 2600);
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
    try { file = new File([blob], name, { type: blob.type || 'application/octet-stream' }); } catch (e) {}
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
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

  function importData(raw) {
    var s = JSON.parse(raw);
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('bad file');
    var known = ['cases', 'reminders', 'activity', 'reports', 'courts', 'scenes', 'rnd'];
    if (!Object.keys(s).some(function (k) { return known.indexOf(k) >= 0; })) throw new Error('bad file');
    state = s; if (!persist()) throw new Error('not saved');
    known.concat(Object.keys(subs)).forEach(notify);
  }

  /* Backup / Restore buttons, added beside the page's Save control */
  document.addEventListener('DOMContentLoaded', function () {
    var host = document.querySelector('.savectl'); if (!host) return;
    var pick = document.createElement('input'); pick.type = 'file'; pick.accept = '.json,application/json'; pick.hidden = true;
    pick.onchange = function () {
      var f = pick.files && pick.files[0]; if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try { importData(String(fr.result)); note('Data restored'); } catch (e) { note('That file is not a Case Desk backup'); }
        pick.value = '';
      };
      fr.readAsText(f);
    };
    var bk = document.createElement('button'); bk.textContent = 'Backup'; bk.title = 'Save all data to a file';
    bk.onclick = function () {
      var d = new Date(); var day = new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
      deliver('CaseDesk_backup_' + day + '.json', new Blob([JSON.stringify(state)], { type: 'application/json' }));
    };
    var rs = document.createElement('button'); rs.textContent = 'Restore'; rs.title = 'Replace all data from a backup file';
    rs.onclick = function () { pick.click(); };
    host.appendChild(bk); host.appendChild(rs); host.appendChild(pick);
  });

  if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
})();
