"use strict";

const test = require("node:test");
const assert = require("node:assert");

const codec = require("../src/pitch/rtp/codec");
const { resample, int16ToBuffer, bufferToInt16 } = require("../src/pitch/audio/resample");
const { parseSdp, buildSdp } = require("../src/pitch/sip/sdp");
const { RtpSession, SAMPLES_PER_FRAME } = require("../src/pitch/rtp/session");
const { buildInstructions, normalizeCallerId } = require("../src/pitch/prompt");

function tone(n = 160, freq = 440, amp = 12000, rate = 8000) {
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(amp * Math.sin((2 * Math.PI * freq * i) / rate));
  return out;
}

test("G.711 round-trips both codecs within spec SNR", () => {
  const pcm = tone();
  for (const name of ["PCMU", "PCMA"]) {
    const encoded = codec.encode(pcm, name);
    assert.strictEqual(encoded.length, 160, `${name} must be 1 byte per sample`);

    const decoded = codec.decode(encoded, name);
    let sumSq = 0;
    for (let i = 0; i < pcm.length; i++) sumSq += (decoded[i] - pcm[i]) ** 2;
    const snr = 20 * Math.log10(12000 / Math.sqrt(sumSq / pcm.length));
    assert.ok(snr > 35, `${name} SNR ${snr.toFixed(1)}dB should exceed 35dB`);
  }
});

test("payload types map per RFC 3551", () => {
  assert.strictEqual(codec.codecForPayloadType(0), "PCMU");
  assert.strictEqual(codec.codecForPayloadType(8), "PCMA");
  assert.strictEqual(codec.codecForPayloadType(101), null); // telephone-event
});

test("resampling preserves length ratios and PCM buffer round-trip", () => {
  const pcm = tone(160);
  assert.strictEqual(resample(pcm, 8000, 24000).length, 480);
  assert.strictEqual(resample(tone(480, 440, 12000, 24000), 24000, 8000).length, 160);
  assert.strictEqual(resample(pcm, 8000, 8000), pcm);

  const back = bufferToInt16(int16ToBuffer(pcm));
  assert.deepStrictEqual(Array.from(back), Array.from(pcm), "PCM16 LE round-trip must be lossless");
});

test("SDP parses an AIO100-style offer and prefers G.711", () => {
  const offer = [
    "v=0", "o=- 1 1 IN IP4 192.168.100.200", "s=-",
    "c=IN IP4 192.168.100.200", "t=0 0",
    "m=audio 10010 RTP/AVP 8 0 18 101",
    "a=rtpmap:8 PCMA/8000", "a=rtpmap:0 PCMU/8000",
    "a=rtpmap:18 G729/8000", "a=rtpmap:101 telephone-event/8000",
  ].join("\r\n");

  const parsed = parseSdp(offer);
  assert.strictEqual(parsed.host, "192.168.100.200");
  assert.strictEqual(parsed.port, 10010);
  assert.strictEqual(parsed.codec, "PCMA", "must honour the far end's first G.711 preference");
});

test("SDP answer advertises our port, codec and DTMF", () => {
  const sdp = buildSdp({ localHost: "192.168.100.72", localPort: 40000, codec: "PCMA" });
  assert.match(sdp, /c=IN IP4 192\.168\.100\.72/);
  assert.match(sdp, /m=audio 40000 RTP\/AVP 8 101/);
  assert.match(sdp, /a=rtpmap:8 PCMA\/8000/);
  assert.match(sdp, /a=rtpmap:101 telephone-event\/8000/);
  assert.match(sdp, /a=ptime:20/);
});

