/* lyrics.js — akkoordenblad: tekst (met of zonder eigen akkoordregels en [kopjes]) ontleden,
   per regel synchroniseren, akkoorden boven de woorden zetten en transponeren. */
window.Lyrics = (() => {
'use strict';
const { SHARP, FLAT, mod12 } = window.DSP;
const NOTE = '[A-G](?:#|b)?';
const CHORD_RE = new RegExp('^' + NOTE + '(?:maj|min|dim|aug|sus|add|m|M|\\+|°|ø)?[0-9]*(?:(?:maj|sus|add|dim|aug|b|#|\\+|-)[0-9]*)*(?:\\/' + NOTE + ')?$');
const isChordToken = t => t === 'N.C.' || t === 'NC' || CHORD_RE.test(t);
const isChordLine = s => { const toks = s.trim().split(/\s+/); return toks.every(isChordToken) && toks.some(t => /^[A-G]/.test(t)); };
const isSection = s => /^\s*\[[^\]]+\]\s*(\(.*\))?\s*$/.test(s);
const kindOf = l => l.kind || (l.blank ? 'blank' : 'text');

/* tekst -> regels. Een regel met alleen akkoorden hoort bij de tekstregel eronder. */
function parse(text) {
  const raw = text.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, ''));
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i];
    if (l.trim() === '') { lines.push({ text: '', t: null, blank: true, kind: 'blank' }); continue; }
    if (isSection(l)) { lines.push({ text: l.trim(), t: null, blank: false, kind: 'section' }); continue; }
    if (isChordLine(l)) {
      const next = raw[i + 1];
      if (next && next.trim() !== '' && !isSection(next) && !isChordLine(next)) { lines.push({ text: next, t: null, blank: false, kind: 'text', manual: l }); i++; }
      else lines.push({ text: '', t: null, blank: false, kind: 'text', manual: l });
      continue;
    }
    lines.push({ text: l, t: null, blank: false, kind: 'text', manual: null });
  }
  return lines;
}
/* LRC (gesynchroniseerde songtekst, "[mm:ss.xx] regel") -> regels met tijd */
function parseLRC(lrc) {
  const entries = [];
  for (const raw of lrc.replace(/\r/g, '').split('\n')) {
    const m = raw.match(/^((?:\[\d+:\d+(?:\.\d+)?\])+)\s?(.*)$/);
    if (!m) continue;
    const text = m[2].trim();
    for (const x of m[1].matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)) entries.push({ t: +x[1] * 60 + +x[2], text });
  }
  return fromEntries(entries);
}
/* [{t, text}] (LRC, SYLT, ...) -> regels; lege tekst = witregel */
function fromEntries(entries) {
  const sorted = entries.filter(e => typeof e.t === 'number' && !isNaN(e.t)).sort((a, b) => a.t - b.t);
  const lines = [];
  for (const e of sorted) {
    const text = String(e.text || '').trim();
    if (!text) { if (lines.length && kindOf(lines[lines.length - 1]) !== 'blank') lines.push({ text: '', t: null, blank: true, kind: 'blank' }); continue; }
    lines.push({ text, t: e.t, blank: false, kind: 'text', manual: null });
  }
  return lines;
}
/* tekst van onbekend formaat: LRC als er tijdstempels in staan, anders gewone tekst / akkoordenblad */
function parseAny(text) { return /\[\d+:\d+(?:\.\d+)?\]/.test(text) ? parseLRC(text) : parse(text); }

/* bestandsnaam -> { artist, title } ("Artiest - Titel.mp3", "01 - Titel (Official Video).m4a", ...) */
function guessFromName(name) {
  let s = String(name || '').replace(/\.[^.]+$/, '').replace(/_+/g, ' ');
  s = s.replace(/\((official|official\s+\w+|lyric\w*|video|audio|hd|hq|remaster\w*|live|clip|visuali[sz]er)[^)]*\)/gi, '').replace(/\[[^\]]*\]/g, '');
  s = s.replace(/\b(official\s+(music\s+)?video|lyrics?\s+video|official\s+audio|hd|hq)\b/gi, '');
  s = s.replace(/^\s*\d{1,2}[\s.\-–]+/, '').replace(/\s+/g, ' ').trim();
  const parts = s.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: s };
}

