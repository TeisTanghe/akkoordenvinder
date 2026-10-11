/* id3.js — minimale ID3v2.3/2.4-lezer: titel (TIT2), artiest (TPE1), tekst (USLT) en gesynchroniseerde tekst (SYLT). */
window.ID3 = (() => {
'use strict';
const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const wide = enc => enc === 1 || enc === 2;
function decodeText(bytes, enc) {
  try {
    if (enc === 0) return new TextDecoder('iso-8859-1').decode(bytes);
    if (enc === 3) return new TextDecoder('utf-8').decode(bytes);
    if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
    if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    return new TextDecoder('utf-16le').decode(bytes);
  } catch { return ''; }
}
function findNull(b, start, enc) {
  if (wide(enc)) { for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return [i, 2]; return [b.length, 0]; }
  for (let i = start; i < b.length; i++) if (b[i] === 0) return [i, 1];
  return [b.length, 0];
}
function unsync(d) { const o = []; for (let i = 0; i < d.length; i++) { o.push(d[i]); if (d[i] === 0xFF && d[i + 1] === 0x00) i++; } return Uint8Array.from(o); }
const clean = s => s.replace(/\0+$/g, '').trim();

function read(ab) {
  const b = new Uint8Array(ab), out = { title: '', artist: '', lyrics: '', synced: null };
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return out;
  const ver = b[3], flags = b[5], size = syncsafe(b, 6);
  if (ver < 3 || ver > 4) return out;
  let p = 10; const end = Math.min(b.length, 10 + size);
  if (flags & 0x40) p += ver === 4 ? syncsafe(b, 10) : u32(b, 10) + 4;
  while (p + 10 <= end) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fsize = ver === 4 ? syncsafe(b, p + 4) : u32(b, p + 4), fflags = (b[p + 8] << 8) | b[p + 9];
    if (fsize <= 0 || p + 10 + fsize > end + 1) break;
    let data = b.subarray(p + 10, p + 10 + fsize);
    p += 10 + fsize;
    if (ver === 4 && (fflags & 0x0C)) continue;                 // gecomprimeerd of versleuteld: overslaan
    if (ver === 3 && (fflags & 0xC0)) continue;
    if (ver === 4 && (fflags & 0x01)) data = data.subarray(4);  // data length indicator
    if ((ver === 4 && (fflags & 0x02)) || (ver === 3 && (flags & 0x80))) data = unsync(data);
    if (!data.length) continue;
    if (id === 'TIT2' || id === 'TPE1') {
      const t = clean(decodeText(data.subarray(1), data[0]));
      if (id === 'TIT2') out.title = t; else out.artist = t;
    } else if (id === 'USLT' && data.length > 4) {
      const enc = data[0], [i, n] = findNull(data, 4, enc);
      if (!out.lyrics) out.lyrics = clean(decodeText(data.subarray(i + n), enc));
    } else if (id === 'SYLT' && data.length > 6) {
      const enc = data[0], fmt = data[4], [i, n] = findNull(data, 6, enc);
      let q = i + n; const entries = [];
      while (q < data.length) {
        const [j, m] = findNull(data, q, enc);
        const text = decodeText(data.subarray(q, j), enc).replace(/^\n/, '').trim();
        q = j + m; if (q + 4 > data.length) break;
        const ts = u32(data, q); q += 4;
        entries.push({ t: fmt === 2 ? ts / 1000 : ts, text });
      }
      if (entries.length && !out.synced) out.synced = entries;
    }
  }
  return out;
}
return { read };
})();
