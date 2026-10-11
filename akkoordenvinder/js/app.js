/* app.js — kern: toestand, speler, weergave, instellingen en bestanden laden.
   Live-bronnen (YouTube, microfoon) staan in live.js, de songtekst in lyricsui.js. */
window.App = (() => {
'use strict';
const { mod12, extractFeatures, recognise, chordName, roman, hueOf, keyName, prefersFlats, MINORISH, INTERVALS, tick } = window.DSP;
const Instruments = window.Instruments;
const SR = 11025;
const $ = id => document.getElementById(id);
const els = {};
['file','dropzone','status','statusText','statusBar','srcBadge','trackName','nowMain','nowChord','nowRoman','nextChord','nextIn','nowShape',
 'instruments','play','time','keyName','tuning','timelineWrap','timeline','segs','playhead','ticks','liveStrip','transport',
 'copy','prog','cards','capoNote','shapes','detBasic','detExt','stab','trDown','trUp','trVal','capo','capoField','audio','drop']
 .forEach(id => els[id] = $(id));

const state = {
  mode: 'file', feat: null, key: null, tuning: 0, duration: 0, segments: [], file: null,
  detail: 'ext', stability: 0.8, transpose: 0, capo: 0, instrument: 'guitar',
  audioURL: null, activeIdx: -1, busy: false, liveTime: 0, syncing: false,
  fileBlob: null, songId: null, savedName: null, savedAt: null, ytUrl: null, autosave: false, autoLyrics: true
};
try { const s = JSON.parse(localStorage.getItem('av-settings') || '{}'); Object.assign(state, { detail: s.detail || 'ext', instrument: s.instrument || 'guitar', stability: s.stability || 0.8, autosave: !!s.autosave, autoLyrics: s.autoLyrics !== false }); } catch {}
function saveSettings() { try { localStorage.setItem('av-settings', JSON.stringify({ detail: state.detail, instrument: state.instrument, stability: state.stability, autosave: state.autosave, autoLyrics: state.autoLyrics })); } catch {} }

const tickFns = [];
const onTick = fn => tickFns.push(fn);
const now = () => state.mode === 'file' ? (els.audio.currentTime || 0) : state.liveTime;
const fmt = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };

/* ---------- namen ---------- */
function view() {
  const k = state.key, shift = state.transpose - (Instruments.hasCapo(state.instrument) ? state.capo : 0);
  const kr = k ? mod12(k.root + shift) : 0;
  return { shift, flats: k ? prefersFlats(kr, k.mode) : false, key: k };
}
const nameOf = (ch, v = view()) => chordName(ch, v);
const romanOf = ch => roman(ch, state.key);

/* ---------- weergave ---------- */
function renderFacts() {
  els.keyName.textContent = state.key ? keyName(state.key, state.transpose) : '–';
  if (state.feat) {
    els.tuning.textContent = 'A = ' + Math.round(440 * 2 ** (state.feat.tuning / 12)) + ' Hz';
    const cents = Math.round(state.feat.tuning * 100);
    els.tuning.title = (cents >= 0 ? '+' : '') + cents + ' cent t.o.v. A = 440 Hz';
    $('bpm').textContent = state.feat.bpm ? Math.round(state.feat.bpm) + ' bpm' : '–';
  } else { els.tuning.textContent = '–'; $('bpm').textContent = '–'; }
  els.trVal.textContent = (state.transpose > 0 ? '+' : '') + state.transpose;
  els.capoField.hidden = !Instruments.hasCapo(state.instrument);
}
function renderTimeline() {
  const v = view(), dur = state.duration || 1;
  els.segs.innerHTML = state.segments.map(g => {
    const w = (Math.min(g.end, dur) - g.start) / dur * 100;
    const cls = !g.chord ? 'nc' : MINORISH[g.chord.q] ? 'min' : '';
    return `<div class="seg ${cls}" style="width:${w}%;--h:${hueOf(g.chord)}" title="${nameOf(g.chord, v)} · ${fmt(g.start)}">${g.chord && w > 2.6 ? nameOf(g.chord, v) : ''}</div>`;
  }).join('');
  const steps = [5, 10, 15, 30, 60, 120], step = steps.find(s => dur / s <= 8) || 240;
  let tk = '';
  for (let t = 0; t < dur - step * 0.4; t += step) tk += `<span style="left:${t / dur * 100}%">${fmt(t)}</span>`;
  els.ticks.innerHTML = tk;
}
function renderCards() {
  const v = view();
  els.cards.innerHTML = state.segments.map((g, i) => {
    const cls = ['card', !g.chord ? 'nc' : MINORISH[g.chord.q] ? 'min' : '', g.chord && g.conf < 0.45 ? 'unsure' : '', i === state.activeIdx ? 'on' : ''].join(' ');
    return `<button class="${cls}" data-i="${i}" style="--h:${hueOf(g.chord)}"><span class="cname">${nameOf(g.chord, v)}</span><span class="cmeta"><span>${romanOf(g.chord)}</span><span class="mono">${fmt(g.start)}</span></span></button>`;
  }).join('');
  const seq = state.segments.filter(g => g.chord);
  const tonic = state.key ? state.key.root : 0, counts = new Map(); let best = null;
  for (let i = 0; i + 4 <= seq.length; i++) {
    const key = seq.slice(i, i + 4).map(g => g.chord.root + g.chord.q).join('|');
    const c = counts.get(key) || { n: 0, i, tonic: seq[i].chord.root === tonic }; c.n++; counts.set(key, c);
    if (!best || c.n > best.n || (c.n === best.n && c.tonic && !best.tonic)) best = c;
  }
  if (best && best.n >= 2) {
    const four = seq.slice(best.i, best.i + 4);
    els.prog.innerHTML = `Hoofdprogressie (${best.n}× gehoord): <b>${four.map(g => nameOf(g.chord, v)).join(' – ')}</b> &nbsp;<span class="mono small">${four.map(g => romanOf(g.chord)).join(' – ')}</span>`;
  } else els.prog.textContent = seq.length ? `${seq.length} akkoordwissels gevonden.` : (state.mode === 'file' ? 'Nog geen akkoorden gevonden.' : 'Nog niets gehoord. Start de bron hierboven.');
}
function renderShapes() {
  const v = view(), seen = new Map();
  for (const g of state.segments) if (g.chord) { const k = g.chord.root + g.chord.q; if (!seen.has(k)) seen.set(k, g.chord); }
  els.shapes.classList.toggle('piano', state.instrument === 'piano');
  els.shapes.innerHTML = Array.from(seen.values()).map(c => `<div class="shape"><b>${nameOf(c, v)}</b>${Instruments.render(state.instrument, c, { ...v, label: nameOf(c, v) })}</div>`).join('');
  const capoOn = Instruments.hasCapo(state.instrument) && state.capo > 0 && state.key;
  els.capoNote.hidden = !capoOn;
  if (capoOn) els.capoNote.textContent = `Capo op fret ${state.capo}: dit zijn de vormen die je speelt. Het klinkt in ${keyName(state.key, state.transpose)}.`;
}
function renderInstruments() {
  els.instruments.innerHTML = Instruments.LIST.map(i => `<button data-ins="${i.id}" aria-pressed="${i.id === state.instrument}">${i.name}</button>`).join('');
}
function renderAll() {
  renderFacts(); renderInstruments();
  if (state.mode === 'file') renderTimeline();
  renderCards(); renderShapes(); renderStrip();
  state.activeIdx = -1;
  updateNow(now(), true);
  document.dispatchEvent(new CustomEvent('av:render'));
}
function renderStrip() {
  if (state.mode === 'file') return;
  const v = view(), last = state.segments.slice(-12);
  els.liveStrip.innerHTML = last.map(g => `<div class="chip" style="--h:${hueOf(g.chord)}">${nameOf(g.chord, v)}<small>${fmt(g.start)}</small></div>`).join('');
  els.liveStrip.scrollLeft = els.liveStrip.scrollWidth;
}

function segAt(t) {
  const s = state.segments; let lo = 0, hi = s.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].start <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
let lastUserScroll = 0;
els.cards.addEventListener('wheel', () => lastUserScroll = Date.now(), { passive: true });
els.cards.addEventListener('touchmove', () => lastUserScroll = Date.now(), { passive: true });

function updateNow(t, force) {
  if (state.mode === 'file') {
    const dur = state.duration || 1;
    els.playhead.style.left = Math.min(100, t / dur * 100) + '%';
    els.timeline.setAttribute('aria-valuenow', Math.round(t / dur * 100));
    els.time.textContent = fmt(t) + ' / ' + fmt(state.duration);
  }
  for (const fn of tickFns) fn(t);
  const i = segAt(t), g = state.segments[i], nxt = state.segments[i + 1];
  if (nxt && state.mode === 'file') els.nextIn.textContent = 'over ' + Math.max(0, nxt.start - t).toFixed(1) + ' s';
  else els.nextIn.textContent = '';
  if (i === state.activeIdx && !force) return;
  state.activeIdx = i;
  const v = view();
  els.nowChord.textContent = g ? nameOf(g.chord, v) : '–';
  els.nowRoman.textContent = g ? romanOf(g.chord) : '';
  els.nowMain.style.setProperty('--h', hueOf(g ? g.chord : null));
  els.nowMain.classList.toggle('nc', !g || !g.chord);
  els.nextChord.textContent = nxt ? nameOf(nxt.chord, v) : '–';
  els.nowShape.innerHTML = g ? Instruments.render(state.instrument, g.chord, { ...v, label: nameOf(g.chord, v) }) : '';
  const prev = els.cards.querySelector('.card.on'); if (prev) prev.classList.remove('on');
  const card = els.cards.children[i];
  if (card) {
    card.classList.add('on');
    if (Date.now() - lastUserScroll > 3000) {
      const top = card.offsetTop, h = els.cards.clientHeight;
      if (top < els.cards.scrollTop || top > els.cards.scrollTop + h - 60) els.cards.scrollTo({ top: Math.max(0, top - 40), behavior: 'smooth' });
    }
  }
}

/* ---------- afspelen (bestand) ---------- */
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></svg>';
function syncPlayBtn() { const p = !els.audio.paused; els.play.innerHTML = p ? ICON_PAUSE : ICON_PLAY; els.play.setAttribute('aria-label', p ? 'Pauzeren' : 'Afspelen'); }
syncPlayBtn();
let raf = 0;
function loop() { if (state.mode === 'file') updateNow(els.audio.currentTime || 0, false); raf = els.audio.paused ? 0 : requestAnimationFrame(loop); }
els.audio.addEventListener('play', () => { syncPlayBtn(); if (!raf) raf = requestAnimationFrame(loop); });
els.audio.addEventListener('pause', syncPlayBtn);
els.audio.addEventListener('ended', syncPlayBtn);
els.audio.addEventListener('seeked', () => updateNow(els.audio.currentTime, false));
els.play.addEventListener('click', () => { if (els.audio.paused) els.audio.play().catch(() => {}); else els.audio.pause(); });
function seek(t) { if (state.mode !== 'file') return; els.audio.currentTime = Math.max(0, Math.min(state.duration - 0.05, t)); updateNow(els.audio.currentTime, false); }
els.timeline.addEventListener('click', e => { const r = els.timeline.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * state.duration); });
els.timeline.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') { seek(els.audio.currentTime + 5); e.preventDefault(); }
  if (e.key === 'ArrowLeft') { seek(els.audio.currentTime - 5); e.preventDefault(); }
});
els.cards.addEventListener('click', e => {
  const b = e.target.closest('.card'); if (!b || state.mode !== 'file') return;
  seek(state.segments[+b.dataset.i].start + 0.01);
  if (els.audio.paused) els.audio.play().catch(() => {});
});
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || state.syncing || state.mode !== 'file' || e.target.closest('button, input, select, textarea, [role="slider"]')) return;
  e.preventDefault(); els.play.click();
});