test("prompt sets no language and scripts no speech", () => {
  const text = buildInstructions({ businessName: "Marga", agentName: "Pitch" });

  // The whole point: language is decided at runtime by the model.
  assert.ok(/match the caller/i.test(text));
  assert.ok(/Taglish/.test(text), "Taglish must be described as valid, not corrected away");

  // Guard against the canned-copy regression from docs/handoff-masterplan.md.
  assert.ok(!/say exactly/i.test(text));
  assert.ok(!/verbatim/i.test(text));
  // Intent, not an exact phrase — the greeting must be varied, not fixed.
  assert.ok(/vary/i.test(text), "greeting must not be a fixed string");
  assert.ok(/same opening sentence/i.test(text), "must forbid a repeated opening");

  // Branding: she introduces herself by name AND names the business.
  assert.ok(/giving your own name, Pitch/.test(text), "must introduce herself by name");
  assert.ok(/Marga/.test(text), "must still name the business");
});

test("caller ID is a runtime branch, not a setting", () => {
  // Withheld, stripped, or ua.js's own fallback — all mean "no number".
  for (const absent of [undefined, null, "", "unknown", "Anonymous", "restricted", "0"]) {
    assert.strictEqual(normalizeCallerId(absent), null, `${absent} must count as absent`);
  }
  assert.strictEqual(normalizeCallerId("+639171234567"), "+639171234567");
  assert.strictEqual(normalizeCallerId(" 09171234567 "), "09171234567");

  const known = buildInstructions({
    businessName: "Marga", agentName: "Pitch", callerId: "+639171234567",
  });
  const withheld = buildInstructions({ businessName: "Marga", agentName: "Pitch" });

  // Confirm, don't ask: the number is in the prompt and asking is forbidden.
  assert.ok(known.includes("+639171234567"), "the number must reach the model");
  assert.ok(/never ask the caller to tell you their number/i.test(known));

  // Absent caller ID falls back to asking, and must not invent a number.
  assert.ok(/no caller ID/i.test(withheld));
  assert.ok(!/\+?\d{7,}/.test(withheld), "must not fabricate a number when none arrived");

  // Both branches remain principles, never lines to read out.
  for (const text of [known, withheld]) {
    assert.ok(!/say exactly/i.test(text));
    assert.ok(!/verbatim/i.test(text));
    assert.ok(/match the caller/i.test(text), "language adaptation survives both branches");
  }
});

test("RTP session emits decoded caller audio and paces outbound frames", async () => {
  const dgram = require("dgram");
  const session = new RtpSession({ localPort: 41230, codec: "PCMU" });
  await session.start();

  const received = [];
  session.on("audio", (pcm) => received.push(pcm));

  // Build one RTP packet carrying a 160-sample tone.
  const payload = codec.encode(tone(), "PCMU");
  const packet = Buffer.alloc(12 + payload.length);
  packet[0] = 0x80;
  packet[1] = 0; // PCMU
  packet.writeUInt16BE(1, 2);
  payload.copy(packet, 12);

  const sender = dgram.createSocket("udp4");
  await new Promise((r) => sender.bind(0, r));

  // Sink for Pitch's outbound audio, so we can verify the 20ms clock.
  const sinkPort = sender.address().port;
  const outbound = [];
  sender.on("message", (m) => outbound.push(m));

  await new Promise((r) => sender.send(packet, 41230, "127.0.0.1", r));
  await new Promise((r) => setTimeout(r, 120));

  assert.strictEqual(received.length, 1, "one packet in, one audio event out");
  assert.strictEqual(received[0].length, SAMPLES_PER_FRAME);

  // Symmetric RTP: it should have learned the sender's address automatically.
  assert.strictEqual(session.remotePort, sinkPort, "must learn remote from arriving packets");

  // It should now be streaming silence back on the 20ms clock.
  assert.ok(outbound.length >= 3, `expected paced frames, got ${outbound.length}`);
  assert.strictEqual(outbound[0].length, 12 + 160, "each frame is header + 160 bytes");

  // Barge-in must drop queued audio.
  session.write(tone(8000));
  assert.ok(session.playoutLength > 0);
  session.flush();
  assert.strictEqual(session.playoutLength, 0, "flush must clear playout for barge-in");

  session.close();
  sender.close();
});
