# irenz-rerecord-v1

Rerecorded replacement takes for lines that failed QA in
`irenz-taglish-v1`, per `irenz-rerecord-production-small-617.csv`.

**Status: 250 of 617 done.** This is a partial batch, not the full list.
`PHRASES-TO-REDO.txt` (in the sibling folder) has the complete 617-code
list; whichever codes appear in this folder's `metadata.csv` are done,
the rest are still outstanding.

## Not yet merged into irenz-taglish-v1

These 250 wavs are staged here, not yet swapped into the main dataset.
Once all (or enough of) the 617 are done, the merge step is: for each id
in this folder's metadata.csv, replace the matching wav + metadata row in
`irenz-taglish-v1/`. Do this in one pass at the end, not incrementally,
so the "which takes are done" bookkeeping stays simple.

## QA gate applied

Every take here passed BOTH a level check (peak/RMS/noise floor) and a
whisper-small transcription check (>=60% word-match against the intended
line, after normalizing spoken-number-words and digit-numerals to the
same form so phone-number lines aren't penalized for a formatting
difference alone). Only passing takes are in metadata.csv -- failed
takes, if any, are recorded on disk but excluded from the export.

One scoring bug was found and fixed mid-session: the normalizer initially
only merged single spelled-out digits ("zero nine" -> "09"), not
multi-digit chunks whisper itself groups with punctuation ("0917-345-6789").
Fixed in `local-runtime/voice-lab/whisper-qa/server.py` before this batch
was exported; the one take it had wrongly failed (eng039) was manually
corrected and is included in this 250.

Audio: 22050 Hz mono 16-bit PCM, same format as irenz-taglish-v1.