/* ---------- modus (bestand / youtube / luisteren) ---------- */
function setMode(m) {
  if (m === state.mode) return;
  if (state.mode === 'file') state.file = { feat: state.feat, key: state.key, segments: state.segments, duration: state.duration };
  if (m === 'file' && state.file) Object.assign(state, state.file);
  if (m !== 'file') { els.audio.pause(); if (state.mode === 'file') { state.segments = []; state.key = null; state.feat = null; } }
  state.mode = m;
  document.querySelectorAll('.modes [role="tab"]').forEach(b => b.setAttribute('aria-selected', b.dataset.mode === m));
  document.querySelectorAll('.source').forEach(s => s.hidden = s.dataset.mode !== m);
  els.timelineWrap.hidden = m !== 'file'; els.transport.hidden = m !== 'file'; els.liveStrip.hidden = m === 'file';
  if (m === 'file') { els.srcBadge.textContent = state.file && state.file.name ? 'Jouw liedje' : 'Voorbeeld'; els.trackName.textContent = state.file && state.file.name || 'Gesynthetiseerd voorbeeld'; }
  else { els.srcBadge.textContent = m === 'youtube' ? 'YouTube' : 'Microfoon'; els.trackName.textContent = m === 'youtube' ? 'Plak hierboven een link en start de video' : 'Start de microfoon om live mee te luisteren'; }
  renderAll();
  document.dispatchEvent(new CustomEvent('av:mode', { detail: m }));
}
document.querySelectorAll('.modes [role="tab"]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('.tabs [role="tab"]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs [role="tab"]').forEach(x => x.setAttribute('aria-selected', x === b));
  document.querySelectorAll('.panel[data-tab]').forEach(p => p.hidden = p.dataset.tab !== b.dataset.tab);
}));

