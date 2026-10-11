/* lyricsui.js — het akkoordenblad: tekst plakken, synchroniseren, letter/akkoorden/autoscroll/transponeren. */
(() => {
'use strict';
const App = window.App, L = window.Lyrics;
const $ = id => document.getElementById(id);
const el = {
  edit: $('lyEdit'), sync: $('lySync'), copy: $('lyCopy'), editor: $('lyEditor'), text: $('lyText'), save: $('lySave'), cancel: $('lyCancel'),
  bar: $('lySyncBar'), tap: $('lyTap'), undo: $('lyUndo'), reset: $('lyReset'), done: $('lyDone'), progress: $('lyProgress'), sheet: $('lySheet'),
  tools: $('lyTools'), fontDown: $('lyFontDown'), fontUp: $('lyFontUp'), chords: $('lyChords'), auto: $('lyAuto'), autoDown: $('lyAutoDown'), autoUp: $('lyAutoUp'),
  trDown: $('lyTrDown'), trUp: $('lyTrUp'), trVal: $('lyTrVal'),
  find: $('lyFind'), artist: $('lyArtist'), title: $('lyTitle'), findBtn: $('lyFindBtn'), findStatus: $('lyFindStatus'),
  file: $('lyFile'), estimate: $('lyEstimate')
};
let lines = [], lastActive = -1, tapStack = [];
let font = 1, showChords = true, autoSpeed = 2, autoOn = false, autoRaf = 0, autoLast = 0, autoRest = 0;
try { const p = JSON.parse(localStorage.getItem('av-ly-prefs') || '{}'); font = p.font || 1; showChords = p.showChords !== false; autoSpeed = p.autoSpeed || 2; } catch {}
function savePrefs() { try { localStorage.setItem('av-ly-prefs', JSON.stringify({ font, showChords, autoSpeed })); } catch {} }

const keyFor = () => 'av-lyrics:' + (App.state.mode === 'file' ? (App.state.file && App.state.file.name || 'voorbeeld') : App.els.trackName.textContent);
function load() {
  lines = []; tapStack = [];
  try { const s = JSON.parse(localStorage.getItem(keyFor()) || 'null'); if (s && Array.isArray(s.lines)) lines = s.lines; } catch {}
  render();
}
function save() { try { localStorage.setItem(keyFor(), JSON.stringify({ lines })); } catch {} }
const rows = () => L.placeChords(lines, App.state.segments, ch => App.nameOf(ch), App.view());
const nextUnsynced = () => lines.findIndex(l => L.kindOf(l) === 'text' && l.t == null);
const hasText = () => lines.some(l => L.kindOf(l) !== 'blank');

function applyPrefs() {
  el.sheet.style.fontSize = font + 'rem';
  el.sheet.classList.toggle('nochords', !showChords);
  el.chords.setAttribute('aria-pressed', showChords);
  el.auto.setAttribute('aria-pressed', autoOn);
  el.auto.textContent = autoOn ? 'Autoscroll ' + autoSpeed : 'Autoscroll';
  el.trVal.textContent = (App.state.transpose > 0 ? '+' : '') + App.state.transpose;
}
function render() {
  applyPrefs();
  const has = hasText();
  el.sync.hidden = !has; el.copy.hidden = !has; el.tools.hidden = !has;
  if (!has) { el.sheet.innerHTML = '<p class="ly-empty">Nog geen songtekst. Tik op "Tekst bewerken" en plak de tekst, of een compleet akkoordenblad (met akkoorden boven de regels en kopjes als [Intro] en [Refrein]).</p>'; return; }
  lastActive = L.activeIndex(lines, App.now());
  el.sheet.innerHTML = L.renderHTML(rows(), lastActive);
  updateProgress();
}
function updateProgress() {
  const all = lines.filter(l => L.kindOf(l) === 'text'), done = all.filter(l => l.t != null).length, n = nextUnsynced();
  el.progress.textContent = `${done} van ${all.length} regels gezet.` + (n >= 0 ? ` Volgende: "${(lines[n].text || lines[n].manual || '').slice(0, 48)}"` : ' Alle regels staan.');
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
    if (!autoOn && (r.top < 90 || r.bottom > window.innerHeight - 80)) n.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
});
document.addEventListener('av:render', render);
document.addEventListener('av:mode', load);
document.addEventListener('av:track', e => {
  load();
  const meta = App.state.meta || {}, guess = L.guessFromName(e.detail || '');
  const artist = meta.artist || guess.artist, title = meta.title || guess.title;
  if (title) { el.artist.value = artist; el.title.value = title; }
  el.findStatus.textContent = '';
  if (!e.detail || hasText()) return;
  // 1) tekst die in het bestand zelf zit (ID3: SYLT of USLT), 2) anders opzoeken
  if (meta.synced && meta.synced.length) { lines = L.fromEntries(meta.synced); tapStack = []; save(); render(); el.findStatus.textContent = 'Songtekst met tijden uit het bestand zelf gelezen.'; return; }
  if (meta.lyrics) {
    lines = L.parseAny(meta.lyrics); tapStack = []; save(); render();
    el.findStatus.textContent = lines.some(l => l.t != null) ? 'Songtekst met tijden uit het bestand zelf gelezen.' : 'Songtekst uit het bestand gelezen, zonder tijden. Tik op Synchroniseren en dan op "Tijden schatten" of tik de regels mee.';
    return;
  }
  if (App.state.autoLyrics && title) findLyrics(artist, title, true);
});

/* tekstbestand (.lrc of .txt) naast het liedje */
el.file.addEventListener('change', async () => {
  const f = el.file.files[0]; if (!f) return;
  try {
    lines = L.parseAny(await f.text()); tapStack = []; save(); render();
    el.findStatus.textContent = lines.some(l => l.t != null) ? `Tekst met tijden geladen uit ${f.name}.` : `Tekst geladen uit ${f.name} (zonder tijden). Tik op Synchroniseren en dan "Tijden schatten", of tik de regels mee.`;
  } catch { el.findStatus.textContent = 'Dit bestand kon niet worden gelezen.'; }
  el.file.value = '';
});

/* regels zonder tijd gelijkmatig verdelen tussen de bekende tijden (ruwe schatting, daarna bijtikken) */
function estimateTimes() {
  const texts = lines.filter(l => L.kindOf(l) === 'text'), n = texts.length; if (!n) return;
  const segs = App.state.segments, dur = App.state.mode === 'file' ? App.state.duration : App.state.liveTime;
  const first = segs.find(s => s.chord), last = [...segs].reverse().find(s => s.chord);
  const start = first ? first.start : 0, end = last ? Math.min(dur, last.end) : dur;
  let i = 0;
  while (i < n) {
    if (texts[i].t != null) { i++; continue; }
    let j = i; while (j < n && texts[j].t == null) j++;
    const t0 = i > 0 ? texts[i - 1].t : start, t1 = j < n ? texts[j].t : end, count = j - i, off = i > 0 ? 1 : 0;
    for (let k = 0; k < count; k++) texts[i + k].t = t0 + (t1 - t0) * (k + off) / (count + off);
    i = j;
  }
  tapStack = []; save(); render();
  el.progress.textContent = 'Tijden geschat. Klopt een regel niet? Speel af en tik op die regel op het moment dat hij begint.';
}
el.estimate.addEventListener('click', estimateTimes);
document.addEventListener('av:title', e => {
  const guess = L.guessFromName(e.detail || '');
  if (!guess.title) return;
  el.artist.value = guess.artist; el.title.value = guess.title;
  if (App.state.autoLyrics && !hasText()) findLyrics(guess.artist, guess.title, true);
});

/* songtekst opzoeken (lrclib.net: open database met tijdstempels per regel) */
let finding = false;
async function findLyrics(artist, title, auto) {
  if (finding || !title) return;
  finding = true; el.findBtn.disabled = true;
  el.findStatus.textContent = 'Songtekst zoeken…';
  try {
    const q = new URLSearchParams();
    if (artist) { q.set('artist_name', artist); q.set('track_name', title); } else q.set('q', title);
    const r = await fetch('https://lrclib.net/api/search?' + q.toString(), { headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('http ' + r.status);
    const res = await r.json();
    const dur = App.state.mode === 'file' ? App.state.duration : 0;
    const score = x => (x.syncedLyrics ? 0 : 40) + (x.instrumental ? 100 : 0) + (dur && x.duration ? Math.min(60, Math.abs(x.duration - dur)) : 0);
    const hit = Array.isArray(res) ? res.filter(x => x.syncedLyrics || x.plainLyrics).sort((a, b) => score(a) - score(b))[0] : null;
    if (!hit) { el.findStatus.textContent = auto ? 'Geen songtekst gevonden voor deze bestandsnaam. Pas artiest/titel aan, of plak de tekst zelf.' : 'Niets gevonden. Probeer een andere spelling, of plak de tekst zelf.'; return; }
    lines = hit.syncedLyrics ? L.parseLRC(hit.syncedLyrics) : L.parse(hit.plainLyrics);
    tapStack = [];
    save(); render();
    const clean = s => String(s || '').split(';')[0].trim();
    el.findStatus.textContent = `Gevonden: ${clean(hit.artistName)} – ${clean(hit.trackName)}` + (hit.syncedLyrics ? ' (met tijden: de akkoorden staan meteen op hun plek).' : ' (zonder tijden: tik op Synchroniseren om de akkoorden erboven te krijgen).');
  } catch (e) {
    console.error(e);
    el.findStatus.textContent = 'Zoeken lukte niet (geen verbinding?). Je kunt de tekst ook zelf plakken.';
  } finally { finding = false; el.findBtn.disabled = false; }
}
el.find.addEventListener('submit', e => { e.preventDefault(); findLyrics(el.artist.value.trim(), el.title.value.trim(), false); });

/* bewerken */
el.edit.addEventListener('click', () => { el.text.value = L.toSource(lines); el.editor.hidden = false; el.text.focus(); });
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
  if (on) { setAuto(false); updateProgress(); }
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

/* werkbalk: letter, akkoorden, autoscroll, transponeren */
el.fontDown.addEventListener('click', () => { font = Math.max(0.7, +(font - 0.1).toFixed(2)); savePrefs(); applyPrefs(); });
el.fontUp.addEventListener('click', () => { font = Math.min(1.6, +(font + 0.1).toFixed(2)); savePrefs(); applyPrefs(); });
el.chords.addEventListener('click', () => { showChords = !showChords; savePrefs(); applyPrefs(); });
function autoStep(ts) {
  if (!autoOn) return;
  if (autoLast) {
    autoRest += (ts - autoLast) / 1000 * autoSpeed * 14; // pixels per seconde
    const px = Math.floor(autoRest); autoRest -= px;
    if (px) window.scrollBy(0, px);
    if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 2) { setAuto(false); return; }
  }
  autoLast = ts; autoRaf = requestAnimationFrame(autoStep);
}
function setAuto(on) {
  autoOn = on; autoLast = 0; autoRest = 0;
  cancelAnimationFrame(autoRaf);
  if (on) autoRaf = requestAnimationFrame(autoStep);
  applyPrefs();
}
el.auto.addEventListener('click', () => setAuto(!autoOn));
el.autoDown.addEventListener('click', () => { autoSpeed = Math.max(1, autoSpeed - 1); savePrefs(); applyPrefs(); });
el.autoUp.addEventListener('click', () => { autoSpeed = Math.min(6, autoSpeed + 1); savePrefs(); applyPrefs(); });
el.trDown.addEventListener('click', () => { App.state.transpose = Math.max(-11, App.state.transpose - 1); App.renderAll(); });
el.trUp.addEventListener('click', () => { App.state.transpose = Math.min(11, App.state.transpose + 1); App.renderAll(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) setAuto(false); });

load();
})();