/* regels -> tekst zoals je die plakt (voor bewerken) */
function toSource(lines) {
  return lines.map(l => kindOf(l) === 'blank' ? '' : l.manual != null ? (l.text ? l.manual + '\n' + l.text : l.manual) : l.text).join('\n');
}

/* akkoordnaam transponeren: C#m7/E -> ... */
const IDX = {}; SHARP.forEach((n, i) => IDX[n] = i); FLAT.forEach((n, i) => IDX[n] = i);
function transposeToken(tok, shift, flats) {
  if (!shift) return tok;
  const m = tok.match(/^([A-G](?:#|b)?)(.*?)(?:\/([A-G](?:#|b)?))?$/);
  if (!m) return tok;
  const names = flats ? FLAT : SHARP;
  const root = names[mod12(IDX[m[1]] + shift)], bass = m[3] ? '/' + names[mod12(IDX[m[3]] + shift)] : '';
  return root + m[2] + bass;
}
function transposeRow(row, shift, flats) { return row.replace(/\S+/g, t => transposeToken(t, shift, flats)); }

/* regels + akkoordsegmenten -> rijen met akkoordregel boven de tekstregel */
function placeChords(lines, segments, nameFn, { shift = 0, flats = false } = {}) {
  const synced = lines.filter(l => kindOf(l) === 'text' && l.t != null).sort((a, b) => a.t - b.t);
  const chordAt = t => { let c = null; for (const s of segments) { if (s.start <= t) c = s.chord; else break; } return c; };
  return lines.map((line, idx) => {
    const kind = kindOf(line);
    if (kind === 'blank') return { idx, kind, text: '', chordRow: '', t: null };
    if (kind === 'section') return { idx, kind, text: line.text, chordRow: '', t: null };
    if (line.manual != null) return { idx, kind, text: line.text, chordRow: transposeRow(line.manual, shift, flats), t: line.t, manual: true };
    if (line.t == null) return { idx, kind, text: line.text, chordRow: '', t: null };
    const pos = synced.indexOf(line), next = synced[pos + 1], t0 = line.t, t1 = next ? next.t : t0 + 4;
    const len = Math.max(line.text.length, 1), cells = [];
    const sounding = chordAt(t0);
    if (sounding) cells.push({ at: 0, name: nameFn(sounding) });
    for (const s of segments) {
      if (s.start <= t0 || s.start >= t1 || !s.chord) continue;
      cells.push({ at: Math.min(len - 1, Math.round((s.start - t0) / (t1 - t0) * len)), name: nameFn(s.chord) });
    }
    let row = '', cursor = 0;
    for (const c of cells) { const at = Math.max(c.at, cursor); row += ' '.repeat(at - row.length) + c.name; cursor = row.length + 1; }
    return { idx, kind, text: line.text, chordRow: row, t: t0 };
  });
}

const escape = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* rijen -> HTML; activeIdx = regel die nu klinkt */
function renderHTML(rows, activeIdx) {
  return rows.map(r => {
    if (r.kind === 'blank') return '<div class="ly-gap"></div>';
    if (r.kind === 'section') return `<div class="ly-section">${escape(r.text)}</div>`;
    const cls = ['ly-line', r.t == null && !r.manual ? 'unsynced' : '', r.idx === activeIdx ? 'active' : ''].join(' ');
    const chords = r.chordRow ? `<div class="ly-chords">${escape(r.chordRow).replace(/(\S+)/g, '<b>$1</b>')}</div>` : '';
    const text = r.text ? `<div class="ly-text">${escape(r.text)}</div>` : '';
    return `<div class="${cls}" data-idx="${r.idx}">${chords}${text}</div>`;
  }).join('');
}

/* platte tekst (akkoordregel boven tekstregel) */
function toText(rows) {
  return rows.map(r => r.kind === 'blank' ? '' : r.kind === 'section' ? r.text : [r.chordRow, r.text].filter(Boolean).join('\n')).join('\n');
}

/* index van de tekstregel die op tijdstip t klinkt */
function activeIndex(lines, t) {
  let best = -1, bt = -1;
  lines.forEach((l, i) => { if (kindOf(l) === 'text' && l.t != null && l.t <= t && l.t >= bt) { bt = l.t; best = i; } });
  return best;
}

return { parse, parseLRC, parseAny, fromEntries, guessFromName, toSource, placeChords, renderHTML, toText, activeIndex, kindOf, transposeToken };
})();