/* ---------- live-invoer (aangeroepen vanuit live.js) ---------- */
function liveReset(label) {
  state.segments = []; state.key = null; state.feat = null; state.liveTime = 0; state.activeIdx = -1;
  state.songId = null; state.savedName = null; state.savedAt = null;
  els.srcBadge.textContent = 'Live'; els.trackName.textContent = label;
  renderAll();
}
function liveChord({ chord, conf, time }) {
  state.liveTime = time;
  const last = state.segments[state.segments.length - 1];
  if (last) last.end = time;
  state.segments.push({ start: time, end: Infinity, chord, conf });
  renderCards(); renderStrip(); renderShapes();
  updateNow(time, true);
  document.dispatchEvent(new CustomEvent('av:render'));
}
function liveKey(k) { state.key = k; renderFacts(); renderCards(); updateNow(state.liveTime, true); }
function liveTick(time) { state.liveTime = time; for (const fn of tickFns) fn(time); }

/* ---------- instellingen ---------- */
/* correcties van de gebruiker bewaren per liedje (naam + duur) */
const segKey = () => state.file && state.file.name ? 'av-seg:' + state.file.name : null;
function saveSegments() { const k = segKey(); if (!k) return; try { localStorage.setItem(k, JSON.stringify({ duration: state.duration, segments: state.segments })); } catch {} if (state.file) state.file.segments = state.segments; }
function storedSegments(name, duration) { try { const s = JSON.parse(localStorage.getItem('av-seg:' + name) || 'null'); return s && Math.abs(s.duration - duration) < 0.5 ? s.segments : null; } catch { return null; } }
function reanalyse() {
  if (state.feat) { state.segments = recognise(state.feat, { detail: state.detail, stability: state.stability, duration: state.duration }); const k = segKey(); if (k) { try { localStorage.removeItem(k); } catch {} } if (state.file) state.file.segments = state.segments; }
  renderAll();
}
const detBtns = { basic: els.detBasic, ext: els.detExt, full: $('detFull') };
function setDetail(d) {
  state.detail = d; saveSettings();
  for (const k in detBtns) detBtns[k].setAttribute('aria-pressed', k === d);
  document.dispatchEvent(new CustomEvent('av:detail', { detail: d }));
  reanalyse();
}
for (const k in detBtns) { detBtns[k].addEventListener('click', () => setDetail(k)); detBtns[k].setAttribute('aria-pressed', state.detail === k); }
els.stab.value = state.stability;
els.stab.addEventListener('input', () => { state.stability = +els.stab.value; saveSettings(); reanalyse(); });
els.trDown.addEventListener('click', () => { state.transpose = Math.max(-11, state.transpose - 1); renderAll(); });
els.trUp.addEventListener('click', () => { state.transpose = Math.min(11, state.transpose + 1); renderAll(); });
els.capo.innerHTML = Array.from({ length: 10 }, (_, i) => `<option value="${i}">${i === 0 ? 'Geen' : 'Fret ' + i}</option>`).join('');
els.capo.addEventListener('change', () => { state.capo = +els.capo.value; renderAll(); });
const autoOff = $('autoOff'), autoOn = $('autoOn');
function setAutosave(on) { state.autosave = on; saveSettings(); autoOff.setAttribute('aria-pressed', !on); autoOn.setAttribute('aria-pressed', on); }
autoOff.addEventListener('click', () => setAutosave(false));
autoOn.addEventListener('click', () => setAutosave(true));
setAutosave(state.autosave);
const lyrOff = $('lyrOff'), lyrOn = $('lyrOn');
function setAutoLyrics(on) { state.autoLyrics = on; saveSettings(); lyrOff.setAttribute('aria-pressed', !on); lyrOn.setAttribute('aria-pressed', on); }
lyrOff.addEventListener('click', () => setAutoLyrics(false));
lyrOn.addEventListener('click', () => setAutoLyrics(true));
setAutoLyrics(state.autoLyrics);
els.instruments.addEventListener('click', e => {
  const b = e.target.closest('[data-ins]'); if (!b) return;
  state.instrument = b.dataset.ins; saveSettings(); renderAll();
});
els.copy.addEventListener('click', () => {
  const v = view(), lines = [els.trackName.textContent, 'Toonsoort: ' + els.keyName.textContent];
  if (Instruments.hasCapo(state.instrument) && state.capo) lines.push('Capo: fret ' + state.capo);
  lines.push('');
  for (const g of state.segments) lines.push(fmt(g.start).padStart(5) + '  ' + nameOf(g.chord, v));
  copyText(lines.join('\n'), els.copy, 'Kopieer als tekst');
});
async function copyText(text, btn, restore) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Gekopieerd'; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); btn.textContent = 'Gekopieerd'; } catch { btn.textContent = 'Kopiëren lukte niet'; }
    ta.remove();
  }
  setTimeout(() => btn.textContent = restore, 1800);
}

