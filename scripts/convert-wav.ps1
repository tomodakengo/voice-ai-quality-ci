# Windows(PowerShell)版 WAV 変換。AmiVoice lsb16k(16kHz/16bit/mono)へ。
# 使い方: pwsh scripts/convert-wav.ps1 fixtures/audio/order-001.24k.wav fixtures/audio/order-001.wav
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out
)
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Error "ffmpeg が見つかりません。winget install Gyan.FFmpeg 等でインストールしてください。"
  exit 2
}
ffmpeg -y -i $In -ar 16000 -ac 1 -sample_fmt s16 -acodec pcm_s16le $Out
Write-Host "converted: $In -> $Out (16kHz/16bit/mono PCM = AmiVoice lsb16k)"
