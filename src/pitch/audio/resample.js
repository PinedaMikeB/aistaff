"use strict";

/**
 * Sample-rate conversion between the phone network and the model.
 *
 *   phone side : 8 kHz  PCM16 (from G.711)
 *   model side : 24 kHz PCM16 (OpenAI Realtime) or 16 kHz (Gemini Live in)
 *
 * Linear interpolation is used deliberately. On an 8 kHz telephone channel
 * the audio is already band-limited to ~3.4 kHz, so a higher-order filter
 * buys almost nothing perceptually while costing CPU on every 20 ms tick.
 *
 * Downsampling averages across the source window, which gives us cheap
 * anti-aliasing — important because the model emits full-band speech that
 * would otherwise fold noise back into the voice band.
 */

/** Upsample Int16 PCM from `fromRate` to `toRate` (linear interpolation). */
function upsample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = toRate / fromRate;
  const outLength = Math.floor(input.length * ratio);
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = (a + (b - a) * frac) | 0;
  }
  return out;
}

/** Downsample Int16 PCM from `fromRate` to `toRate` (box average). */
function downsample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j];
      count++;
    }
    out[i] = count > 0 ? (sum / count) | 0 : 0;
  }
  return out;
}

function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  return toRate > fromRate
    ? upsample(input, fromRate, toRate)
    : downsample(input, fromRate, toRate);
}

// --- Buffer <-> Int16Array helpers -----------------------------------------
// The Realtime API speaks base64 of little-endian PCM16, so we convert at
// the edges rather than carrying Buffers through the audio path.

function int16ToBuffer(samples) {
  const buf = Buffer.allocUnsafe(samples.length * 2);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], i * 2);
  return buf;
}

function bufferToInt16(buf) {
  const count = Math.floor(buf.length / 2);
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

module.exports = { resample, upsample, downsample, int16ToBuffer, bufferToInt16 };
