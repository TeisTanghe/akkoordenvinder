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
/* volgende regel om te tikken: na de laatst getikte, anders de eerste zonder (vaste) tijd */
function nextUnsynced() {
  const last = tapStack.length ? tapStack[tapStack.length - 1] : -1;
  for (let i = last + 1; i < lines.length; i++) if (L.kindOf(lines[i]) === 'text' && (lines[i].t == null || lines[i].est)) return i;
  return lines.findIndex(l => L.kindOf(l) === 'text' && (l.t == null || l.est));
}
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
  const all = lines.filter(l => L.kindOf(l) === 'text'), fixed = all.filter(l => l.t != null && !l.est).length, est = all.filter(l => l.est).length, n = nextUnsynced();
  el.progress.textContent = `${fixed} van ${all.length} regels zelf gezet` + (est ? `, ${est} geschat.` : '.') + (n >= 0 ? ` Volgende: "${(lines[n].text || lines[n].manual || '').slice(0, 48)}"` : ' Alle regels staan.');
  if (!App.state.syncing && est && !el.findStatus.textContent) el.findStatus.textContent = 'De regeltijden zijn geschat aan de hand van de akkoordwissels. Staat een akkoord op het verkeerde woord? Tik op Synchroniseren en tik op die regel op het moment dat hij begint.';
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
    const timed = lines.some(l => l.t != null);
    if (!timed) autoEstimate();
    el.findStatus.textContent = timed ? 'Songtekst met tijden uit het bestand zelf gelezen.' : 'Songtekst uit het bestand gelezen; de regeltijden zijn geschat.';
    return;
  }
  if (App.state.autoLyrics && title) findLyrics(artist, title, true);
});

/* tekstbestand (.lrc of .txt) naast het liedje */
el.file.addEventListener('change', async () => {
  const f = el.file.files[0]; if (!f) return;
  try {
    lines = L.parseAny(await f.text()); tapStack = []; save(); render();
    const timed = lines.some(l => l.t != null);
    if (!timed) autoEstimate();
    el.findStatus.textContent = timed ? `Tekst met tijden geladen uit ${f.name}.` : `Tekst geladen uit ${f.name}; de regeltijden zijn geschat.`;
  } catch { el.findStatus.textContent = 'Dit bestand kon niet worden gelezen.'; }
  el.file.value = '';
});

/* Regeltijden schatten zonder tikken. Zelf getikte regels blijven staan en dienen als ankers; de rest wordt
   verdeeld naar regellengte (met extra ruimte na een witregel) en vastgeklikt op de dichtstbijzijnde akkoordwissel. */
