/**
 * 実 AmiVoice によるノイズSNR段階別 CER 実測。
 *
 * 各ケースの clean WAV にNode製ノイズミキサ(src/audio/augment.ts)で校正済み
 * ホワイトノイズを重畳し(SNR=clean/20/10/5 dB)、AmiVoice 汎用エンジンで認識して
 * CER を測る。実SNRは計算値を併記。試行回数・音声合計秒数も出力。
 *
 * 使い方: tsx scripts/measure-snr.ts [--cases order-001,filler-001]
 * 要: AMIVOICE_APPKEY、fixtures/audio/<id>.wav。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { parseWav, writeWav } from "../src/audio/wav.js";
import { addNoiseAtSnr } from "../src/audio/augment.js";
import { recognizeSync } from "../src/amivoice/http-sync.js";
import { cer } from "../src/eval/cer.js";
import { DEFAULT_NORMALIZE } from "../src/eval/normalize.js";

interface Case { id: string; text: string }

const SNRS: Array<{ tag: string; db: number | null }> = [
  { tag: "clean", db: null },
  { tag: "20dB", db: 20 },
  { tag: "10dB", db: 10 },
  { tag: "5dB", db: 5 },
];

async function main(): Promise<void> {
  const ds = JSON.parse(await readFile(join(process.cwd(), "fixtures/cases/dataset.json"), "utf8")) as { cases: Case[] };
  const argIdx = process.argv.indexOf("--cases");
  const only = argIdx >= 0 ? process.argv[argIdx + 1]!.split(",") : ["order-001", "order-002", "filler-001"];
  const cases = ds.cases.filter((c) => only.includes(c.id));

  const rows: Array<{ id: string; snr: string; actualSnrDb: number | null; cer: number; hyp: string; sec: number }> = [];
  let totalSec = 0;
  let calls = 0;

  for (const c of cases) {
    const wavPath = join(process.cwd(), "fixtures/audio", `${c.id}.wav`);
    if (!existsSync(wavPath)) { console.error(`skip ${c.id}`); continue; }
    const wav = parseWav(await readFile(wavPath));
    const sec = wav.samples.length / wav.channels / wav.sampleRate;

    for (const s of SNRS) {
      let audioBuf: Buffer;
      let actual: number | null = null;
      if (s.db === null) {
        audioBuf = await readFile(wavPath);
      } else {
        const noisy = addNoiseAtSnr(wav.samples, s.db);
        actual = Number(noisy.actualSnrDb.toFixed(1));
        audioBuf = writeWav(noisy.samples, wav.sampleRate, 1);
      }
      const rec = await recognizeSync({ audio: audioBuf, contentType: "audio/wav", grammar: "-a-general" });
      const cerVal = cer(c.text, rec.text, DEFAULT_NORMALIZE).cer;
      rows.push({ id: c.id, snr: s.tag, actualSnrDb: actual, cer: cerVal, hyp: rec.text, sec });
      totalSec += sec; calls++;
      console.log(`${c.id} ${s.tag}(${actual ?? "-"}dB): CER ${(cerVal * 100).toFixed(1)}% | "${rec.text}"`);
    }
  }

  // 集計表(SNR別 micro CER 相当: ここはケース平均=macro)
  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const date = new Date().toISOString().slice(0, 10);
  console.log(`\n# ノイズSNR段階別 CER 実測(AmiVoice -a-general / HTTP同期 / ${date})`);
  console.log(`# 試行: ${calls}回 / 音声合計: ${totalSec.toFixed(1)}秒 / ケース: ${cases.map((c) => c.id).join(", ")}`);
  console.log(`\n| SNR | ケース平均 CER | 試行回数 |`);
  console.log(`|---|---|---|`);
  for (const s of SNRS) {
    const sub = rows.filter((r) => r.snr === s.tag);
    if (!sub.length) continue;
    const mean = sub.reduce((a, r) => a + r.cer, 0) / sub.length;
    console.log(`| ${s.tag}${s.db ? `(実${(sub[0]!.actualSnrDb ?? s.db)}dB)` : ""} | ${pct(mean)} | ${sub.length} |`);
  }

  await mkdir(join(process.cwd(), "eval/out"), { recursive: true });
  await writeFile(join(process.cwd(), "eval/out/snr.json"),
    JSON.stringify({ date, grammar: "-a-general", calls, totalSec, rows }, null, 2), "utf8");
  console.log(`\n# wrote eval/out/snr.json  (API usage this run: ${totalSec.toFixed(1)}s audio, ${calls} calls)`);
}

void main();
