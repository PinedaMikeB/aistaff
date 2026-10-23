# Pitch Stack 4

Option 3 in AI Studio is the production local Taglish stack:

- STT: Qwen3-ASR 0.6B on `127.0.0.1:8190`
- LLM: Gemma SEA-LION v4.5 E2B IT on `127.0.0.1:8090`
- TTS: Piper `zonos1110_22050_epoch180` on `127.0.0.1:5001`
- Turn detection: Silero VAD tuned for the AIO100 8 kHz phone channel
- Pitch SIP extension: 8001

Gemini Live and OpenAI Realtime remain available as fallback selections. The
old whisper.cpp runtime is not part of option 3. Gemini and OpenAI are separate
pipeline choices and are not offered as text brains inside the local stack.

## AI Studio settings

Option 3 keeps the complete editor and uses Stack 4 values as defaults. The
admin can save and restart changes to:

- Business name, agent name, opening greeting, and greeting delay
- Qwen3-ASR model, endpoint, decoding mode, and recognition context
- Silero speech start/end thresholds, minimum speech, pre-speech audio,
  end-of-turn silence, maximum utterance, and interruption detection
- SEA-LION model/endpoint, temperature, output limit, conversation history,
  and request timeout
- Piper endpoint, installed ONNX voice, speaker ID, length scale, noise scale,
  output volume, greeting, and greeting delay
- The pipeline-specific instruction prompt and its version history

`Save settings` writes `local-runtime/pitch-config.json`. `Save & restart voice
stack` writes the same values, starts any required services, reloads the chosen
Piper model and synthesis parameters, then restarts Pitch. The assembled prompt
preview substitutes the current business name, agent name, and sample caller
number without changing the instruction template.

## Runtime assets

Large assets are intentionally outside Git:

- Qwen environment: `local-runtime/qwen3-asr/venv`
- Qwen model: `local-runtime/qwen3-asr/models/Qwen3-ASR-0.6B`
- SEA-LION model: `/srv/models/sea-lion/Gemma-SEA-LION-v4.5-E2B-IT-Q8_0.gguf`
- Piper model: `/home/ai-server/projects/piper-serve/voices/zonos1110_22050_epoch180.onnx`

## Operations

```bash
./scripts/restart-pitch-stack.sh
./scripts/status-pitch-stack.sh
```

The restart script reads `local-runtime/pitch-config.json`. For option 3 it
ensures all three local model services are healthy before restarting Pitch.
The Piper launcher selects the saved installed voice and applies the saved
length/noise values; it restarts Piper only when those launch values differ.
For either cloud fallback it restarts only Pitch and leaves the local services
available for quick rollback.

Logs and PID files are written under `logs/` and `run/`. Do not run a second
Pitch process manually because extension 8001 and SIP port 5062 are exclusive.
