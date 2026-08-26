#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export HF_HOME="$ROOT/local-runtime/cache/huggingface"
export HUGGINGFACE_HUB_CACHE="$ROOT/local-runtime/cache/huggingface/hub"
export TORCH_HOME="$ROOT/local-runtime/cache/torch"
export MODELSCOPE_CACHE="$ROOT/local-runtime/cache/modelscope"
export VOXCPM2_CACHE_DIR="${VOXCPM2_CACHE_DIR:-$ROOT/local-runtime/models/voxcpm2}"
export VOXCPM2_DEVICE="${VOXCPM2_DEVICE:-mps}"
export VOXCPM2_MAX_LENGTH="${VOXCPM2_MAX_LENGTH:-1024}"
export VOXCPM2_LOAD_DENOISER="${VOXCPM2_LOAD_DENOISER:-false}"
export VOXCPM2_OPTIMIZE="${VOXCPM2_OPTIMIZE:-false}"

export PITCH_VOXCPM2_HOST="${PITCH_VOXCPM2_HOST:-127.0.0.1}"
export PITCH_VOXCPM2_PORT="${PITCH_VOXCPM2_PORT:-9880}"

exec "$ROOT/local-runtime/venvs/voxcpm2/bin/python" "$ROOT/local-runtime/bin/voxcpm2_tts_server.py"
