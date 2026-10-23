"use strict";

/**
 * Speech leveler for TTS output going down the phone line (added 24 Sep 2026).
 *
 * Why: the Taglish Piper voice trails off at the end of each sentence --
 * measured 3-9 dB quieter on the last word ("...itong pa-book?"), which is
 * exactly the word callers could not hear. A single fixed gain
 * (piperVolumeDb) cannot fix that, because the problem is the loudness
 * *changing* within the sentence. This is a small automatic gain control:
 * it follows the loudness in short windows and lifts the quiet parts toward
 * a target level, leaving silence alone, then a limiter stops clipping.
 *
 * Input/output: Int16Array PCM (any sample rate).
 */
function levelSpeech(pcm, sampleRate, opts = {}) {
  const targetDb = opts.targetDb ?? -18;      // dBFS the speech is lifted toward
  const maxBoostDb = opts.maxBoostDb ?? 12;   // never lift a window more than this
  const maxCutDb = opts.maxCutDb ?? 6;        // and never cut more than this
  const gateDb = opts.gateDb ?? -45;          // below this = silence/breath, left alone
  const windowMs = opts.windowMs ?? 30;
  const attackMs = opts.attackMs ?? 40;       // how fast gain comes down on loud parts
  const releaseMs = opts.releaseMs ?? 150;    // how fast it rises on quiet parts
  const ceiling = opts.ceiling ?? 0.89;       // limiter, about -1 dBFS

  if (!pcm?.length) return pcm;
  const win = Math.max(1, Math.round(sampleRate * windowMs / 1000));
  const nWin = Math.ceil(pcm.length / win);
  const winMs = (win / sampleRate) * 1000;
  const aAtk = Math.exp(-winMs / attackMs);
  const aRel = Math.exp(-winMs / releaseMs);

  // Per-window desired gain (in dB), smoothed so it does not "pump".
  const gains = new Float32Array(nWin);
  let g = 0;
  for (let w = 0; w < nWin; w++) {
    let sum = 0;
    const start = w * win;
    const end = Math.min(pcm.length, start + win);
    for (let i = start; i < end; i++) { const x = pcm[i] / 32768; sum += x * x; }
    const db = 10 * Math.log10(sum / Math.max(1, end - start) + 1e-12);
    let want = g; // hold current gain through silence
    if (db > gateDb) want = Math.max(-maxCutDb, Math.min(maxBoostDb, targetDb - db));
    const a = want < g ? aAtk : aRel;
    g = a * g + (1 - a) * want;
    gains[w] = g;
  }

  const out = new Int16Array(pcm.length);
  const peakLimit = ceiling * 32767;
  for (let i = 0; i < pcm.length; i++) {
    // interpolate gain between window centres for smoothness
    const pos = i / win - 0.5;
    const w0 = Math.max(0, Math.min(nWin - 1, Math.floor(pos)));
    const w1 = Math.min(nWin - 1, w0 + 1);
    const t = Math.max(0, Math.min(1, pos - w0));
    const gDb = gains[w0] * (1 - t) + gains[w1] * t;
    let y = pcm[i] * Math.pow(10, gDb / 20);
    // soft limiter: smooth knee instead of hard clipping
    if (Math.abs(y) > peakLimit) {
      const s = Math.sign(y);
      const over = Math.abs(y) - peakLimit;
      y = s * (peakLimit + (32767 - peakLimit) * Math.tanh(over / (32767 - peakLimit)));
    }
    out[i] = Math.max(-32768, Math.min(32767, Math.round(y)));
  }
  return out;
}

module.exports = { levelSpeech };
