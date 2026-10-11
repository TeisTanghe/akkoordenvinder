/* lyrics.js — songtekst synchroniseren (tik per regel) en akkoorden boven de woorden zetten. */
window.Lyrics = (() => {
'use strict';

/* tekst -> regels; lege regel = witregel tussen coupletten */
function parse(text) {
  return text.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).map(l => ({ text: l, t: null, blank: l.trim() === '' }));
}

/* regels + akkoordsegmenten -> rijen met akkoordregel boven de tekstregel */
function placeChords(lines, segments, nameFn) {
  const synced = lines.filter(l => !l.blank && l.t != null).sort((a, b) => a.t - b.t);
  const chordAt = t => { let c = null; for (const s of segments) { if (s.start <= t) c = s.chord; else break; } return c; };
  return lines.map((line, idx) => {
    if (line.blank) return { idx, blank: true, text: '', chordRow: '', t: null };
    if (line.t == null) return { idx, blank: false, text: line.text, chordRow: '', t: null };
    const pos = synced.indexOf(line);
    const next = synced[pos + 1], t0 = line.t, t1 = next ? next.t : t0 + 4;
    const len = Math.max(line.text.length, 1), cells = [];
    const sounding = chordAt(t0);
    if (sounding) cells.push({ at: 0, name: nameFn(sounding) });
    for (const s of segments) {
      if (s.start <= t0 || s.start >= t1 || !s.chord) continue;
      cells.push({ at: Math.min(len - 1, Math.round((s.start - t0) / (t1 - t0) * len)), name: nameFn(s.chord) });
    }
    let row = '', cursor = 0;
    for (const c of cells) {
      const at = Math.max(c.at, cursor);
      row += ' '.repeat(at - row.length) + c.name;
      cursor = row.length + 1;
    }
    return { idx, blank: false, text: line.text, chordRow: row, t: t0 };
  });
}

function escape(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

/* rijen -> HTML; activeIdx = regel die nu klinkt */
function renderHTML(rows, activeIdx) {
  return rows.map(r => {
    if (r.blank) return '<div class="ly-gap"></div>';
    const cls = ['ly-line', r.t == null ? 'unsynced' : '', r.idx === activeIdx ? 'active' : ''].join(' ');
    const chords = r.chordRow ? `<div class="ly-chords">${escape(r.chordRow).replace(/(\S+)/g, '<b>$1</b>')}</div>` : '<div class="ly-chords empty"></div>';
    return `<div class="${cls}" data-idx="${r.idx}">${chords}<div class="ly-text">${escape(r.text)}</div></div>`;
  }).join('');
}

/* platte tekst (akkoordregel boven tekstregel) */
function toText(rows) {
  return rows.map(r => r.blank ? '' : (r.chordRow ? r.chordRow + '\n' : '') + r.text).join('\n');
}

/* ChordPro-notatie: [C]tekst */
function toChordPro(rows) {
  return rows.map(r => {
    if (r.blank) return '';
    if (!r.chordRow) return r.text;
    let out = '', text = r.text, i = 0;
    const re = /\S+/g; let m;
    const marks = [];
    while ((m = re.exec(r.chordRow))) marks.push({ at: m.index, name: m[0] });
    for (const mk of marks) { const at = Math.min(mk.at, text.length); out += text.slice(i, at) + '[' + mk.name + ']'; i = at; }
    return out + text.slice(i);
  }).join('\n');
}

/* index van de regel die op tijdstip t klinkt */
function activeIndex(lines, t) {
  let best = -1, bt = -1;
  lines.forEach((l, i) => { if (!l.blank && l.t != null && l.t <= t && l.t >= bt) { bt = l.t; best = i; } });
  return best;
}

return { parse, placeChords, renderHTML, toText, toChordPro, activeIndex };
})();
