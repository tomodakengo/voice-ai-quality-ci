/**
 * 依存なし(ffmpeg/VOICEVOX不要)の合成WAV生成。
 *
 * 用途:
 * - E2E が動くための最小フィクスチャ(mock ASR は音声内容を見ないので合成音で十分)。
 * - Chromium fake audio の WAV フォーマット要件を切り分ける検証用に、
 *   サンプリングレート/ビット深度/チャンネル数を変えた WAV を一括生成する。
 *
 * 実音声の認識精度検証は VOICEVOX 等の TTS が必要(scripts/gen-fixtures.md 参照)。
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeWav } from "../src/audio/wav.js";

const OUT = join(process.cwd(), "fixtures/audio");

/** 周波数列(簡易な発話の代わりにトーン列)で n 秒の Int16 サンプルを作る */
function tone(durSec: number, rate: number, freqs: number[]): Int16Array {
  const total = Math.floor(durSec * rate);
  const out = new Int16Array(total);
  const per = Math.floor(total / freqs.length);
  for (let i = 0; i < total; i++) {
    const f = freqs[Math.min(freqs.length - 1, Math.floor(i / per))]!;
    const env = Math.min(1, i / (rate * 0.02), (total - i) / (rate * 0.02));
    out[i] = Math.round(Math.sin((2 * Math.PI * f * i) / rate) * 0.3 * 0x7fff * env);
  }
  return out;
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const variants: Array<{ name: string; rate: number; channels: number }> = [
    // 本命: 16kHz / mono(AmiVoice lsb16k と Chromium fake capture の推奨)
    { name: "hello_16k_mono.wav", rate: 16000, channels: 1 },
    // フォーマット要件の切り分け用
    { name: "hello_8k_mono.wav", rate: 8000, channels: 1 },
    { name: "hello_44k_mono.wav", rate: 44100, channels: 1 },
    { name: "hello_16k_stereo.wav", rate: 16000, channels: 2 },
    { name: "order_16k_mono.wav", rate: 16000, channels: 1 },
    { name: "meeting_16k_mono.wav", rate: 16000, channels: 1 },
  ];

  for (const v of variants) {
    const mono = tone(1.5, v.rate, [440, 550, 660, 520, 480]);
    let samples = mono;
    if (v.channels === 2) {
      samples = new Int16Array(mono.length * 2);
      for (let i = 0; i < mono.length; i++) {
        samples[i * 2] = mono[i]!;
        samples[i * 2 + 1] = mono[i]!;
      }
    }
    const buf = writeWav(samples, v.rate, v.channels);
    await writeFile(join(OUT, v.name), buf);
    // eslint-disable-next-line no-console
    console.log(`wrote ${v.name} (${v.rate}Hz, ${v.channels}ch, ${buf.length} bytes)`);
  }
}

void main();
