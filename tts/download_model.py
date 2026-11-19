"""
Downloads the Japanese Parler-TTS model (about 3.5 GB) to where the service looks for it:

    tts/.venv/Scripts/python.exe tts/download_model.py

Only the files the service loads are fetched; the repository's sample audio is left out.
"""

from pathlib import Path

from huggingface_hub import snapshot_download

REPOSITORY = "2121-8/japanese-parler-tts-mini"
TARGET = Path(__file__).parent / "models" / "japanese-parler-tts-mini"

snapshot_download(
    repo_id=REPOSITORY,
    local_dir=TARGET,
    allow_patterns=["*.json", "pytorch_model.bin", "prompt_tokenizer/*", "description_tokenizer/*"],
)
print(f"Model ready at {TARGET}")
