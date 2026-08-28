let lines = [], takes = {}, idx = 0;
let audioCtx = null, source = null, processor = null, stream = null;
let recording = false, chunks = [], t0 = 0, tick = null;

const TARGET_RATE = 22050;
const $ = (id) => document.getElementById(id);
const cur = () => lines[idx] || null;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function boot() {
  const r = await fetch("/api/script");
  if (!r.ok) { $("prompt").textContent = "No script file found in scripts/."; return; }
  const data = await r.json();
  lines = data.lines; takes = data.takes || {};
  const first = lines.findIndex((l) => !takes[l.id]);
  idx = first === -1 ? 0 : first;
  renderList(); render();
  await initMic();
}

/**
 * Raw PCM capture.
 *
 * ScriptProcessor is deprecated but works everywhere without a separate
 * worklet file, which matters more here than modernity — this has to run on
 * an Intel MacBook with no build step. We take Float32 samples straight from
 * the graph, so nothing is ever compressed.
 */
async function initMic() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,   // all three would colour the voice and the
        noiseSuppression: false,   // model would learn the processing, not the
        autoGainControl: false,    // speaker. Gain is set on the Yeti itself.
      },
    });
    audioCtx = new AudioContext();
    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let peak = 0;
      for (let i = 0; i < input.length; i++) {
        const v = Math.abs(input[i]);
        if (v > peak) peak = v;
      }
      paintMeter(peak);
      if (recording) chunks.push(new Float32Array(input));
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);

    const track = stream.getAudioTracks()[0];
    $("device").textContent = `${track.label} · ${audioCtx.sampleRate} Hz → ${TARGET_RATE} Hz mono 16-bit`;
  } catch (err) {
    $("device").textContent = `mic blocked: ${err.message}`;
  }
}

function paintMeter(peak) {
  const db = peak > 0 ? 20 * Math.log10(peak) : -60;
  const pct = Math.max(0, Math.min(100, ((db + 40) / 40) * 100));
  const bar = $("meterbar");
  bar.style.width = pct + "%";
  bar.className = "meterbar" + (db > -1 ? " clip" : db > -2.5 ? " hot" : "");
}

/**
 * Resample to 22050 Hz with a proper anti-aliasing filter.
 *
 * The mic runs at 44.1 or 48 kHz; Piper wants 22050. Naive decimation folds
 * everything above 11 kHz back into the audible band — the exact bug that made
 * Piper's own output sound garbled on the phone. A windowed-sinc pass first,
 * then linear interpolation between filtered samples.
 */
function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;

  // Low-pass at the new Nyquist before decimating.
  const cutoff = (toRate / 2) / fromRate;
  const N = 32;
  const kernel = new Float32Array(2 * N + 1);
  let sum = 0;
  for (let i = -N; i <= N; i++) {
    const x = 2 * Math.PI * cutoff * i;
    const sinc = i === 0 ? 1 : Math.sin(x) / x;
    const window = 0.54 + 0.46 * Math.cos((Math.PI * i) / N);  // Hamming
    kernel[i + N] = sinc * window;
    sum += kernel[i + N];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const filtered = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let acc = 0;
    for (let k = -N; k <= N; k++) {
      const j = i + k;
      if (j >= 0 && j < input.length) acc += input[j] * kernel[k + N];
    }
    filtered[i] = acc;
  }

  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = filtered[i0] || 0;
    const b = filtered[i0 + 1] !== undefined ? filtered[i0 + 1] : a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Float32 [-1,1] -> 16-bit little-endian PCM. */
