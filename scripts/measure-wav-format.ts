/**
 * WAVフォーマット要件の特定(2層)。
 *  層1: Chromium fake-capture が取り込むか(E2E spec 側で RMS 実測。ここでは生成のみ)
 *  層2: AmiVoice が受理するか(本スクリプト。成功/無音/エラーを原文つきで記録)
 *
 * order-001(実音声)を各フォーマットに変換して AmiVoice HTTP同期へ送り、
 * 認識テキスト・CER・エラー有無を表にする。
 *
 * 使い方: tsx scripts/measure-wav-format.ts
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseWav, writeWav } from "../src/audio/wav.js";
import { recognizeSync } from "../src/amivoice/http-sync.js";
import { cer } from "../src/eval/cer.js";

const REF = "ホットコーヒーを一杯ください";

function resample(samples: Int16Array, inRate: number, outRate: number): Int16Array {
  if (inRate === outRate) return samples;
  const ratio = inRate / outRate;
  const out = new Int16Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const idx = i * ratio, lo = Math.floor(idx), hi = Math.min(lo + 1, samples.length - 1);
    const f = idx - lo;
    out[i] = Math.round(samples[lo]! * (1 - f) + samples[hi]! * f);
  }
  return out;
}

function toStereo(mono: Int16Array): Int16Array {
  const out = new Int16Array(mono.length * 2);
  for (let i = 0; i < mono.length; i++) { out[i * 2] = mono[i]!; out[i * 2 + 1] = mono[i]!; }
  return out;
}

/** 任意レート/チャンネルのWAVヘッダを書く(16bit固定) */
function wavWith(samples: Int16Array, rate: number, channels: number): Buffer {
  return writeWav(samples, rate, channels);
}

async function main(): Promise<void> {
  const base = parseWav(await readFile(join(process.cwd(), "fixtures/audio/order-001.wav")));
  const mono16k = base.samples;

  const variants: Array<{ name: string; buf: Buffer; contentType?: string }> = [
    { name: "16kHz/16bit/mono PCM (基準=lsb16k)", buf: wavWith(mono16k, 16000, 1) },
    { name: "8kHz/16bit/mono PCM", buf: wavWith(resample(mono16k, 16000, 8000), 8000, 1) },
    { name: "44.1kHz/16bit/mono PCM", buf: wavWith(resample(mono16k, 16000, 44100), 44100, 1) },
    { name: "16kHz/16bit/STEREO PCM", buf: wavWith(toStereo(mono16k), 16000, 2) },
    // ヘッダ無し生PCMをWAVと偽る(壊れた入力)
    { name: "ヘッダ無し生PCM(audio/wav詐称)", buf: Buffer.from(mono16k.buffer, mono16k.byteOffset, mono16k.byteLength) },
    // 空ファイル
    { name: "空(0バイト)", buf: Buffer.alloc(0) },
  ];

  const rows: Array<{ name: string; outcome: string; cerPct: string; detail: string }> = [];
  let totalSec = 0, calls = 0;
  const secOf = (buf: Buffer) => buf.length / 2 / 16000;

  for (const v of variants) {
    let outcome = "成功", cerPct = "-", detail = "";
    try {
      const r = await recognizeSync({ audio: v.buf, contentType: v.contentType ?? "audio/wav", grammar: "-a-general" });
      calls++; totalSec += secOf(v.buf);
      if (!r.text.trim()) { outcome = "無音(空応答)"; detail = "results空/textなし"; }
      else { cerPct = (cer(REF, r.text).cer * 100).toFixed(1) + "%"; detail = r.text; }
    } catch (e) {
      outcome = "エラー";
      detail = (e as Error).message.replace(/\s+/g, " ").slice(0, 160);
    }
    rows.push({ name: v.name, outcome, cerPct, detail });
    console.log(`[${v.name}] => ${outcome} ${cerPct} | ${detail.slice(0, 80)}`);
  }

  const date = new Date().toISOString().slice(0, 10);
  console.log(`\n# AmiVoice WAVフォーマット受理性(-a-general / HTTP同期 / order-001実音声 / ${date})`);
  console.log(`# 試行: ${calls}回 / 音声合計: ${totalSec.toFixed(1)}秒`);
  console.log(`\n| フォーマット | 判定 | CER | 認識結果/エラー原文 |`);
  console.log(`|---|---|---|---|`);
  for (const r of rows) console.log(`| ${r.name} | ${r.outcome} | ${r.cerPct} | ${r.detail.slice(0, 90)} |`);

  await mkdir(join(process.cwd(), "eval/out"), { recursive: true });
  await writeFile(join(process.cwd(), "eval/out/wav-format.json"), JSON.stringify({ date, rows }, null, 2), "utf8");
  console.log(`\n# wrote eval/out/wav-format.json`);
}

void main();
