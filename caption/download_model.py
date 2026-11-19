"""
Downloads a captioning model to where the service looks for it. Without an argument that is the default
one, Ministral 3 8B Uncensored in FP8 (about 11.8 GB):

    caption/.venv/Scripts/python.exe caption/download_model.py

Another vision-language model is named by its Hugging Face repository, and lands in a folder of the same
name under caption/models. Point CAPTION_MODEL_DIR at that folder to use it:

    caption/.venv/Scripts/python.exe caption/download_model.py huihui-ai/Huihui-Qwen3-VL-4B-Instruct-abliterated

Only the files the service loads are fetched: the configuration, the tokenizer and the weights.
"""

import sys
from pathlib import Path

from huggingface_hub import snapshot_download

DEFAULT_REPOSITORY = "Felldude/Ministral-3-8B-Uncensored-FP8"

repository = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_REPOSITORY
target = Path(__file__).parent / "models" / repository.split("/")[-1]

snapshot_download(
    repo_id=repository,
    local_dir=target,
    # merges.txt and vocab.json are the tokenizer files of the Qwen models
    allow_patterns=["*.json", "*.jinja", "*.txt", "*.safetensors"],
)
print(f"Model ready at {target}")
