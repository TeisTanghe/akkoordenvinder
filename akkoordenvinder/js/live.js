/* live.js — microfoon, YouTube (meeluisteren) en tabblad-audio als bron. */
(() => {
'use strict';
const App = window.App, { LiveDetector } = window.DSP;
const $ = id => document.getElementById(id);
const TARGET_SR = 12000;
let ctx = null, stream = null, node = null, src = null, det = null, active = null;
const ui = {
  live: { ind: $('liveInd'), meter: $('liveMeter'), start: $('liveStart'), stop: $('liveStop') },
  youtube: { ind: $('ytInd'), meter: $('ytMeter'), start: $('ytListen'), tab: $('ytTab'), stop: $('ytStop') }
};

function setUI(group, on) {
  const u = ui[group]; if (!u) return;
  u.ind.hidden = !on; u.meter.hidden = !on; u.stop.hidden = !on;
  u.ind.classList.toggle('on', on);
  if (u.start) u.start.hidden = on && group === 'live';
}

async function start(kind, group, label) {
  stop();
  try {
    if (kind === 'tab') {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw Object.assign(new Error(), { name: 'Unsupported' });
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      if (!stream.getAudioTracks().length) { stream.getTracks().forEach(t => t.stop()); throw Object.assign(new Error(), { name: 'NoAudio' }); }
    } else {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error(), { name: 'Unsupported' });
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
    }
  } catch (e) {
    const msg = e.name === 'NotAllowedError' ? 'Toegang tot de microfoon is geweigerd. Sta het toe in de browserinstellingen en probeer opnieuw.'
      : e.name === 'NoAudio' ? 'Er werd geen geluid gedeeld. Kies het tabblad met de video en zet "Audio van tabblad delen" aan.'
      : e.name === 'Unsupported' ? 'Deze browser ondersteunt dit niet. Gebruik Chrome, Edge of Safari (microfoon), of Chrome/Edge op een computer (tabblad-audio).'
      : 'De bron kon niet worden gestart.';
    App.setStatus(msg, null, true);
    return;
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  const sr = ctx.sampleRate, factor = Math.max(1, Math.round(sr / TARGET_SR)), dsr = sr / factor;
  det = new LiveDetector({ sr: dsr, n: 4096, hop: 1024, detail: App.state.detail, onChord: App.liveChord, onKey: App.liveKey });
  src = ctx.createMediaStreamSource(stream);
  node = ctx.createScriptProcessor(4096, 1, 1);
  let acc = 0, cnt = 0, level = 0;
  const meter = ui[group].meter.firstElementChild;
  node.onaudioprocess = e => {
    const inp = e.inputBuffer.getChannelData(0), out = new Float32Array(Math.ceil(inp.length / factor));
    let o = 0, peak = 0;
    for (let i = 0; i < inp.length; i++) {
      acc += inp[i]; cnt++; const a = Math.abs(inp[i]); if (a > peak) peak = a;
      if (cnt === factor) { out[o++] = acc / factor; acc = 0; cnt = 0; }
    }
    det.push(o === out.length ? out : out.subarray(0, o));
    level = Math.max(peak, level * 0.8);
    meter.style.width = Math.min(100, level * 140) + '%';
    App.liveTick(det.samples / det.sr);
  };
  src.connect(node); node.connect(ctx.destination); // de node geeft stilte door, dus geen rondzingen
  stream.getAudioTracks()[0].addEventListener('ended', stop);
  active = group;
  App.setStatus('');
  App.liveReset(label);
  setUI(group, true);
}
function stop() {
  if (!active) return;
  try { node && node.disconnect(); src && src.disconnect(); } catch {}
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (ctx) ctx.close().catch(() => {});
  node = src = stream = ctx = det = null;
  setUI(active, false);
  active = null;
}
document.addEventListener('av:detail', e => det && det.setDetail(e.detail));
document.addEventListener('av:mode', stop);

/* microfoon-modus */
ui.live.start.addEventListener('click', () => start('mic', 'live', 'Microfoon'));
ui.live.stop.addEventListener('click', stop);

/* youtube-modus */
const form = $('ytForm'), input = $('ytUrl'), player = $('ytPlayer');
function videoId(url) {
  const m = String(url).match(/(?:v=|\/(?:embed|shorts|v|live)\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}
form.addEventListener('submit', e => {
  e.preventDefault();
  const id = videoId(input.value.trim());
  if (!id) { App.setStatus('Dit lijkt geen YouTube-link. Plak een link zoals https://youtu.be/… of https://www.youtube.com/watch?v=…', null, true); return; }
  App.setStatus('');
  player.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1" title="YouTube-video" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  player.hidden = false;
  ui.youtube.start.hidden = false;
  ui.youtube.tab.hidden = !(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) || /Android|iPhone|iPad/i.test(navigator.userAgent);
  try { localStorage.setItem('av-yt', input.value.trim()); } catch {}
  App.els.trackName.textContent = 'YouTube ' + id;
});
ui.youtube.start.addEventListener('click', () => start('mic', 'youtube', 'YouTube via microfoon'));
ui.youtube.tab.addEventListener('click', () => start('tab', 'youtube', 'YouTube via tabblad-audio'));
ui.youtube.stop.addEventListener('click', stop);
try { const last = localStorage.getItem('av-yt'); if (last) input.value = last; } catch {}
})();
