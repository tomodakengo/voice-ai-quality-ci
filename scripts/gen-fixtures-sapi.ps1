# テスト発話を Windows SAPI(Microsoft Haruka, ja-JP)で合成する。
# VOICEVOX が無い環境向けの再現性ある TTS 経路(Windows標準機能のみ)。
# 出力: fixtures/audio/<id>.sapi.wav(22.05kHz)。後段で resample-wav.ts が 16kHz 化。
#
# 使い方: powershell -ExecutionPolicy Bypass -File scripts/gen-fixtures-sapi.ps1
Add-Type -AssemblyName System.Speech
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "fixtures/audio"
if (-not (Test-Path $out)) { New-Item -ItemType Directory -Force $out | Out-Null }

# dataset.json から id / text を読む(正解文と一致させる)
$ds = Get-Content (Join-Path $root "fixtures/cases/dataset.json") -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($c in $ds.cases) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try { $synth.SelectVoice("Microsoft Haruka Desktop") } catch {
    Write-Warning "Haruka(ja-JP)が見つかりません。日本語音声をインストールしてください。"; throw
  }
  $path = Join-Path $out ("{0}.sapi.wav" -f $c.id)
  $synth.SetOutputToWaveFile($path)
  $synth.Speak($c.text)
  $synth.Dispose()
  Write-Host ("synth {0}: {1}" -f $c.id, $c.text)
}
Write-Host "`n次: npm run pipeline:real(resample 16k -> AmiVoice -> CER)"
