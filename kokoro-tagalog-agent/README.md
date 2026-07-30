# Kokoro Tagalog Agent

Local prototype for testing a Tagalog voice pipeline:

1. raw transcript text
2. GPT-5 mini normalization
3. deterministic Tagalog-to-Kokoro phoneme conversion
4. Kokoro speech synthesis

## Run

```bash
cd kokoro-tagalog-agent
./start.command
```

Open `http://127.0.0.1:8011`.

## Notes

- The app reads `OPENAI_API_KEY` from the repo root `.env` if it is not already exported.
- `gpt-5-mini` is used by default for the language-brain step.
- Kokoro is driven with direct phoneme strings, so this prototype does not rely on Kokoro having native Tagalog text support.
