from __future__ import annotations

import base64
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from kokoro_tts import KokoroTTSError, get_synthesizer
from language_brain import BrainResult, LanguageBrainError, normalize_transcript
from tagalog_g2p import convert_to_kokoro_phonemes


DEFAULT_TEXT = "magandang araw po sir may 2 units tayo sa qc baka pwede bukas"


class ProcessRequest(BaseModel):
    text: str = Field(..., min_length=1)
    voice: str = "af_heart"
    r_mode: str = "ɾ"
    speed: float = 1.0


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_synthesizer()
    yield


app = FastAPI(title="Kokoro Tagalog Agent Test", lifespan=lifespan)


def build_page() -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kokoro Tagalog Agent Test</title>
  <style>
    :root {{
      --bg: #f7f3eb;
      --panel: #fffdf8;
      --ink: #1d1b18;
      --muted: #6b6458;
      --line: #ddd2bf;
      --accent: #0f5f4f;
      --accent-2: #c88c2d;
      --error: #a02424;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      min-height: 100vh;
      font-family: Georgia, "Times New Roman", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top right, rgba(200, 140, 45, 0.18), transparent 24%),
        linear-gradient(135deg, #fbf7ef, var(--bg));
      padding: 24px;
    }}
    .wrap {{
      width: min(980px, 100%);
      margin: 0 auto;
      display: grid;
      gap: 18px;
    }}
    .card {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 24px;
      box-shadow: 0 20px 40px rgba(30, 24, 15, 0.08);
    }}
    h1 {{ margin: 0 0 8px; font-size: clamp(2rem, 4vw, 3rem); }}
    p {{ margin: 0; color: var(--muted); }}
    textarea {{
      width: 100%;
      min-height: 180px;
      margin-top: 16px;
      padding: 16px;
      border-radius: 18px;
      border: 1px solid var(--line);
      font: inherit;
      font-size: 1.08rem;
      line-height: 1.6;
      resize: vertical;
    }}
    .controls {{
      margin-top: 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: end;
    }}
    label {{
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 0.95rem;
    }}
    select, input {{
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 12px;
      font: inherit;
      background: white;
      color: var(--ink);
    }}
    button {{
      border: 0;
      border-radius: 999px;
      padding: 14px 20px;
      background: linear-gradient(135deg, var(--accent), #177762);
      color: white;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }}
    button:disabled {{ opacity: 0.7; cursor: wait; }}
    .grid {{
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }}
    .panel-title {{
      margin: 0 0 8px;
      font-size: 1.05rem;
    }}
    pre {{
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, Menlo, monospace;
      font-size: 0.94rem;
      line-height: 1.5;
    }}
    #status {{ color: var(--accent); min-height: 1.2em; }}
    #error {{ color: var(--error); min-height: 1.2em; }}
    audio {{ width: 100%; margin-top: 10px; }}
  </style>
</head>
<body>
  <main class="wrap">
    <section class="card">
      <h1>Kokoro Tagalog Agent Test</h1>
      <p>Raw transcript in, GPT-5 mini cleanup, deterministic Tagalog phonemes out, then Kokoro speaks the result.</p>
      <textarea id="text">{DEFAULT_TEXT}</textarea>
      <div class="controls">
        <label>Voice
          <select id="voice">
            <option value="af_heart">af_heart</option>
            <option value="af_bella">af_bella</option>
            <option value="af_jessica">af_jessica</option>
            <option value="am_adam">am_adam</option>
          </select>
        </label>
        <label>R sound
          <select id="rMode">
            <option value="ɾ">ɾ tap</option>
            <option value="ɹ">ɹ approximant</option>
          </select>
        </label>
        <label>Speed
          <input id="speed" type="number" min="0.7" max="1.3" step="0.05" value="1.0" />
        </label>
        <button id="runBtn">Normalize and Speak</button>
      </div>
      <div id="status"></div>
      <div id="error"></div>
      <audio id="player" controls></audio>
    </section>
    <section class="grid">
      <article class="card">
        <h2 class="panel-title">Normalized Text</h2>
        <pre id="normalized"></pre>
      </article>
      <article class="card">
        <h2 class="panel-title">Annotated Text</h2>
        <pre id="annotated"></pre>
      </article>
      <article class="card">
        <h2 class="panel-title">Clauses</h2>
        <pre id="clauses"></pre>
      </article>
      <article class="card">
        <h2 class="panel-title">Kokoro Phonemes</h2>
        <pre id="phonemes"></pre>
      </article>
      <article class="card">
        <h2 class="panel-title">Notes</h2>
        <pre id="notes"></pre>
      </article>
      <article class="card">
        <h2 class="panel-title">Metadata</h2>
        <pre id="meta"></pre>
      </article>
    </section>
  </main>
  <script>
    const text = document.getElementById("text");
    const voice = document.getElementById("voice");
    const rMode = document.getElementById("rMode");
    const speed = document.getElementById("speed");
    const runBtn = document.getElementById("runBtn");
    const status = document.getElementById("status");
    const error = document.getElementById("error");
    const player = document.getElementById("player");

    async function runPipeline() {{
      status.textContent = "Running GPT normalization and Kokoro synthesis...";
      error.textContent = "";
      runBtn.disabled = true;

      try {{
        const response = await fetch("/api/process", {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          body: JSON.stringify({{
            text: text.value,
            voice: voice.value,
            r_mode: rMode.value,
            speed: Number(speed.value || 1)
          }})
        }});

        const payload = await response.json();
        if (!response.ok) {{
          throw new Error(payload.detail || "Pipeline failed.");
        }}

        document.getElementById("normalized").textContent = payload.normalized_text;
        document.getElementById("annotated").textContent = payload.annotated_text;
        document.getElementById("clauses").textContent = payload.clauses.join("\\n");
        document.getElementById("phonemes").textContent = payload.phoneme_string;
        document.getElementById("notes").textContent = (payload.notes || []).join("\\n") || "No extra notes.";
        document.getElementById("meta").textContent = JSON.stringify({{
          language_brain_model: payload.language_brain_model,
          sample_rate: payload.sample_rate,
          voice: payload.voice,
          r_mode: payload.r_mode,
          speed: payload.speed,
          debug_words: payload.debug_words.slice(0, 12)
        }}, null, 2);

        const binary = atob(payload.audio_base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], {{ type: "audio/wav" }});
        player.src = URL.createObjectURL(blob);
        await player.play();
        status.textContent = "Done.";
      }} catch (err) {{
        error.textContent = err.message || "Pipeline failed.";
        status.textContent = "";
      }} finally {{
        runBtn.disabled = false;
      }}
    }}

    runBtn.addEventListener("click", runPipeline);
  </script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
async def homepage() -> str:
    return build_page()


@app.post("/api/process")
async def process(payload: ProcessRequest) -> dict:
    raw_text = payload.text.strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="Text is required.")

    try:
        brain_result: BrainResult = normalize_transcript(raw_text)
        phoneme_result = convert_to_kokoro_phonemes(
            brain_result.annotated_text,
            brain_result.clauses,
            r_mode=payload.r_mode,
        )
        synthesizer = get_synthesizer()
        wav_bytes = synthesizer.synthesize(
            phoneme_result.clause_phonemes,
            voice=payload.voice,
            speed=payload.speed,
        )
        return {
            "normalized_text": brain_result.normalized_text,
            "annotated_text": brain_result.annotated_text,
            "clauses": brain_result.clauses,
            "notes": brain_result.notes,
            "language_brain_model": brain_result.model,
            "phoneme_string": phoneme_result.phoneme_string,
            "debug_words": phoneme_result.debug_words,
            "voice": payload.voice,
            "r_mode": payload.r_mode,
            "speed": payload.speed,
            "sample_rate": synthesizer.sample_rate,
            "audio_base64": base64.b64encode(wav_bytes).decode("ascii"),
        }
    except LanguageBrainError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except KokoroTTSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
