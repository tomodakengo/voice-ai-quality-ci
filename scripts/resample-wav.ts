/**
 * 依存なし(ffmpeg不要)の WAV リサンプラ。
 * 任意レートの PCM16 mono/stereo を 16kHz/16bit/mono(AmiVoice lsb16k)へ変換する。
 *
 * 用途: SAPI(22.05kHz)や VOICEVOX(24kHz)の出力を AmiVoice 要件へ揃える。
 * 線形補間。高品質が必要なら ffmpeg(scripts/convert-wav.*)を使う。
 *
 * 使い方:
 *   tsx scripts/resample-wav.ts fixtures/audio/order-001.sapi.wav fixtures/audio/order-001.wav
 *   tsx scripts/resample-wav.ts --glob '*.sapi.wav'   # 一括(.sapi.wav -> .wav)
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { parseWav, writeWav } from "../src/audio/wav.js";

const TARGET_RATE = 16000;
const DIR = join(process.cwd(), "fixtures/audio");

function toMono(samples: Int16Array, channels: number): Int16Array {
  if (channels === 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += samples[i * channels + c]!;
    mono[i] = Math.round(sum / channels);
  }
  return mono;
}

function resampleLinear(mono: Int16Array, inRate: number, outRate: number): Int16Array {
  if (inRate === outRate) return mono;
  const ratio = inRate / outRate;
  const outLen = Math.floor(mono.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, mono.length - 1);
    const frac = idx - lo;
    out[i] = Math.round(mono[lo]! * (1 - frac) + mono[hi]! * frac);
  }
  return out;
}

async function convert(inPath: string, outPath: string): Promise<void> {
  const wav = parseWav(await readFile(inPath));
  const mono = toMono(wav.samples, wav.channels);
  const resampled = resampleLinear(mono, wav.sampleRate, TARGET_RATE);
  await writeFile(outPath, writeWav(resampled, TARGET_RATE, 1));
  // eslint-disable-next-line no-console
  console.log(`${basename(inPath)} (${wav.sampleRate}Hz/${wav.channels}ch) -> ${basename(outPath)} (16000Hz/1ch)`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--glob") {
    const pattern = args[1] ?? "*.sapi.wav";
    const suffix = pattern.replace(/^\*/, "");
    const files = (await readdir(DIR)).filter((f) => f.endsWith(suffix));
    for (const f of files) {
      const out = f.replace(suffix, ".wav");
      await convert(join(DIR, f), join(DIR, out));
    }
    return;
  }
  if (args.length < 2) {
    console.error("usage: resample-wav.ts <in.wav> <out.wav> | --glob '*.sapi.wav'");
    process.exit(2);
  }
  await convert(args[0]!, args[1]!);
}

void main();