/* ---------- bestand laden ---------- */
function setStatus(text, frac, err) {
  els.status.hidden = !text;
  els.status.classList.toggle('err', !!err);
  els.statusText.textContent = text || '';
  els.statusBar.parentElement.hidden = frac == null;
  if (frac != null) els.statusBar.style.width = Math.round(frac * 100) + '%';
}
async function decode(ab) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return await new Ctx(1, 1, 44100).decodeAudioData(ab);
}
async function toMono(buf) {
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * SR)), SR);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}
/* kenmerken in een Web Worker berekenen (valt terug op de hoofdthread als dat niet kan) */
function runExtract(x, sr, progress) {
  if (!window.Worker) return extractFeatures(x, sr, { progress });
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker('js/worker.js'); } catch { return extractFeatures(x, sr, { progress }).then(resolve, reject); }
    w.onmessage = e => { const d = e.data; if (d.type === 'progress') progress(d.p); else if (d.type === 'done') { w.terminate(); resolve(d.feat); } else { w.terminate(); reject(new Error(d.message)); } };
    w.onerror = () => { w.terminate(); extractFeatures(x, sr, { progress }).then(resolve, reject); };
    w.postMessage({ x, sr }, [x.buffer]);
  });
}
async function analyseBuffer(buf, name) {
  state.duration = buf.duration;
  setStatus('Geluid omzetten…', 0.05);
  const x = await toMono(buf);
  const feat = await runExtract(x, SR, f => setStatus('Akkoorden zoeken…', f));
  state.feat = feat; state.key = feat.key;
  state.segments = (name && storedSegments(name, state.duration)) || recognise(feat, { detail: state.detail, stability: state.stability, duration: state.duration });
  state.file = { feat, key: feat.key, segments: state.segments, duration: state.duration, name };
  renderAll();
  setStatus('');
  document.dispatchEvent(new CustomEvent('av:track', { detail: name }));
  if (name) document.dispatchEvent(new CustomEvent('av:analysed', { detail: name }));
}
/* opgeslagen liedje openen zonder opnieuw te analyseren */
async function loadRecord(meta, blob) {
  els.audio.pause();
  state.songId = meta.id; state.transpose = 0; state.meta = {};
  if (meta.kind === 'file' && blob) {
    if (state.audioURL) URL.revokeObjectURL(state.audioURL);
    state.audioURL = URL.createObjectURL(blob); els.audio.src = state.audioURL; state.fileBlob = blob;
    state.file = { feat: meta.feat, key: meta.key, segments: meta.segments, duration: meta.duration, name: meta.name };
    if (state.mode !== 'file') setMode('file'); else { Object.assign(state, state.file); renderAll(); }
    els.srcBadge.textContent = 'Opgeslagen'; els.trackName.textContent = meta.name;
  } else {
    setMode(meta.ytUrl ? 'youtube' : 'live');
    state.segments = meta.segments; state.key = meta.key; state.liveTime = meta.duration; state.ytUrl = meta.ytUrl;
    els.srcBadge.textContent = 'Opgeslagen'; els.trackName.textContent = meta.name;
    renderAll();
    if (meta.ytUrl) document.dispatchEvent(new CustomEvent('av:open-yt', { detail: meta.ytUrl }));
  }
  document.dispatchEvent(new CustomEvent('av:track', { detail: meta.name }));
}
async function loadFile(file) {
  if (!file || state.busy) return;
  state.busy = true; els.audio.pause();
  if (state.mode !== 'file') setMode('file');
  try {
    setStatus('Bestand lezen…', 0.02);
    const ab = await file.arrayBuffer();
    try { state.meta = window.ID3 ? window.ID3.read(ab) : {}; } catch { state.meta = {}; }
    const buf = await decode(ab);
    if (state.audioURL) URL.revokeObjectURL(state.audioURL);
    state.audioURL = URL.createObjectURL(file);
    els.audio.src = state.audioURL;
    const name = file.name.replace(/\.[^.]+$/, '');
    els.srcBadge.textContent = 'Jouw liedje'; els.trackName.textContent = name;
    state.transpose = 0; state.fileBlob = file; state.songId = null; state.savedName = null; state.savedAt = null;
    await analyseBuffer(buf, name);
  } catch (e) {
    console.error(e);
    setStatus('Dit bestand kon niet worden gelezen. Probeer een mp3-, wav- of m4a-bestand.', null, true);
  } finally { state.busy = false; els.file.value = ''; }
}
els.file.addEventListener('change', () => loadFile(els.file.files[0]));
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { dragDepth++; els.drop.hidden = false; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) els.drop.hidden = true; });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; els.drop.hidden = true; const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