function toInt16(f32) {
  const buf = new ArrayBuffer(f32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

/** Trim leading and trailing silence, keeping 80 ms of air either side. */
function trim(f32, rate) {
  const thresh = 0.005;
  let start = 0, end = f32.length - 1;
  while (start < f32.length && Math.abs(f32[start]) < thresh) start++;
  while (end > start && Math.abs(f32[end]) < thresh) end--;
  const pad = Math.floor(rate * 0.08);
  start = Math.max(0, start - pad);
  end = Math.min(f32.length - 1, end + pad);
  return f32.slice(start, end + 1);
}

function renderList() {
  $("list").innerHTML = lines.map((l, i) => {
    const t = takes[l.id];
    return `<div class="row ${i === idx ? "active" : ""}" data-i="${i}">
      <span class="dot ${t ? (t.status || "good") : ""}"></span>
      <span class="id">${l.id}</span>
      <span class="tx">${esc(l.text)}</span>
    </div>`;
  }).join("");
  $("list").querySelectorAll(".row").forEach((r) =>
    r.onclick = () => { idx = +r.dataset.i; renderList(); render(); });
  $("progress").textContent = `${Object.keys(takes).length} / ${lines.length} recorded`;
  const a = $("list").querySelector(".row.active");
  if (a) a.scrollIntoView({ block: "nearest" });
}

const fmt = (v, u = " dB") => (v === null || v === undefined || !isFinite(v) ? "—" : v.toFixed(1) + u);

function render() {
  const l = cur(); if (!l) return;
  $("lineid").textContent = l.id;
  $("prompt").textContent = l.text;
  $("tags").textContent = `${l.tag || ""}  ·  ${l.mode || ""}`;

  const t = takes[l.id];
  const p = $("player");
  if (t) {
    p.hidden = false;
    p.src = `/api/audio/${l.id}?v=${Date.now()}`;
    const issues = (t.issues || []).map((i) =>
      `<div class="issue ${/CLIPPING|Too quiet|capture/.test(i) ? "bad" : ""}">${esc(i)}</div>`).join("");
    $("statsBox").innerHTML = `<div class="stats">
        <div class="stat"><b>Peak</b><span>${fmt(t.peak)}</span></div>
        <div class="stat"><b>RMS</b><span>${fmt(t.rms)}</span></div>
        <div class="stat"><b>Noise floor</b><span>${fmt(t.floor)}</span></div>
        <div class="stat"><b>Length</b><span>${fmt(t.duration, "s")}</span></div>
      </div>${issues || '<div class="ok">✓ Levels look good</div>'}`;
  } else {
    p.hidden = true; p.removeAttribute("src");
    $("statsBox").innerHTML = "";
  }
  $("del").disabled = !t;
}

async function toggle() {
  const l = cur(); if (!l || !audioCtx) return;
  if (audioCtx.state === "suspended") await audioCtx.resume();

  if (!recording) {
    chunks = []; recording = true; t0 = Date.now();
    $("rec").textContent = "■ Stop"; $("rec").classList.add("on");
    tick = setInterval(() => { $("timer").textContent = ((Date.now() - t0) / 1000).toFixed(1) + "s"; }, 100);
    return;
  }

  recording = false; clearInterval(tick);
  $("rec").textContent = "● Record"; $("rec").classList.remove("on");
  $("rec").disabled = true;

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { merged.set(c, off); off += c.length; }

  const trimmed = trim(merged, audioCtx.sampleRate);
  const down = resample(trimmed, audioCtx.sampleRate, TARGET_RATE);
  const pcm = toInt16(down);

  const res = await fetch(`/api/take/${l.id}?text=${encodeURIComponent(l.text)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: pcm,
  });
  const take = await res.json();
  $("rec").disabled = false;
  if (take && take.id) { takes[take.id] = take; renderList(); render(); }
}

const move = (d) => { idx = Math.max(0, Math.min(lines.length - 1, idx + d)); renderList(); render(); };

$("rec").onclick = toggle;
$("next").onclick = () => move(1);
$("prev").onclick = () => move(-1);

$("del").onclick = async () => {
  const l = cur(); if (!l || !takes[l.id]) return;
  await fetch(`/api/take/${l.id}`, { method: "DELETE" });
  delete takes[l.id]; renderList(); render();
};

$("export").onclick = async () => {
  const r = await (await fetch("/api/export", { method: "POST" })).json();
  $("export").textContent = `Wrote ${r.written} rows`;
  setTimeout(() => { $("export").textContent = "Export metadata.csv"; }, 2500);
};

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT") return;
  if (e.code === "Space") { e.preventDefault(); toggle(); }
  else if (e.code === "ArrowRight" && !recording) move(1);
  else if (e.code === "ArrowLeft" && !recording) move(-1);
  else if (e.key.toLowerCase() === "p" && !recording) {
    const p = $("player");
    if (!p.hidden) { p.currentTime = 0; p.play(); }
  }
});

boot();
