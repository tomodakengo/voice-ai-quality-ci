/**
 * 実 AmiVoice エンジン比較。
 * クーポンで利用可能なのは会話汎用 -a-general と 音声入力向け -a-general-input。
 * ドメイン特化(-a-medgeneral 等)は空応答=権限なし(notes参照, 未測定扱い)。
 *
 * clean では両者ほぼ同等のため、10dB ノイズ重畳版で頑健性差を見る。
 * 使い方: tsx scripts/measure-engine.ts
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseWav, writeWav } from "../src/audio/wav.js";
import { addNoiseAtSnr } from "../src/audio/augment.js";
import { recognizeSync } from "../src/amivoice/http-sync.js";
import { cer } from "../src/eval/cer.js";
import { DEFAULT_NORMALIZE } from "../src/eval/normalize.js";

interface Case { id: string; text: string }
const ENGINES = ["-a-general", "-a-general-input"];
const CONDS: Array<{ tag: string; db: number | null }> = [
  { tag: "clean", db: null },
  { tag: "10dB", db: 10 },
];

async function main(): Promise<void> {
  const ds = JSON.parse(await readFile(join(process.cwd(), "fixtures/cases/dataset.json"), "utf8")) as { cases: Case[] };
  const cases = ds.cases.filter((c) => ["order-001", "order-002", "schedule-002"].includes(c.id));
  const rows: Array<{ id: string; engine: string; cond: string; cer: number; hyp: string }> = [];
  let totalSec = 0, calls = 0;

  for (const c of cases) {
    const wav = parseWav(await readFile(join(process.cwd(), "fixtures/audio", `${c.id}.wav`)));
    const sec = wav.samples.length / wav.channels / wav.sampleRate;
    for (const cond of CONDS) {
      const buf = cond.db === null
        ? writeWav(wav.samples, wav.sampleRate, 1)
        : writeWav(addNoiseAtSnr(wav.samples, cond.db).samples, wav.sampleRate, 1);
      for (const engine of ENGINES) {
        const r = await recognizeSync({ audio: buf, contentType: "audio/wav", grammar: engine });
        const cerVal = cer(c.text, r.text, DEFAULT_NORMALIZE).cer;
        rows.push({ id: c.id, engine, cond: cond.tag, cer: cerVal, hyp: r.text });
        totalSec += sec; calls++;
        console.log(`${c.id} ${cond.tag} ${engine}: CER ${(cerVal * 100).toFixed(1)}% | "${r.text}"`);
      }
    }
  }

  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const date = new Date().toISOString().slice(0, 10);
  console.log(`\n# エンジン比較(AmiVoice / HTTP同期 / ${date})`);
  console.log(`# 試行: ${calls}回 / 音声合計: ${totalSec.toFixed(1)}秒`);
  console.log(`\n| 条件 | エンジン | ケース平均 CER | 試行 |`);
  console.log(`|---|---|---|---|`);
  for (const cond of CONDS) for (const engine of ENGINES) {
    const sub = rows.filter((r) => r.cond === cond.tag && r.engine === engine);
    const mean = sub.reduce((a, r) => a + r.cer, 0) / sub.length;
    console.log(`| ${cond.tag} | ${engine} | ${pct(mean)} | ${sub.length} |`);
  }

  await mkdir(join(process.cwd(), "eval/out"), { recursive: true });
  await writeFile(join(process.cwd(), "eval/out/engine.json"),
    JSON.stringify({ date, calls, totalSec, rows }, null, 2), "utf8");
  console.log(`\n# wrote eval/out/engine.json (API usage: ${totalSec.toFixed(1)}s, ${calls} calls)`);
}

void main();
