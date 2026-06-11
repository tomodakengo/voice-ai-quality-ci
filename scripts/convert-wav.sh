#!/usr/bin/env bash
# VOICEVOX等の出力WAVを AmiVoice / Chromium fake-capture 双方の要件へ変換する。
#
# 要件:
#   - AmiVoice lsb16k    : 16kHz / 16bit / mono / signed PCM little-endian
#   - Chromium fake音声  : WAV(PCM)。レートは内部でリサンプルされる(notes/results.md参照)。
#
# 使い方: scripts/convert-wav.sh fixtures/audio/order-001.24k.wav fixtures/audio/order-001.wav
# 一括:   for f in fixtures/audio/*.24k.wav; do scripts/convert-wav.sh "$f" "${f%.24k.wav}.wav"; done
set -euo pipefail

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg が見つかりません。インストール: https://ffmpeg.org/download.html" >&2
  exit 2
fi

IN="${1:?入力WAVを指定してください}"
OUT="${2:?出力WAVを指定してください}"

# -ar 16000 : 16kHz / -ac 1 : mono / -sample_fmt s16 : 16bit signed / -acodec pcm_s16le : LE PCM
ffmpeg -y -i "$IN" -ar 16000 -ac 1 -sample_fmt s16 -acodec pcm_s16le "$OUT"
echo "converted: $IN -> $OUT (16kHz/16bit/mono PCM = AmiVoice lsb16k)"
