/* lyricsui.js — songtekst plakken, per regel synchroniseren en met akkoorden tonen. */
(() => {
'use strict';
const App = window.App, L = window.Lyrics;
const $ = id => document.getElementById(id);
const el = {
  edit: $('lyEdit'), sync: $('lySync'), copy: $('lyCopy'), editor: $('lyEditor'), text: $('lyText'), save: $('lySave'), cancel: $('lyCancel'),
  bar: $('lySyncBar'), tap: $('lyTap'), undo: $('lyUndo'), reset: $('lyReset'), done: $('lyDone'), progress: $('lyProgress'), sheet: $('lySheet')
};
let lines = [], lastActive = -1, tapStack = [];

const keyFor = () => 'av-lyrics:' + (App.state.mode === 'file' ? (App.state.file && App.state.file.name || 'voorbeeld') : App.els.trackName.textContent);
function load() {
  lines = []; tapStack = [];
  try { const s = JSON.parse(localStorage.getItem(keyFor()) || 'null'); if (s && Array.isArray(s.lines)) lines = s.lines; } catch {}
  render();
}
function save() { try { localStorage.setItem(keyFor(), JSON.stringify({ lines })); } catch {} }
const rows = () => L.placeChords(lines, App.state.segments, ch => App.nameOf(ch));
const nextUnsynced = () => lines.findIndex(l => !l.blank && l.t == null);

function render() {
  const has = lines.some(l => !l.blank);
  el.sync.hidden = !has; el.copy.hidden = !has;
  if (!has) { el.sheet.innerHTML = '<p class="ly-empty">Nog geen songtekst. Tik op "Tekst bewerken" en plak de tekst van het liedje, één regel per zin.</p>'; return; }
  lastActive = L.activeIndex(lines, App.now());
  el.sheet.innerHTML = L.renderHTML(rows(), lastActive);
  updateProgress();
}
function updateProgress() {
  const total = lines.filter(l => !l.blank).length, done = lines.filter(l => !l.blank && l.t != null).length, n = nextUnsynced();
  el.progress.textContent = `${done} van ${total} regels gezet.` + (n >= 0 ? ` Volgende: "${lines[n].text.slice(0, 48)}"` : ' Alle regels staan.');
}

/* regel die nu klinkt oplichten */
App.onTick(t => {
  if (!lines.length) return;
  const idx = L.activeIndex(lines, t);
  if (idx === lastActive) return;
  lastActive = idx;
  el.sheet.querySelectorAll('.ly-line.active').forEach(x => x.classList.remove('active'));
  const n = el.sheet.querySelector(`.ly-line[data-idx="${idx}"]`);
  if (n) {
    n.classList.add('active');
    const r = n.getBoundingClientRect();
    if (r.top < 90 || r.bottom > window.innerHeight - 40) n.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
});
document.addEventListener('av:render', render);
document.addEventListener('av:track', load);
document.addEventListener('av:mode', load);

/* bewerken */
el.edit.addEventListener('click', () => { el.text.value = lines.map(l => l.text).join('\n'); el.editor.hidden = false; el.text.focus(); });
el.cancel.addEventListener('click', () => el.editor.hidden = true);
el.save.addEventListener('click', () => {
  const fresh = L.parse(el.text.value);
  fresh.forEach((l, i) => { const old = lines[i]; if (old && old.text === l.text) l.t = old.t; });
  lines = fresh; tapStack = [];
  el.editor.hidden = true; save(); render();
});

/* synchroniseren */
function setSyncing(on) {
  App.state.syncing = on; el.bar.hidden = !on;
  el.sync.textContent = on ? 'Bezig…' : 'Synchroniseren';
  if (on) updateProgress();
}
el.sync.addEventListener('click', () => setSyncing(!App.state.syncing));
el.done.addEventListener('click', () => setSyncing(false));
function tap() {
  const i = nextUnsynced(); if (i < 0) { updateProgress(); return; }
  if (App.state.mode === 'file' && App.els.audio.paused) App.els.audio.play().catch(() => {});
  lines[i].t = App.now(); tapStack.push(i);
  save(); render();
}
el.tap.addEventListener('click', tap);
el.undo.addEventListener('click', () => { const i = tapStack.pop(); if (i != null) { lines[i].t = null; save(); render(); } });
el.reset.addEventListener('click', () => { lines.forEach(l => l.t = null); tapStack = []; save(); render(); });
document.addEventListener('keydown', e => {
  if (!App.state.syncing || e.code !== 'Space' || e.target.closest('input, textarea, select')) return;
  e.preventDefault(); tap();
});
el.sheet.addEventListener('click', e => {
  const n = e.target.closest('.ly-line'); if (!n) return;
  const i = +n.dataset.idx, line = lines[i]; if (!line) return;
  if (App.state.syncing) { line.t = App.now(); tapStack.push(i); save(); render(); }
  else if (line.t != null && App.state.mode === 'file') App.seek(line.t);
});
el.copy.addEventListener('click', () => App.copyText(L.toText(rows()), el.copy, 'Kopieer'));

load();
})();
