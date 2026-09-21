# Voice training

Phrase sets and recordings for AIStaff's Taglish TTS voices.

```
voice-training/
├── phrases/                  the scripts — the durable asset
│   ├── 01-greetings.json     100
│   ├── 02-product.json       100
│   ├── 03-pricing.json       150
│   ├── 04-delivery.json      150
│   ├── 05-payment.json       100
│   ├── 06-objections.json    150
│   ├── 07-closing.json       100
│   ├── 08-followup.json      100
│   ├── 09-numbers.json       100
│   ├── 10-english.json        60
│   └── taglish-master.json   merged, 1,110 lines — what the recorder reads
├── recordings/
│   └── <voice-name>/         one folder per actor
│       ├── wavs/             22050 Hz mono 16-bit PCM
│       └── metadata.csv      LJSpeech: id|text
└── merge.js                  rebuild the master, with validation
```

## The phrases outlive every model

`wavs/` + `metadata.csv` in LJSpeech format is the standard input for Piper,
Orpheus fine-tuning, VITS, StyleTTS2 and XTTS. **Record once, retrain
anywhere.** The audio is the asset; the model is disposable.

The same is true of the scripts. Recording a second voice — a male one, or a
different actor — means handing them this same script. That is why they are
committed and why they should not be edited casually once a voice has been
recorded against them.

## Coverage, and why it looks the way it does

Roughly 70% Taglish, 20% pure English, 10% pure Tagalog.

The English block exists because Piper renders whatever phonemes it is given,
and a model that has only heard Tagalog sentence structure handles a full
English turn badly. Filipino callers switch to English mid-call; the voice has
to follow without sounding like a different person.

Every line carries a `mode`: `bright`, `neutral`, `apologetic`, `reassuring`.
Deliver each line in its tagged mode. It costs nothing at record time and it
is what allows a four-slot multi-speaker model later — Piper has no emotion
control, so the "speaker" slots are used as emotion slots. Skip it and the
option is gone without re-recording.

## Adding a voice

1. `node merge.js` — rebuilds `taglish-master.json` and validates.
2. Point voice-lab at it, record all 1,110 lines with ONE actor.
3. Export `metadata.csv`, put both under `recordings/<voice-name>/`.

Never blend two actors into one voice. Multi-speaker models exist for building
a voice *library*; training two people as one produces a blurred average that
sounds like neither.

## Audio and git

**Use Git LFS for `recordings/`.** 74 minutes of 22 kHz mono is ~190 MB, and
git stores binaries with no delta compression — every re-recorded take adds
another full copy to history, forever.

```bash
git lfs install
git lfs track "voice-training/recordings/**/*.wav"
git add .gitattributes
```

Without LFS, keep the audio out of git entirely and back it up separately.
The phrases are what must be version-controlled; the WAVs just need to exist
somewhere safe.
