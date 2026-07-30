# Tagalog TTS

Local FastAPI web app for testing Tagalog text-to-speech with Hugging Face `facebook/mms-tts-tgl`.

## Features

- Loads the TTS model once when the server starts.
- Accepts Tagalog text from a browser page or JSON API.
- Returns generated WAV audio directly from memory.
- Uses CPU-first inference on Apple Silicon for reliability.

## Run

```bash
cd tagalog-tts
./start.command
```

Then open `http://127.0.0.1:8010`.

## API

`POST /api/tts`

```json
{
  "text": "Magandang araw po."
}
```
