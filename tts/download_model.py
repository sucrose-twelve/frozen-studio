"""
Downloads a voice model to where the service looks for it (tts/models/<folder>), with the Python of the
environment that runs it:

    tts/.venv-design/Scripts/python.exe tts/download_model.py           VoxCPM2, about 4.7 GB
    tts/.venv-design/Scripts/python.exe tts/download_model.py qwen      Qwen3-TTS VoiceDesign, about 4.2 GB
    tts/.venv/Scripts/python.exe        tts/download_model.py parler    Japanese Parler-TTS, about 3.5 GB

Only the files the service loads are fetched; sample audio and the like are left out.
"""

import sys
from pathlib import Path

from huggingface_hub import snapshot_download

# name -> repository on Hugging Face, and which of its files to take (None for all of them)
MODELS = {
    "parler": (
        "2121-8/japanese-parler-tts-mini",
        ["*.json", "pytorch_model.bin", "prompt_tokenizer/*", "description_tokenizer/*"],
    ),
    "qwen": ("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", None),
    "voxcpm": ("openbmb/VoxCPM2", None),
}

name = sys.argv[1] if len(sys.argv) > 1 else "voxcpm"
if name not in MODELS:
    sys.exit(f"Unknown model {name!r}. Pick one of: {', '.join(MODELS)}")

repository, patterns = MODELS[name]
target = Path(__file__).parent / "models" / repository.split("/")[-1]
snapshot_download(repo_id=repository, local_dir=target, allow_patterns=patterns)
print(f"Model ready at {target}")
