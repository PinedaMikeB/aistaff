from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from threading import Lock

import torch
from scipy.io.wavfile import write as write_wav
from transformers import AutoTokenizer, VitsModel


MODEL_NAME = "facebook/mms-tts-tgl"


class TTSGenerationError(RuntimeError):
    """Raised when speech synthesis fails."""


@dataclass(frozen=True)
class DeviceConfig:
    device: str
    reason: str


def detect_device() -> DeviceConfig:
    """Prefer reliability over acceleration for this VITS model on macOS."""
    if torch.cuda.is_available():
        return DeviceConfig(device="cuda", reason="CUDA is available.")

    if torch.backends.mps.is_available():
        return DeviceConfig(
            device="cpu",
            reason="Apple Silicon detected; using CPU for stable VITS inference on macOS.",
        )

    return DeviceConfig(device="cpu", reason="Using CPU inference.")


class TagalogTTSEngine:
    def __init__(self) -> None:
        self.device_config = detect_device()
        self.device = torch.device(self.device_config.device)
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
        self.model = VitsModel.from_pretrained(MODEL_NAME)
        self.model.to(self.device)
        self.model.eval()
        self.sample_rate = int(self.model.config.sampling_rate)

    def synthesize_to_wav_bytes(self, text: str) -> bytes:
        cleaned_text = (text or "").strip()
        if not cleaned_text:
            raise ValueError("Text is required.")

        try:
            inputs = self.tokenizer(cleaned_text, return_tensors="pt")
            inputs = {key: value.to(self.device) for key, value in inputs.items()}

            with torch.no_grad():
                output = self.model(**inputs).waveform

            waveform = output.squeeze().detach().cpu().float().numpy()
            if waveform.size == 0:
                raise TTSGenerationError("Generated audio was empty.")

            # Convert float waveform to 16-bit PCM for broad browser/player support.
            waveform = (waveform.clip(-1.0, 1.0) * 32767.0).astype("int16")

            buffer = BytesIO()
            write_wav(buffer, self.sample_rate, waveform)
            wav_bytes = buffer.getvalue()
            if not wav_bytes:
                raise TTSGenerationError("Generated WAV output was empty.")
            return wav_bytes
        except ValueError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise TTSGenerationError(f"Speech synthesis failed: {exc}") from exc


_engine: TagalogTTSEngine | None = None
_engine_lock = Lock()


def get_tts_engine() -> TagalogTTSEngine:
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                _engine = TagalogTTSEngine()
    return _engine
