from __future__ import annotations

from io import BytesIO
from threading import Lock

import numpy as np
from kokoro import KPipeline
from scipy.io.wavfile import write as write_wav


class KokoroTTSError(RuntimeError):
    """Raised when Kokoro synthesis fails."""


class KokoroSynthesizer:
    def __init__(self) -> None:
        self.pipeline = KPipeline(lang_code="a", device="cpu")
        self.sample_rate = 24000

    def synthesize(self, clause_phonemes: list[str], voice: str = "af_heart", speed: float = 1.0) -> bytes:
        if not clause_phonemes:
            raise KokoroTTSError("No phonemes were generated.")

        audio_chunks: list[np.ndarray] = []
        silence = np.zeros(int(self.sample_rate * 0.18), dtype=np.float32)

        try:
            for index, phonemes in enumerate(clause_phonemes):
                result = next(self.pipeline.generate_from_tokens(phonemes, voice=voice, speed=speed))
                if result.audio is None:
                    raise KokoroTTSError("Kokoro did not return audio.")
                audio_chunks.append(result.audio.detach().cpu().numpy().astype(np.float32))
                if index < len(clause_phonemes) - 1:
                    audio_chunks.append(silence)
        except StopIteration as exc:
            raise KokoroTTSError("Kokoro returned no audio chunks.") from exc
        except Exception as exc:  # noqa: BLE001
            raise KokoroTTSError(f"Kokoro synthesis failed: {exc}") from exc

        if not audio_chunks:
            raise KokoroTTSError("Generated audio was empty.")

        waveform = np.concatenate(audio_chunks).clip(-1.0, 1.0)
        pcm16 = (waveform * 32767.0).astype(np.int16)
        buffer = BytesIO()
        write_wav(buffer, self.sample_rate, pcm16)
        wav_bytes = buffer.getvalue()
        if not wav_bytes:
            raise KokoroTTSError("Generated WAV output was empty.")
        return wav_bytes


_synth: KokoroSynthesizer | None = None
_synth_lock = Lock()


def get_synthesizer() -> KokoroSynthesizer:
    global _synth
    if _synth is None:
        with _synth_lock:
            if _synth is None:
                _synth = KokoroSynthesizer()
    return _synth
