from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

from tts_engine import TTSGenerationError, get_tts_engine


DEFAULT_TEXT = (
    "Magandang araw po. Ako ang inyong AI staff. "
    "Paano po namin kayo matutulungan?"
)


class TTSRequest(BaseModel):
    text: str


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_tts_engine()
    yield


app = FastAPI(title="AIStaff Tagalog Voice Test", lifespan=lifespan)


@app.get("/", response_class=HTMLResponse)
async def homepage() -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AIStaff Tagalog Voice Test</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f4efe5;
      --panel: #fffdf8;
      --text: #1e1b16;
      --muted: #6f665b;
      --accent: #105a4b;
      --accent-2: #d8a84d;
      --error: #a12626;
      --border: #e2d7c5;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, rgba(216, 168, 77, 0.28), transparent 28%),
        linear-gradient(135deg, #f8f2e8, var(--bg));
      color: var(--text);
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }}
    .card {{
      width: min(760px, 100%);
      background: color-mix(in srgb, var(--panel) 92%, white 8%);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 20px 50px rgba(38, 30, 17, 0.12);
      backdrop-filter: blur(10px);
    }}
    h1 {{
      margin: 0 0 10px;
      font-size: clamp(2rem, 4vw, 2.9rem);
      line-height: 1.05;
    }}
    p {{
      margin: 0 0 20px;
      color: var(--muted);
      font-size: 1.05rem;
    }}
    textarea {{
      width: 100%;
      min-height: 220px;
      resize: vertical;
      border-radius: 18px;
      border: 1px solid var(--border);
      padding: 18px;
      font: inherit;
      font-size: 1.15rem;
      line-height: 1.55;
      background: #fffdfa;
      color: var(--text);
    }}
    button {{
      margin-top: 16px;
      border: 0;
      border-radius: 999px;
      padding: 14px 22px;
      font: inherit;
      font-size: 1rem;
      font-weight: 700;
      color: white;
      background: linear-gradient(135deg, var(--accent), #158169);
      cursor: pointer;
    }}
    button:disabled {{
      cursor: wait;
      opacity: 0.7;
    }}
    #loading, #error {{
      margin-top: 16px;
      font-size: 0.98rem;
      display: none;
    }}
    #loading {{ color: var(--accent); }}
    #error {{ color: var(--error); }}
    audio {{
      width: 100%;
      margin-top: 20px;
    }}
  </style>
</head>
<body>
  <main class="card">
    <h1>AIStaff Tagalog Voice Test</h1>
    <p>Type Tagalog text, generate speech, and play it directly in your browser.</p>
    <textarea id="text">{DEFAULT_TEXT}</textarea>
    <button id="generate">Generate and Play</button>
    <div id="loading">Generating voice, please wait...</div>
    <div id="error" role="alert"></div>
    <audio id="player" controls></audio>
  </main>
  <script>
    const button = document.getElementById("generate");
    const textBox = document.getElementById("text");
    const loading = document.getElementById("loading");
    const error = document.getElementById("error");
    const player = document.getElementById("player");

    async function generateAudio() {{
      const text = textBox.value.trim();
      error.style.display = "none";
      error.textContent = "";

      if (!text) {{
        error.textContent = "Please enter some Tagalog text.";
        error.style.display = "block";
        return;
      }}

      button.disabled = true;
      loading.style.display = "block";

      try {{
        const response = await fetch("/api/tts", {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          body: JSON.stringify({{ text }})
        }});

        if (!response.ok) {{
          let message = "Speech generation failed.";
          try {{
            const payload = await response.json();
            if (payload.detail) {{
              message = payload.detail;
            }}
          }} catch (_) {{
          }}
          throw new Error(message);
        }}

        const audioBlob = await response.blob();
        const objectUrl = URL.createObjectURL(audioBlob);
        player.src = objectUrl;
        await player.play();
      }} catch (err) {{
        error.textContent = err.message || "Speech generation failed.";
        error.style.display = "block";
      }} finally {{
        loading.style.display = "none";
        button.disabled = false;
      }}
    }}

    button.addEventListener("click", generateAudio);
  </script>
</body>
</html>"""


@app.post("/api/tts")
async def generate_tts(payload: TTSRequest) -> Response:
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required.")

    try:
        engine = get_tts_engine()
        wav_bytes = engine.synthesize_to_wav_bytes(text)
        return Response(content=wav_bytes, media_type="audio/wav")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TTSGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
