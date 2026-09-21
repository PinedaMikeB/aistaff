"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const codec = require("../src/pitch/rtp/codec");
const { resample, int16ToBuffer, bufferToInt16 } = require("../src/pitch/audio/resample");
const { parseSdp, buildSdp } = require("../src/pitch/sip/sdp");
const { RtpSession, SAMPLES_PER_FRAME } = require("../src/pitch/rtp/session");
const { buildInstructions, normalizeCallerId } = require("../src/pitch/prompt");
const { piperVoiceLanguage } = require("../src/pitch/voice-language");
const {
  LocalPipelineBrain,
  pcmRms,
  writeWavBuffer,
  readWavPcm16,
  isWhisperPromptEcho,
  sanitizeLocalReply,
  bookingScenarioReply,
  isGpt5Model,
  usesOpenAiResponsesApi,
} = require("../src/pitch/brain/local-pipeline");

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

test("local pipeline VAD energy helper distinguishes silence from speech", () => {
  assert.strictEqual(pcmRms(new Int16Array(160)), 0);
  assert.ok(pcmRms(tone(160, 440, 12000)) > 5000);
});

test("local pipeline WAV writer/reader preserves PCM and sample rate", () => {
  const pcm = tone(160, 440, 12000, 16000);
  const wav = writeWavBuffer(pcm, 16000);
  const parsed = readWavPcm16(wav);

  assert.ok(parsed, "generated WAV must parse");
  assert.strictEqual(parsed.sampleRate, 16000);
  assert.deepStrictEqual(Array.from(parsed.pcm), Array.from(pcm));
});

test("local pipeline uses a cached Piper greeting without calling the text brain", async () => {
  let generated = 0;
  let synthesized = 0;
  let synthesizedText = "";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pitch-greeting-"));

  class StubBrain extends LocalPipelineBrain {
    async _generateReply() {
      generated++;
      return { reply: "This should not run.", modelMs: 1, provider: "stub" };
    }

    async _synthesize(text) {
      synthesized++;
      synthesizedText = text;
      return tone(640, 220, 5000, 8000);
    }
  }

  const brain = new StubBrain({
    openaiApiKey: "test-openai",
    geminiApiKey: "test-gemini",
    localConfig: {
      piperVoice: "en_US-ryan-high",
      piperGreetingCacheDir: dir,
      greetingText: "Pitch custom opening from settings.",
      greetingStartDelayMs: 0,
      piperLengthScale: 1,
      piperNoiseScale: 0.667,
      voxcpmSampleRate: 24000,
    },
    businessName: "AIStaff",
    agentName: "Pitch",
    callerId: "+639171234567",
  });

  await brain._prepareGreeting();
  assert.strictEqual(generated, 0);
  assert.strictEqual(synthesized, 1);
  assert.strictEqual(
    synthesizedText,
    "Pitch custom opening from settings."
  );
  assert.ok(fs.readdirSync(dir).some((file) => /greeting-.*\.wav$/.test(file)));

  let audio = null;
  let transcript = "";
  brain.on("audio", (pcm) => { audio = pcm; });
  brain.on("transcript", ({ role, text }) => {
    if (role === "pitch") transcript = text;
  });
  brain.greet();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(audio?.length > 0);
  assert.match(transcript, /Pitch custom opening from settings/);
  assert.strictEqual(generated, 0);
});

test("local OpenAI text brain uses GPT-5 completion token field", () => {
  assert.strictEqual(isGpt5Model("gpt-5-mini"), true);
  assert.strictEqual(isGpt5Model("gpt-5.1"), true);
  assert.strictEqual(isGpt5Model("gpt-4.1-mini"), false);
  assert.strictEqual(usesOpenAiResponsesApi("gpt-5.6-luna"), true);
  assert.strictEqual(usesOpenAiResponsesApi("gpt-5-mini"), false);
});