/* ---------- voorbeeld bij openen ---------- */
function synthDemo() {
  const sr = 22050, beat = 0.6, bar = 4 * beat;
  const prog = [[0,'maj'],[7,'maj'],[9,'min'],[5,'maj'],[0,'maj'],[7,'maj'],[5,'maj'],[0,'maj']];
  const out = new Float32Array(Math.ceil((prog.length * bar + 1) * sr));
  const note = (midi, t0, dur, amp, decay, harms) => {
    const f = 440 * 2 ** ((midi - 69) / 12), i0 = Math.floor(t0 * sr), i1 = Math.min(out.length, Math.floor((t0 + dur) * sr));
    for (let i = i0; i < i1; i++) {
      const tt = (i - i0) / sr, env = Math.min(1, tt / 0.004) * Math.exp(-tt * decay) * Math.min(1, (i1 - i) / (0.03 * sr));
      let s = 0; for (let h = 1; h <= harms; h++) s += Math.sin(2 * Math.PI * f * h * tt) / (h ** 1.3);
      out[i] += amp * env * s;
    }
  };
  prog.forEach(([root, q], b) => {
    const t0 = b * bar, tones = INTERVALS[q].map(iv => { let m = 48 + (root + iv) % 12; while (m < 52) m += 12; return m; });
    tones.push(tones[0] + 12);
    for (let k = 0; k < 4; k++) tones.forEach((m, j) => note(m, t0 + k * beat + j * 0.012, beat * 1.1, k === 0 ? 0.11 : 0.08, 3.2, 6));
    let bm = 36 + root; if (bm > 43) bm -= 12;
    note(bm, t0, beat * 2, 0.22, 1.6, 3); note(bm, t0 + 2 * beat, beat * 2, 0.2, 1.6, 3);
  });
  let peak = 0; for (const s of out) peak = Math.max(peak, Math.abs(s));
  for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
  return { samples: out, sr };
}
function wavBlob(samples, sr) {
  const buf = new ArrayBuffer(44 + samples.length * 2), dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([buf], { type: 'audio/wav' });
}
async function loadDemo() {
  state.busy = true;
  try {
    setStatus('Voorbeeld voorbereiden…', 0.02); await tick();
    const { samples, sr } = synthDemo();
    state.audioURL = URL.createObjectURL(wavBlob(samples, sr));
    els.audio.src = state.audioURL;
    const ab = new AudioBuffer({ length: samples.length, sampleRate: sr, numberOfChannels: 1 });
    ab.copyToChannel(samples, 0);
    els.trackName.textContent = 'Gesynthetiseerd voorbeeld';
    await analyseBuffer(ab, null);
  } catch (e) { console.error(e); setStatus('Het voorbeeld kon niet worden geladen. Kies hierboven een eigen liedje.', null, true); }
  finally { state.busy = false; }
}

