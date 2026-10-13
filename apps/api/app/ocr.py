"""OCR for written notes (photos / scans of handwriting or printed pages).

Uses GOT-OCR 2.0 (stepfun-ai/GOT-OCR-2.0-hf) through Hugging Face transformers.
The weights (~1.5 GB) are downloaded automatically the first time the model is
used and cached in ~/.cache/huggingface. To try a different OCR model, write
another class with a ``read(image_bytes) -> str`` method and return it from
``get_ocr_engine``; nothing else in the app needs to change.
"""

import io
import threading

from app import config


class OCRUnavailableError(RuntimeError):
    """The OCR dependencies (torch / transformers / pillow) aren't installed."""


class OCRError(RuntimeError):
    """The image could not be read."""


class GotOcrEngine:
    def __init__(self, model_id: str) -> None:
        try:
            import torch
            from transformers import AutoModelForImageTextToText, AutoProcessor
        except ImportError as exc:
            raise OCRUnavailableError(
                "OCR is not installed. Run `uv sync --extra ocr` in the apps/api folder."
            ) from exc

        self._torch = torch
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._processor = AutoProcessor.from_pretrained(model_id)
        model = AutoModelForImageTextToText.from_pretrained(model_id)
        if self._device == "cpu":
            # Newer transformers loads this model in bfloat16, which is slow and
            # error-prone on CPU. float32 is the safe choice there.
            model = model.to(torch.float32)
        self._model = model.to(self._device)
        self._model.eval()
        # The model isn't safe to call from several threads at once.
        self._lock = threading.Lock()

    def read(self, image_bytes: bytes) -> str:
        from PIL import Image, ImageOps, UnidentifiedImageError

        try:
            image = Image.open(io.BytesIO(image_bytes))
            image = ImageOps.exif_transpose(image).convert("RGB")  # fix phone-photo rotation
        except (UnidentifiedImageError, OSError) as exc:
            raise OCRError("Could not read this image.") from exc

        try:
            with self._lock, self._torch.inference_mode():
                # Match the image tensors to the model's own number type
                # (only floating-point tensors are converted, not token ids).
                inputs = self._processor(image, return_tensors="pt").to(
                    self._device, dtype=self._model.dtype
                )
                output_ids = self._model.generate(
                    **inputs,
                    do_sample=False,
                    tokenizer=self._processor.tokenizer,
                    stop_strings="<|im_end|>",
                    max_new_tokens=4096,
                )
                new_tokens = output_ids[0, inputs["input_ids"].shape[1]:]
                return self._processor.decode(new_tokens, skip_special_tokens=True)
        except Exception as exc:
            raise OCRError(f"The OCR model failed on this image: {exc}") from exc


_engine: GotOcrEngine | None = None
_engine_lock = threading.Lock()


def get_ocr_engine() -> GotOcrEngine:
    """Load the model once, on first use (not at app startup)."""
    global _engine
    with _engine_lock:
        if _engine is None:
            _engine = GotOcrEngine(config.OCR_MODEL_ID)
        return _engine


def extract_text_from_image(image_bytes: bytes) -> str:
    return get_ocr_engine().read(image_bytes)