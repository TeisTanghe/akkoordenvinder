/* worker.js — kenmerken berekenen buiten de hoofdthread, zodat de app bedienbaar blijft tijdens de analyse. */
importScripts('dsp.js');
self.onmessage = async e => {
  const { x, sr } = e.data;
  try {
    const feat = await self.DSP.extractFeatures(x, sr, { progress: p => self.postMessage({ type: 'progress', p }) });
    self.postMessage({ type: 'done', feat });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
