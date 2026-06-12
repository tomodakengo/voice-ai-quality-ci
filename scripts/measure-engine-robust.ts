/**
 * 実 AmiVoice エンジン比較の「多seed」実測(measure-snr-robust と同じ思想)。
 *
 * 単発(seed1本)の measure-engine.ts では 10dB で -a-general 36.5% vs -a-general-input 14.3% と
 * 出たが、ノイズ入りCERは seed で2〜3倍ブレる(gotchas#17)。エンジン優位が seed 依存の
 * まぐれでないことを確かめるため、10dB を seed 5本で測り直す。
 *
 * 公平性: 同一 (case, seed) のノイズ波形を**両エンジンに食わせる**(同じ1枚で勝負)。
 *
 * 使い方: tsx scripts/measure-engine-robust.ts [--seeds 5]
 * 要: AMIVOICE_APPKEY、fixtures/audio/<id>.wav。
 */
import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseWav, writeWav } from "../src/audio/wav.js";
import { addNoiseAtSnr } from "../src/audio/augment.js";
import { recognizeSync } from "../src/amivoice/http-sync.js";
import { cer } from "../src/eval/cer.js";
import { DEFAULT_NORMALIZE } from "../src/eval/normalize.js";

interface Case { id: string; text: string }
const ENGINES = ["-a-general", "-a-general-input"];
const SEED_POOL = [12345, 23456, 34567, 45678, 56789, 67890, 78901, 89012];

function mean(xs: number[]): number { return xs.reduce((a, b) => a + b, 0) / xs.length; }
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

async function main(): Promise<void> {
  const ds = JSON.parse(await readFile(join(process.cwd(), "fixtures/cases/dataset.json"), "utf8")) as { cases: Case[] };
  const cases = ds.cases.filter((c) => ["order-001", "order-002", "schedule-002"].includes(c.id));

  const seedArg = process.argv.indexOf("--seeds");
  const nSeeds = seedArg >= 0 ? Math.max(1, Math.min(SEED_POOL.length, Number(process.argv[seedArg + 1]))) : 5;
  const seeds = SEED_POOL.slice(0, nSeeds);

  interface Row { id: string; engine: string; cond: string; seed: number | null; cer: number; hyp: string }
  const rows: Row[] = [];
  let totalSec = 0, calls = 0;

  for (const c of cases) {
    const wav = parseWav(await readFile(join(process.cwd(), "fixtures/audio", `${c.id}.wav`)));
    const sec = wav.samples.length / wav.channels / wav.sampleRate;

    // clean(決定的・1回)
    const cleanBuf = writeWav(wav.samples, wav.sampleRate, 1);
    for (const engine of ENGINES) {
      const r = await recognizeSync({ audio: cleanBuf, contentType: "audio/wav", grammar: engine });
      const cerVal = cer(c.text, r.text, DEFAULT_NORMALIZE).cer;
      rows.push({ id: c.id, engine, cond: "clean", seed: null, cer: cerVal, hyp: r.text });
      totalSec += sec; calls++;
      console.log(`${c.id} clean ${engine}: CER ${(cerVal * 100).toFixed(1)}% | "${r.text}"`);
    }

    // 10dB: seed ごとに同じノイズ波形を両エンジンへ
    for (const seed of seeds) {
      const noisyBuf = writeWav(addNoiseAtSnr(wav.samples, 10, seed).samples, wav.sampleRate, 1);
      for (const engine of ENGINES) {
        const r = await recognizeSync({ audio: noisyBuf, contentType: "audio/wav", grammar: engine });
        const cerVal = cer(c.text, r.text, DEFAULT_NORMALIZE).cer;
        rows.push({ id: c.id, engine, cond: "10dB", seed, cer: cerVal, hyp: r.text });
        totalSec += sec; calls++;
        console.log(`${c.id} 10dB/seed${seed} ${engine}: CER ${(cerVal * 100).toFixed(1)}% | "${r.text}"`);
      }
    }
  }

  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const date = new Date().toISOString().slice(0, 10);
  console.log(`\n# エンジン比較 多seed実測(AmiVoice / HTTP同期 / ${date})`);
  console.log(`# seed数: ${seeds.length} / 総コール: ${calls} / 音声合計: ${totalSec.toFixed(1)}秒 / ケース: ${cases.map((c) => c.id).join(", ")}`);

  // clean
  console.log(`\n| 条件 | エンジン | ケース平均 CER | 試行 |`);
  console.log(`|---|---|---|---|`);
  for (const engine of ENGINES) {
    const sub = rows.filter((r) => r.cond === "clean" && r.engine === engine);
    console.log(`| clean | ${engine} | ${pct(mean(sub.map((r) => r.cer)))}(決定的) | ${sub.length} |`);
  }
  // 10dB: seed ごとに macro(ケース平均)→ seed間で mean±σ
  for (const engine of ENGINES) {
    const macroPerSeed = seeds.map((seed) => {
      const sub = rows.filter((r) => r.cond === "10dB" && r.engine === engine && r.seed === seed);
      return mean(sub.map((r) => r.cer));
    });
    const lo = Math.min(...macroPerSeed), hi = Math.max(...macroPerSeed);
    console.log(`| 10dB | ${engine} | ${pct(mean(macroPerSeed))} ± ${(stddev(macroPerSeed) * 100).toFixed(1)}pt(${pct(lo)}〜${pct(hi)}) | ${seeds.length}seed×${cases.length} |`);
  }

  // seed別で「どちらが勝ったか」(対戦表)
  console.log(`\n# 10dB seed別の対戦(macro CER / 太字=勝ち)`);
  console.log(`| seed | -a-general | -a-general-input | 勝者 |`);
  console.log(`|---|---|---|---|`);
  let inputWins = 0;
  for (const seed of seeds) {
    const g = mean(rows.filter((r) => r.cond === "10dB" && r.engine === "-a-general" && r.seed === seed).map((r) => r.cer));
    const gi = mean(rows.filter((r) => r.cond === "10dB" && r.engine === "-a-general-input" && r.seed === seed).map((r) => r.cer));
    const winner = gi < g ? "input" : gi > g ? "general" : "tie";
    if (gi < g) inputWins++;
    console.log(`| ${seed} | ${pct(g)} | ${pct(gi)} | ${winner} |`);
  }
  console.log(`\n→ -a-general-input が ${inputWins}/${seeds.length} seed で勝利(CERが低い)。`);

  await mkdir(join(process.cwd(), "eval/out"), { recursive: true });
  await writeFile(join(process.cwd(), "eval/out/engine-robust.json"),
    JSON.stringify({ date, seeds, calls, totalSec, rows }, null, 2), "utf8");
  console.log(`\n# wrote eval/out/engine-robust.json (API usage: ${totalSec.toFixed(1)}s, ${calls} calls)`);
}

void main();
