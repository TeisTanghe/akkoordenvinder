/* library.js — opgeslagen liedjes (IndexedDB): audio, herkende akkoorden en kenmerken, op het apparaat. */
(() => {
'use strict';
const App = window.App;
const $ = id => document.getElementById(id);
const el = { list: $('libList'), save: $('saveBtn'), count: $('libCount') };
const DB = 'akkoordenvinder', VER = 1;

/* ---------- opslag ---------- */
function open() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error('geen indexedDB'));
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('audio')) d.createObjectStore('audio');
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const doneP = t => new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
async function list() {
  const db = await open();
  const all = await reqP(db.transaction('songs').objectStore('songs').getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
async function put(meta, blob) {
  const db = await open(), t = db.transaction(['songs', 'audio'], 'readwrite');
  t.objectStore('songs').put(meta);
  if (blob) t.objectStore('audio').put(blob, meta.id); else t.objectStore('audio').delete(meta.id);
  await doneP(t);
}
async function get(id) {
  const db = await open(), t = db.transaction(['songs', 'audio']);
  const [meta, blob] = await Promise.all([reqP(t.objectStore('songs').get(id)), reqP(t.objectStore('audio').get(id))]);
  return { meta, blob };
}
async function remove(id) {
  const db = await open(), t = db.transaction(['songs', 'audio'], 'readwrite');
  t.objectStore('songs').delete(id); t.objectStore('audio').delete(id);
  await doneP(t);
}

/* ---------- huidig liedje -> record ---------- */
function currentRecord() {
  const s = App.state, file = s.mode === 'file';
  if (file && !(s.file && s.file.name)) return null;            // het voorbeeld slaan we niet op
  if (!file && !s.segments.length) return null;
  const id = s.songId || ('s' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const name = file ? s.file.name : (s.ytUrl && s.mode === 'youtube' ? 'YouTube ' + new Date().toLocaleDateString('nl-NL') + ' ' + new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
                                  : 'Microfoon ' + new Date().toLocaleDateString('nl-NL') + ' ' + new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }));
  const segments = s.segments.map(g => ({ start: g.start, end: isFinite(g.end) ? g.end : s.liveTime, chord: g.chord, conf: g.conf }));
  return {
    id, name: s.songId && s.savedName ? s.savedName : name, kind: file ? 'file' : 'live', createdAt: s.savedAt || Date.now(),
    duration: file ? s.duration : s.liveTime, key: s.key, feat: file ? s.feat : null, segments,
    ytUrl: !file && s.mode === 'youtube' ? s.ytUrl : null
  };
}
async function saveCurrent(auto) {
  const meta = currentRecord(); if (!meta) return;
  try {
    await put(meta, meta.kind === 'file' ? App.state.fileBlob : null);
    App.state.songId = meta.id; App.state.savedName = meta.name; App.state.savedAt = meta.createdAt;
    flash(auto ? 'Automatisch opgeslagen' : 'Opgeslagen');
    refresh();
  } catch (e) {
    console.error(e);
    App.setStatus('Opslaan lukte niet. Mogelijk is er te weinig opslagruimte, of blokkeert de browser dit in een privévenster.', null, true);
  }
}
let flashT = 0;
function flash(text) { el.save.textContent = text; clearTimeout(flashT); flashT = setTimeout(refreshSaveBtn, 1800); }
function refreshSaveBtn() {
  const can = !!currentRecord();
  el.save.hidden = !can;
  el.save.textContent = App.state.songId ? 'Opnieuw opslaan' : 'Opslaan';
}

/* ---------- lijst ---------- */
const fmtDate = ts => new Date(ts).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function refresh() {
  refreshSaveBtn();
  let songs = [];
  try { songs = await list(); } catch { el.list.innerHTML = '<p class="hint">Opslaan werkt niet in deze browser (geen opslag beschikbaar).</p>'; return; }
  el.count.textContent = songs.length ? `${songs.length}` : '';
  if (!songs.length) { el.list.innerHTML = '<p class="hint">Nog niets opgeslagen. Laad een liedje en tik op <b>Opslaan</b>, of zet in Instellingen "Automatisch opslaan" aan.</p>'; return; }
  el.list.innerHTML = songs.map(s => `
    <div class="libItem ${s.id === App.state.songId ? 'on' : ''}" data-id="${s.id}">
      <button class="libOpen" data-open="${s.id}">
        <span class="libName">${esc(s.name)}</span>
        <span class="libMeta"><span class="badge">${s.kind === 'file' ? 'Bestand' : s.ytUrl ? 'YouTube' : 'Microfoon'}</span><span>${window.DSP.keyName(s.key)}</span><span class="mono">${App.fmt(s.duration)}</span><span>${fmtDate(s.createdAt)}</span></span>
      </button>
      <button class="libDel" data-del="${s.id}" aria-label="Verwijder ${esc(s.name)}">Verwijder</button>
    </div>`).join('');
}
el.list.addEventListener('click', async e => {
  const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]');
  if (o) {
    try {
      const { meta, blob } = await get(o.dataset.open);
      if (!meta) return;
      App.state.savedName = meta.name; App.state.savedAt = meta.createdAt;
      await App.loadRecord(meta, blob);
      refresh();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { console.error(err); App.setStatus('Dit liedje kon niet worden geopend.', null, true); }
  } else if (d) {
    if (d.dataset.armed) {
      await remove(d.dataset.del);
      if (App.state.songId === d.dataset.del) App.state.songId = null;
      refresh();
    } else {
      d.dataset.armed = '1'; d.textContent = 'Zeker? Tik nog eens';
      setTimeout(() => { delete d.dataset.armed; d.textContent = 'Verwijder'; }, 3000);
    }
  }
});
el.save.addEventListener('click', () => saveCurrent(false));

document.addEventListener('av:analysed', () => { if (App.state.autosave) saveCurrent(true); else refreshSaveBtn(); });
document.addEventListener('av:track', refreshSaveBtn);
document.addEventListener('av:mode', refreshSaveBtn);
document.addEventListener('av:render', refreshSaveBtn);
refresh();
})();
