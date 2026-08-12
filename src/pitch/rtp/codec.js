"use strict";

/**
 * G.711 codec — μ-law (PCMU / payload type 0) and A-law (PCMA / type 8).
 *
 * The AIO100 will offer PCMU and PCMA. Everything on the wire is 8 kHz,
 * 8 bits per sample, 160 bytes per 20 ms packet.
 *
 * Lookup tables are built once at load; per-sample encode/decode on a live
 * call is then a single array index, which keeps us far away from the 20 ms
 * budget.
 */

const BIAS = 0x84;
const CLIP = 32635;

function linearToMuLawSample(sample) {
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1);

  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function muLawToLinearSample(muLawByte) {
  muLawByte = ~muLawByte & 0xff;
  const sign = muLawByte & 0x80;
  const exponent = (muLawByte >> 4) & 0x07;
  const mantissa = muLawByte & 0x0f;

  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  return sign !== 0 ? -sample : sample;
}

function linearToALawSample(sample) {
  const sign = (~sample >> 8) & 0x80;
  if (sign === 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;

  let compressed;
  if (sample >= 256) {
    let exponent = 7;
    for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    compressed = (exponent << 4) | mantissa;
  } else {
    compressed = sample >> 4;
  }
  return (compressed ^ sign ^ 0x55) & 0xff;
}

function aLawToLinearSample(aLawByte) {
  let value = (aLawByte ^ 0x55) & 0xff;
  const sign = value & 0x80;
  let exponent = (value >> 4) & 0x07;
  let mantissa = value & 0x0f;

  let sample;
  if (exponent === 0) {
    sample = (mantissa << 4) + 8;
  } else {
    sample = ((mantissa << 4) + 0x108) << (exponent - 1);
  }
  return sign !== 0 ? sample : -sample;
}

// --- Precomputed tables -----------------------------------------------------

const MULAW_TO_PCM = new Int16Array(256);
const ALAW_TO_PCM = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  MULAW_TO_PCM[i] = muLawToLinearSample(i);
  ALAW_TO_PCM[i] = aLawToLinearSample(i);
}

// 16-bit signed range mapped down to 8-bit companded values.
const PCM_TO_MULAW = new Uint8Array(65536);
const PCM_TO_ALAW = new Uint8Array(65536);
for (let i = 0; i < 65536; i++) {
  const sample = i - 32768;
  PCM_TO_MULAW[i] = linearToMuLawSample(sample);
  PCM_TO_ALAW[i] = linearToALawSample(sample);
}

function clampToInt16(value) {
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return value;
}

// --- Public API -------------------------------------------------------------

/** G.711 payload bytes -> Int16Array of PCM samples (8 kHz). */
function decode(payload, codec) {
  const table = codec === "PCMA" ? ALAW_TO_PCM : MULAW_TO_PCM;
  const out = new Int16Array(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = table[payload[i]];
  return out;
}

/** Int16Array of PCM samples (8 kHz) -> G.711 payload Buffer. */
function encode(samples, codec) {
  const table = codec === "PCMA" ? PCM_TO_ALAW : PCM_TO_MULAW;
  const out = Buffer.allocUnsafe(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = table[clampToInt16(samples[i]) + 32768];
  }
  return out;
}

const PAYLOAD_TYPES = { PCMU: 0, PCMA: 8 };

function codecForPayloadType(pt) {
  if (pt === 0) return "PCMU";
  if (pt === 8) return "PCMA";
  return null;
}

module.exports = {
  decode,
  encode,
  PAYLOAD_TYPES,
  codecForPayloadType,
};
