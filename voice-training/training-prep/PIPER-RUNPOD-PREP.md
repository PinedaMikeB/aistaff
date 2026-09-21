# Piper training on RunPod — prep notes (Irenz voice)

Written 7 Sep 2026 on the Mac Mini, before opening RunPod. Confirms the
blocker, the workaround, and exactly what to upload.

## The blocker, confirmed on this machine

```
espeak-ng --voices
```
returns **no Tagalog voice**. Checked the data files directly too:

```
/opt/homebrew/Cellar/espeak-ng/1.52.0/share/espeak-ng-data/lang/poz/  -> id, mi, ms
/opt/homebrew/Cellar/espeak-ng/1.52.0/share/espeak-ng-data/lang/map/  -> haw
```

`poz` = Malayo-Polynesian (western). Tagalog belongs here and is absent.
**Indonesian (`id`) and Malay (`ms`) are the closest existing relatives** —
same phoneme family, five pure vowels, similar syllable structure. The `id`
rules file (`lang/poz/id`) is short — stress rules, consonant list, not a
huge amount to adapt. This is the realistic starting point for a `tl` rules
file, following the same pattern as the Tigrinya fork precedent.

**Piper cannot pronounce Tagalog correctly until this is fixed.** Training
on the Irenz dataset today, with espeak-ng's `id` or `ms` phonemizer
substituting for Tagalog, will produce a voice that mispronounces Tagalog
words — because the phonemizer doesn't actually know Tagalog rules, it's
approximating with a related language.

## Correction to the note above

The `lang/poz/id` file quoted above is only the COMPILED stress-timing
config (6 lines) -- Homebrew ships runtime data, not the source used to
build it. The actual grapheme-to-phoneme rules live in espeak-ng's GitHub
repo under `dictsource/`, not in any local install. Pulled the real ones
and put copies in `espeak-ng-source-reference/` next to this file:

  id_rules   149 lines -- Indonesian spelling-to-phoneme rules
  id_list    151 lines -- Indonesian phoneme table (a->a, c->tSe, j->dZe...)
  ms_rules   233 lines -- Malay spelling-to-phoneme rules
  ms_list        Malay phoneme table

`id_rules` is the real starting point for a `tl_rules` fork -- short,
readable, close enough linguistically that most groups need edits, not a
rewrite. Same kind of file the Tigrinya project forked to add their
language.

## Decision point before spending RunPod money

Two honest paths:

**A. Fork `id` into a `tl` rules file first** (a few hours, on this machine,
free). Copy `lang/poz/id` to `lang/poz/tl`, adjust stress and vowel rules
for Tagalog specifics, test locally with `espeak-ng -v tl "kamusta ka"`
before ever touching RunPod. This is the correct fix and nobody else
has done it publicly.

**B. Train once now on `id` phonemization as a smoke test** — confirms the
whole pipeline (dataset format, training script, checkpoint export) works
end to end, accepting the output voice will mispronounce Tagalog-specific
sounds. Useful only to validate infrastructure, not to ship.

Recommendation: **do A first**. It's free, it's the actual fix, and it
means the RunPod money buys a voice that's actually right rather than a
test you'll have to redo anyway.

## Dataset, verified ready

```
voice-training/recordings/irenz-taglish-v1/
├── wavs/           1,110 files, 22050 Hz mono 16-bit PCM  (confirmed)
├── metadata.csv    1,110 rows, LJSpeech format id|text     (confirmed)
└── takes.json      per-take levels, not needed for training
```

No conversion needed — Piper's training script (`piper_train`) expects
exactly this: a `metadata.csv` in `id|text` form and a `wav/` folder
alongside it, sample rate matching the model config (22050 for the
`medium` quality tier, which is what we recorded at).

## What to upload to RunPod

Just three things:
1. `voice-training/recordings/irenz-taglish-v1/wavs/` (202MB)
2. `voice-training/recordings/irenz-taglish-v1/metadata.csv`
3. Whichever `espeak-ng-data/lang/poz/tl` file results from the fork step

Do NOT upload `takes.json` — training doesn't use it, it's just our own
QA record.

## RunPod setup, once path A is done

GPU: single RTX 4090 or A100, on-demand. This dataset (80 min, one
speaker) trains in a few hours on a 4090 — no need for anything bigger.

```bash
git clone https://github.com/rhasspy/piper
cd piper/src/python
pip install -e .
pip install -r requirements.txt

# put the forked tl rules file where espeak-ng looks for it, matching
# whatever piper's phonemize step expects (piper_phonemize bundles its
# own espeak-ng data dir -- check that path specifically, it may not be
# the system espeak-ng install)

python -m piper_train.preprocess \
  --language tl \
  --input-dir /workspace/irenz-taglish-v1 \
  --output-dir /workspace/preprocessed \
  --dataset-format ljspeech \
  --single-speaker \
  --sample-rate 22050

python -m piper_train \
  --dataset-dir /workspace/preprocessed \
  --accelerator gpu --devices 1 \
  --batch-size 32 \
  --validation-split 0.05 \
  --num-test-examples 5 \
  --max_epochs 2000 \
  --checkpoint-epochs 50 \
  --quality medium
```

## One thing to watch during training

Piper training defaults assume more data than 80 minutes (many Piper
voices train on multiple hours). With 1,110 lines / ~80 min single-speaker,
expect to lean on:
- Starting from a pretrained checkpoint of a similar-quality voice (any
  English `medium` checkpoint works as an initialization point) rather
  than training from scratch
- Fewer epochs than the Piper defaults suggest, watching validation loss
  rather than a fixed epoch count, to avoid overfitting on a smaller corpus

## After training

Export to `.onnx` + `.onnx.json`, drop into
`local-runtime/piper/voices/` on the Mac Mini, point
`PIPER_MODEL` at it, and test through the existing `piper_tts_server.py` --
no server code changes needed, it already loads whatever `.onnx` is
configured.

## Fork checklist: id_rules -> tl_rules

Working from `espeak-ng-source-reference/id_rules`. Groups to check/edit
for Tagalog specifically (Tagalog has 5 vowels a/e/i/o/u like Indonesian,
but different consonant clusters and stress patterns, plus the glottal
stop which Indonesian's rules don't model):

1. `.group a/e/i/o/u` -- verify vowel phoneme mapping matches Tagalog's
   pure five-vowel system (should be close to Indonesian's already)
2. Consonant groups (`ng`, `ny` digraphs) -- Tagalog's "ng" is one phoneme
   (as in "ngipin"), needs its own rule; Indonesian's ng handling may
   already cover this since Indonesian also has it
3. **Glottal stop** -- Tagalog marks this with a hyphen or is implicit at
   word-final vowel + consonant boundary ("mag-aral", "tao"). This is the
   biggest structural difference from Indonesian and the part most likely
   to need genuinely new rules rather than copied ones.
4. Stress rules -- Tagalog stress is more variable/lexical than Indonesian
   (can change word meaning: "hapon" afternoon vs "Hapon" Japanese) --
   expect this to need the most manual tuning, likely trial-and-error
   against espeak-ng's own test/pronunciation-check tooling
5. `.group ts` -- borrowed-word cluster (common in Taglish: "tsokolate"),
   worth adding explicitly since Piper will see it constantly in this
   dataset given how much of the recorded script code-switches

Test loop once a draft `tl_rules` exists: espeak-ng's build process
compiles `dictsource/*_rules` + `*_list` into the runtime dictionary.
Follow espeak-ng's own `docs/dictionary.md` for the compile step, then
`espeak-ng -v tl "kamusta, kumusta ka na"` locally before touching RunPod.
