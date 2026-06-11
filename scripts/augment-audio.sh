#!/usr/bin/env bash
# テスト音声のデータ拡張(評価ハーネスの因子を作る)。
#   - ノイズ重畳(SNR段階別)
#   - 話速変更(atempo)
#   - フィラーは合成テキスト側(dataset.json の filler ケース)で表現するため、ここでは扱わない
#
# 依存: ffmpeg。ノイズ源 fixtures/audio/noise.wav が無ければホワイトノイズを自動生成。
#
# 使い方:
#   scripts/augment-audio.sh fixtures/audio/order-001.wav      # 既定の SNR/話速一式を生成
set -euo pipefail

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg が必要です。" >&2; exit 2
fi

IN="${1:?入力WAV(lsb16k想定)を指定}"
BASE="${IN%.wav}"
NOISE="fixtures/audio/noise.wav"

# ノイズ源(なければ16kHz monoのホワイトノイズを2秒生成)
if [ ! -f "$NOISE" ]; then
  ffmpeg -y -f lavfi -i "anoisesrc=d=2:c=white:r=16000:a=0.5" -ac 1 -sample_fmt s16 "$NOISE"
fi

# 話速変更(atempo は 0.5〜2.0 の範囲)
for tempo in 0.9 1.0 1.3; do
  ffmpeg -y -i "$IN" -filter:a "atempo=${tempo}" -ar 16000 -ac 1 -sample_fmt s16 \
    "${BASE}.tempo${tempo}.wav"
done

# SNR段階別にノイズ重畳。amix で混ぜ、ノイズ側の音量で擬似的にSNRを作る。
#   weight が小さいほどノイズ小 = 高SNR。記事では実SNRを別途算出して明記する。
declare -A SNR=( [snr20]=0.10 [snr10]=0.32 [snr05]=0.56 )
for tag in "${!SNR[@]}"; do
  w="${SNR[$tag]}"
  ffmpeg -y -i "$IN" -i "$NOISE" -filter_complex \
    "[1:a]volume=${w}[n];[0:a][n]amix=inputs=2:duration=first:dropout_transition=0[a]" \
    -map "[a]" -ar 16000 -ac 1 -sample_fmt s16 "${BASE}.${tag}.wav"
done

echo "augmented: ${BASE}.{tempo*,snr*}.wav"