const FUNC = new Set(['de', 'het', 'een', 'en', 'of', 'in', 'op', 'te', 'ik', 'je', 'jij', 'we', 'ze', 'is', 'er', 'me', 'mij', 'aan', 'als', 'dat', 'die', 'dit', 'the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'i', 'you', 'it', 'is', 'my', 'me', 'we', 'so', 'do']);
const SYL = l => { const w = (l.text || '').toLowerCase().match(/[a-zà-ÿ']+/g) || []; return Math.max(1, w.reduce((a, x) => a + Math.max(1, (x.match(/[aeiouyáéíóúàèëïöüâêîôû]+/g) || []).length) * (FUNC.has(x) ? 0.6 : 1), 0)); };
function estimateTimes(auto) {
  const texts = lines.filter(l => L.kindOf(l) === 'text'), n = texts.length; if (!n) return false;
  const segs = App.state.segments.filter(s => s.chord);
  const dur = App.state.mode === 'file' ? App.state.duration : App.state.liveTime;
  if (!segs.length || !dur) return false;
  const F = App.state.feat;
  const frameT = f => F ? (f * F.hop + F.n / 2) / F.sr : 0;
  // zangstart: gemeten zangactiviteit; anders als het eerste akkoord na de intro terugkomt, anders het eerste akkoord
  const first = segs[0];
  const again = segs.find(s => s.start > first.end + 0.5 && s.chord.root === first.chord.root && s.chord.q === first.chord.q);
  let start = again && again.start < Math.min(40, dur * 0.25) ? again.start : first.start;
  let end = Math.max(start + n, Math.min(dur, segs[segs.length - 1].end) - 1);
  if (F && F.vocal && F.vocalStart >= 0) { start = frameT(F.vocalStart); end = Math.max(start + n, frameT(F.vocalEnd)); }
  if (F && F.vocal) return estimateDP(texts, segs, F, start, end, auto);
  const weight = l => { const k = lines.indexOf(l), prev = lines[k - 1]; return Math.max(10, l.text.length) + (prev && L.kindOf(prev) === 'blank' ? 14 : 0); };
  const open = l => l.t == null || l.est;
  let i = 0;
  while (i < n) {
    if (!open(texts[i])) { i++; continue; }
    let j = i; while (j < n && open(texts[j])) j++;
    const items = (i > 0 ? [texts[i - 1]] : []).concat(texts.slice(i, j));
    const t0 = i > 0 ? texts[i - 1].t : start, t1 = j < n ? texts[j].t : end;
    const total = items.reduce((a, l) => a + weight(l), 0);
    let cum = 0;
    items.forEach((l, idx) => { if (!(i > 0 && idx === 0)) { l.t = t0 + (t1 - t0) * cum / total; l.est = true; } cum += weight(l); });
    i = j;
  }
  let prevT = -1;
  texts.forEach((l, k) => {
    if (l.est) {
      const next = texts[k + 1], lineDur = next && next.t != null ? Math.max(0.5, next.t - l.t) : 3;
      const win = Math.min(1.5, Math.max(0.3, lineDur * 0.4));
      let best = null;
      for (const s of segs) { const d = Math.abs(s.start - l.t); if (d <= win && (best == null || d < Math.abs(best - l.t))) best = s.start; }
      if (best != null) l.t = best;
    }
    if (l.t != null) { if (l.t < prevT + 0.25) l.t = prevT + 0.25; prevT = l.t; }
  });
  tapStack = []; save(); render();
  if (!auto) el.progress.textContent = 'Tijden opnieuw geschat. Klopt een regel niet? Speel af en tik op die regel op het moment dat hij begint.';
  return true;
}
/* Dynamisch programmeren: elke regel krijgt een kandidaat-start (akkoordwissel of zanginzet) zó dat de regelduur
   past bij het aantal lettergrepen en er op dat moment gezongen wordt. Zelf getikte regels zijn vaste ankers. */
function estimateDP(texts, segs, F, vStart, vEnd, auto) {
  const n = texts.length, frameT = f => (f * F.hop + F.n / 2) / F.sr;
  const vocalAt = t => { const f = Math.max(0, Math.min(F.nF - 1, Math.round((t * F.sr - F.n / 2) / F.hop))); let s = 0; for (let d = 0; d < 3; d++) s += F.vocal[Math.min(F.nF - 1, f + d)]; return s / 3; };
  const gapBefore = l => { const k = lines.indexOf(l); return k > 0 && L.kindOf(lines[k - 1]) === 'blank'; };
  const fixed = texts.map(l => (l.t != null && !l.est) ? l.t : null);
  const cand = new Map();
  const add = (t, chord) => { const key = Math.round(t * 10); if (!cand.has(key) || chord) cand.set(key, { t, chord }); };
  for (const s of segs) add(s.start, true);
  for (const f of F.vocalOnsets || []) add(frameT(f), false);
  for (const b of F.beats || []) if (b >= vStart - 1 && b <= vEnd + 1) add(b, false);
  for (const t of fixed) if (t != null) add(t, false);
  const changes = segs.map(s => s.start);
  const chordJustBefore = t => changes.some(c => c <= t && t - c <= 0.3);
  const C = [...cand.values()].sort((a, b) => a.t - b.t).map(c => ({ ...c, v: vocalAt(c.t), near: chordJustBefore(c.t) }));
  const m = C.length; if (!m) return false;
  const beat = F.bpm ? 60 / F.bpm : 0.5;
  const totalSyl = texts.reduce((a, l) => a + SYL(l) + (gapBefore(l) ? 4 : 0), 0);
  const sps = Math.max(0.12, Math.min(0.7, (vEnd - vStart) / totalSyl));
  const expDur = texts.map((l, i) => SYL(l) * sps + (i + 1 < n && gapBefore(texts[i + 1]) ? 4 * sps : 0));
  const INF = 1e9, cost = new Float64Array(n * m).fill(INF), back = new Int32Array(n * m).fill(-1);
  const unit = (i, j) => { if (fixed[i] != null) return Math.abs(C[j].t - fixed[i]) < 0.06 ? -20 : INF; return (1 - C[j].v) * 2.5 + (C[j].chord ? 0 : C[j].near ? 0.15 : 0.5); };
  for (let j = 0; j < m; j++) cost[j] = unit(0, j) + Math.abs(C[j].t - vStart) / Math.max(1, 6 * sps);
  for (let i = 1; i < n; i++) {
    const e = Math.max(0.5, expDur[i - 1]);
    for (let j = 0; j < m; j++) {
      const u = unit(i, j); if (u >= INF) continue;
      let best = INF, bk = -1;
      for (let k = j - 1; k >= 0; k--) {
        const dt = C[j].t - C[k].t; if (dt < 0.3) continue; if (dt > 4 * e + 6) break;
        if (cost[(i - 1) * m + k] >= INF) continue;
        const c = cost[(i - 1) * m + k] + Math.abs(dt - e) / e + (dt < beat ? 1.5 : 0) + (dt > 16 * beat ? 1 : 0);
        if (c < best) { best = c; bk = k; }
      }
      if (bk >= 0) { cost[i * m + j] = best + u; back[i * m + j] = bk; }
    }
  }
  let j = -1, bestC = INF;
  for (let q = 0; q < m; q++) if (cost[(n - 1) * m + q] < bestC) { bestC = cost[(n - 1) * m + q]; j = q; }
  if (j < 0) return false;
  for (let i = n - 1; i >= 0; i--) { if (fixed[i] == null) { texts[i].t = C[j].t; texts[i].est = true; } j = back[i * m + j]; if (j < 0 && i > 0) return false; }
  tapStack = []; save(); render();
  if (!auto) el.progress.textContent = 'Tijden opnieuw geschat. Klopt een regel niet? Speel af en tik op die regel op het moment dat hij begint.';
  return true;
}
el.estimate.addEventListener('click', () => estimateTimes(false));
/* meteen na plakken/laden: schatten als er nog geen tijden zijn */
function autoEstimate() { if (App.state.mode === 'file' && !lines.some(l => l.t != null && !l.est)) return estimateTimes(true); return false; }
document.addEventListener('av:render', () => { if (hasText() && !lines.some(l => l.t != null) && App.state.segments.length) autoEstimate(); });
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
    if (!hit.syncedLyrics) autoEstimate();
    const clean = s => String(s || '').split(';')[0].trim();
    el.findStatus.textContent = `Gevonden: ${clean(hit.artistName)} – ${clean(hit.trackName)}` + (hit.syncedLyrics ? ' (met tijden per regel).' : ' (zonder tijden; de regeltijden zijn geschat).');
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
  fresh.forEach((l, i) => { const old = lines[i]; if (old && old.text === l.text) { l.t = old.t; l.est = old.est; } });
  lines = fresh; tapStack = [];
  el.editor.hidden = true; save(); render();
  autoEstimate();
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
  lines[i].t = App.now(); lines[i].est = false; tapStack.push(i);
  save(); render();
}
el.tap.addEventListener('click', tap);
el.undo.addEventListener('click', () => { const i = tapStack.pop(); if (i != null) { lines[i].t = null; save(); render(); } });
el.reset.addEventListener('click', () => { lines.forEach(l => { l.t = null; l.est = false; }); tapStack = []; save(); render(); });
document.addEventListener('keydown', e => {
  if (!App.state.syncing || e.code !== 'Space' || e.target.closest('input, textarea, select')) return;
  e.preventDefault(); tap();
});
/* tikken: akkoord = greep tonen, regel = springen (of in sync-modus: regel begint nu). Lang indrukken: regel begint nu. */
let pressT = 0, pressed = false;
function setLineNow(i) {
  const line = lines[i]; if (!line) return;
  line.t = App.now(); line.est = false; tapStack.push(i); save(); render();
  el.findStatus.textContent = `Regel vastgezet op ${App.fmt(line.t)}. Andere geschatte regels zijn meegeschoven.`;
  estimateTimes(true);
}
el.sheet.addEventListener('pointerdown', e => {
  const n = e.target.closest('.ly-line'); if (!n) return;
  pressed = false; clearTimeout(pressT);
  pressT = setTimeout(() => { pressed = true; if (navigator.vibrate) navigator.vibrate(30); setLineNow(+n.dataset.idx); }, 550);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.sheet.addEventListener(ev, () => clearTimeout(pressT)));
el.sheet.addEventListener('contextmenu', e => { if (e.target.closest('.ly-line')) e.preventDefault(); });
el.sheet.addEventListener('click', e => {
  if (pressed) { pressed = false; return; }
  const badge = e.target.closest('.ly-chords b');
  if (badge) { App.showChordByName(badge.textContent.trim()); return; }
  const n = e.target.closest('.ly-line'); if (!n) return;
  const i = +n.dataset.idx, line = lines[i]; if (!line) return;
  if (App.state.syncing) setLineNow(i);
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

/* speelstand: alleen het blad, groot, scherm blijft aan */
let wake = null;
async function setPlayMode(on) {
  document.body.classList.toggle('playmode', on);
  $('playBar').hidden = !on;
  if (on) { try { wake = await navigator.wakeLock.request('screen'); } catch { wake = null; } window.scrollTo({ top: 0 }); }
  else { try { wake && wake.release(); } catch {} wake = null; setAuto(false); }
}
$('lyPlay').addEventListener('click', () => setPlayMode(true));
$('playExit').addEventListener('click', () => setPlayMode(false));
$('playToggle').addEventListener('click', () => App.els.play.click());
$('playAuto').addEventListener('click', () => setAuto(!autoOn));
App.els.audio.addEventListener('play', () => $('playToggle').textContent = '❚❚');
App.els.audio.addEventListener('pause', () => $('playToggle').textContent = '▶');
App.onTick(t => { if (document.body.classList.contains('playmode')) $('playTime').textContent = App.fmt(t); });

load();
})();