test("local pipeline prompt keeps only the configured recent history turns", () => {
  const brain = new LocalPipelineBrain({
    openaiApiKey: "test-openai",
    geminiApiKey: "test-gemini",
    localConfig: {
      historyTurns: 3,
      maxOutputTokens: 120,
      temperature: 0.75,
      whisperModel: "whisper-1",
      geminiTextModel: "gemini-3.5-flash-lite",
      voxcpmUrl: "http://127.0.0.1:9880/tts",
      requestTimeoutMs: 1000,
    },
    businessName: "Marga",
    agentName: "Pitch",
    callerId: "+639171234567",
  });
  brain.history = [
    { role: "caller", text: "old caller turn" },
    { role: "pitch", text: "old pitch turn" },
    { role: "caller", text: "recent caller one" },
    { role: "pitch", text: "recent pitch two" },
    { role: "caller", text: "recent caller three" },
  ];

  const prompt = brain._buildReplyPrompt("latest question");
  assert.ok(!prompt.includes("old caller turn"));
  assert.ok(!prompt.includes("old pitch turn"));
  assert.ok(prompt.includes("recent caller one"));
  assert.ok(prompt.includes("recent pitch two"));
  assert.ok(prompt.includes("recent caller three"));
  assert.ok(prompt.includes("Prefer 15 to 30 spoken words"));
  assert.ok(prompt.includes("testing a demo scenario"));
  assert.ok(prompt.includes("restaurant table booking"));
});

test("local pipeline ignores whisper prompt echo transcripts", () => {
  assert.strictEqual(
    isWhisperPromptEcho("Transcribe natural Filipino Taglish, Tagalog, or English exactly as spoken."),
    true
  );
  assert.strictEqual(isWhisperPromptEcho("Can I reserve a table for two?"), false);
});

test("local pipeline replaces unsafe live-call replies", () => {
  assert.strictEqual(
    sanitizeLocalReply("I only speak English on this line.", "Can you speak Tagalog?"),
    "Opo, pwede po akong mag-Tagalog o Taglish. Ano po ang kailangan ninyo?"
  );
  assert.strictEqual(
    sanitizeLocalReply("Yes, I understand Tagalog, though I will answer you in English.", "Tagalog."),
    "Opo, pwede po akong mag-Tagalog o Taglish. Ano po ang kailangan ninyo?"
  );
  assert.ok(
    sanitizeLocalReply("Just to clarify, this is AIStaff, so we are an office rather than a restaurant.", "Can I reserve a table for two at your restaurant?")
      .includes("table for two")
  );
});

test("selected Piper voice controls the spoken language", () => {
  const englishPrompt = buildInstructions({
    pipeline: "local",
    piperVoice: "en_US-ryan-high",
  });
  assert.match(englishPrompt, /selected Piper voice is en_US-ryan-high/i);
  assert.match(englishPrompt, /spoken reply must be English only/i);
  assert.doesNotMatch(englishPrompt, /local Gab voice/i);

  const taglishPrompt = buildInstructions({
    pipeline: "local",
    piperVoice: "gab_taglish_epoch59",
  });
  assert.match(taglishPrompt, /Filipino Taglish voice/i);
  assert.match(taglishPrompt, /reply naturally in Tagalog or\s+Taglish/i);

  assert.strictEqual(
    sanitizeLocalReply(
      "I only speak English on this line.",
      "Can you speak Tagalog?",
      [],
      piperVoiceLanguage("en_US-ryan-high")
    ),
    "I can understand Tagalog, but this selected voice speaks English. How can I help?"
  );
});

test("local pipeline continues demo booking scenarios instead of looping", () => {
  assert.match(
    bookingScenarioReply("I want to reserve a table for two at your restaurant."),
    /table for two/i
  );
  assert.match(
    bookingScenarioReply("Do you have a romantic corner by the window?", [
      { role: "caller", text: "I want to reserve a table for two at your restaurant." },
      { role: "pitch", text: "Sure po, table for two. Anong oras po kayo darating?" },
    ]),
    /corner by the window/i
  );
  assert.match(
    bookingScenarioReply("This afternoon.", [
      { role: "caller", text: "I am booking at the hotel." },
    ]),
    /available rooms/i
  );
  assert.match(
    sanitizeLocalReply("Would you like someone from the team to call you back?", "This afternoon.", [
      { role: "caller", text: "I am booking at the hotel." },
    ]),
    /available rooms/i
  );
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