/* ---------- akkoord-popup: zo speel je dit akkoord, op elk instrument ---------- */
const pop = { box: $('chordPop'), name: $('popName'), grid: $('popGrid'), close: $('popClose'), back: $('popBack'), edit: $('popEdit'), root: $('edRoot'), qual: $('edQual') };
let editIdx = -1;
function showChord(ch, label, idx) {
  const v = view();
  editIdx = typeof idx === 'number' ? idx : -1;
  pop.edit.hidden = editIdx < 0;
  if (editIdx >= 0) {
    const names = v.flats ? window.DSP.FLAT : window.DSP.SHARP;
    pop.root.innerHTML = names.map((nm, i) => `<option value="${i}">${nm}</option>`).join('');
    pop.qual.innerHTML = window.DSP.QUALS.full.map(q => `<option value="${q}">${window.DSP.SUFFIX[q] || 'majeur'}</option>`).join('');
    if (ch) { pop.root.value = mod12(ch.root + v.shift); pop.qual.value = ch.q; }
  }
  if (!ch) { pop.name.textContent = 'N.C.'; pop.grid.innerHTML = '<p class="hint">Geen akkoord (stilte of alleen ritme). Kies hieronder een akkoord als dat niet klopt.</p>'; pop.box.hidden = false; pop.back.hidden = false; return; }
  const name = label || nameOf(ch, v);
  pop.name.textContent = name;
  pop.grid.innerHTML = Instruments.LIST.map(i => `<div class="shape"><span class="lbl">${i.name}</span>${Instruments.render(i.id, ch, { ...v, label: name })}</div>`).join('');
  pop.box.hidden = false; pop.back.hidden = false;
}
/* correcties: akkoord wijzigen, samenvoegen, begin verschuiven */
function applyEdit(kind) {
  const i = editIdx, segs = state.segments, g = segs[i]; if (!g) return;
  const v = view();
  if (kind === 'set') g.chord = { root: mod12(+pop.root.value - v.shift), q: pop.qual.value, bass: null };
  else if (kind === 'nc') g.chord = null;
  else if (kind === 'prev' && i > 0) { segs[i - 1].end = g.end; segs.splice(i, 1); }
  else if (kind === 'next' && i < segs.length - 1) { segs[i + 1].start = g.start; segs.splice(i, 1); }
  else if (kind === 'earlier' || kind === 'later') {
    const d = kind === 'earlier' ? -0.2 : 0.2, lo = i > 0 ? segs[i - 1].start + 0.2 : 0, hi = g.end - 0.2;
    const ns = Math.max(lo, Math.min(hi, g.start + d));
    if (i > 0) segs[i - 1].end = ns; g.start = ns;
  }
  if (g.conf != null) g.conf = 1;
  saveSegments(); renderAll(); hidePop();
}
document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => applyEdit(b.dataset.edit)));
const NAME_IDX = {}; window.DSP.SHARP.forEach((x, i) => NAME_IDX[x] = i); window.DSP.FLAT.forEach((x, i) => NAME_IDX[x] = i);
function showChordByName(name) {
  const m = String(name).match(/^([A-G](?:#|b)?)(.*)$/); if (!m) return;
  const rest = m[2].replace(/\/.*$/, ''), v = view();
  const q = /m7/.test(rest) ? 'm7' : /^m(?!aj)/.test(rest) ? 'min' : /7/.test(rest) ? '7' : 'maj';
  showChord({ root: mod12(NAME_IDX[m[1]] - v.shift), q }, name);
}
const hidePop = () => { pop.box.hidden = true; pop.back.hidden = true; };
pop.close.addEventListener('click', hidePop); pop.back.addEventListener('click', hidePop);
document.addEventListener('keydown', e => { if (e.key === 'Escape') hidePop(); });
els.nowMain.addEventListener('click', () => { const g = state.segments[state.activeIdx]; if (g) showChord(g.chord, null, state.activeIdx); });
els.cards.addEventListener('contextmenu', e => { const b = e.target.closest('.card'); if (b) { e.preventDefault(); showChord(state.segments[+b.dataset.i].chord, null, +b.dataset.i); } });
els.shapes.addEventListener('click', e => { const s = e.target.closest('.shape'); if (!s) return; showChordByName(s.querySelector('b').textContent); });
let cardPress = 0, cardPressed = false;
els.cards.addEventListener('pointerdown', e => {
  const b = e.target.closest('.card'); if (!b) return;
  cardPressed = false; clearTimeout(cardPress);
  cardPress = setTimeout(() => { cardPressed = true; if (navigator.vibrate) navigator.vibrate(30); showChord(state.segments[+b.dataset.i].chord, null, +b.dataset.i); }, 550);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => els.cards.addEventListener(ev, () => clearTimeout(cardPress)));
els.cards.addEventListener('click', e => { if (cardPressed) { cardPressed = false; e.stopImmediatePropagation(); return; } const b = e.target.closest('.card'); if (b && state.mode !== 'file') showChord(state.segments[+b.dataset.i].chord, null, +b.dataset.i); }, true);

/* ---------- start ---------- */
renderInstruments(); renderFacts();
loadDemo();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const had = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.register('sw.js').then(reg => { reg.update().catch(() => {}); setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000); }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !reloaded) { reloaded = true; location.reload(); } });
}

return { state, els, view, nameOf, romanOf, fmt, now, onTick, seek, setMode, setStatus, copyText, renderAll, loadRecord, liveReset, liveChord, liveKey, liveTick, showChord, showChordByName };
})();
