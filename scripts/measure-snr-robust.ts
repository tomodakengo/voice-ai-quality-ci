/**
 * ノイズSNR段階別 CER の「多seed」実測 + レイテンシ計測(記事の堅さ補強)。
 *
 * 既存 measure-snr.ts は単一seed(12345)・各1回だった。本スクリプトは:
 *   1. ノイズseedを N 本振り、SNR×ケースごとに CER の mean±σ を出す
 *      → 「崖(20dB→10dB)が seed を変えても再現するか」を定量化する
 *   2. 中間点 15dB を追加し、崖の位置を狭める
 *   3. recognizeSync の wall-clock を全コールで記録し、レイテンシ分布(mean/median/p95)を出す
 *      ※ レイテンシは測定環境→AmiVoice の往復を含む。回線依存である点を必ず併記する。
 *
 * 使い方: tsx scripts/measure-snr-robust.ts [--cases a,b] [--seeds 5]
 * 要: AMIVOICE_APPKEY、fixtures/audio/<id>.wav。
 *
 * クーポン消費の目安: ケース数 × (1 clean + 4 SNR × seeds) コール。
 *   6ケース × (1 + 4×5) = 126コール ≈ 音声8分前後。実行前に表示して確認する。
 */
import "dotenv/config";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { parseWav, writeWav } from "../src/audio/wav.js";
import { addNoiseAtSnr } from "../src/audio/augment.js";
import { recognizeSync } from "../src/amivoice/http-sync.js";
import { cer } from "../src/eval/cer.js";
import { DEFAULT_NORMALIZE } from "../src/eval/normalize.js";

interface Case { id: string; text: string }

const SNRS: Array<{ tag: string; db: number | null }> = [
  { tag: "clean", db: null },
  { tag: "20dB", db: 20 },
  { tag: "15dB", db: 15 },
  { tag: "10dB", db: 10 },
  { tag: "5dB", db: 5 },
];

// 決定的に振るノイズseed群(再現可能)。clean は無音化不要なので1回のみ。
const SEED_POOL = [12345, 23456, 34567, 45678, 56789, 67890, 78901, 89012];

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); // 標本標準偏差
}
function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function main(): Promise<void> {
  const ds = JSON.parse(
    await readFile(join(process.cwd(), "fixtures/cases/dataset.json"), "utf8"),
  ) as { cases: Case[] };

  const caseArg = process.argv.indexOf("--cases");
  const only = caseArg >= 0
    ? process.argv[caseArg + 1]!.split(",")
    : ["order-001", "order-002", "schedule-001", "schedule-002", "domain-001", "filler-001"];
  const seedArg = process.argv.indexOf("--seeds");
  const nSeeds = seedArg >= 0 ? Math.max(1, Math.min(SEED_POOL.length, Number(process.argv[seedArg + 1]))) : 5;
  const seeds = SEED_POOL.slice(0, nSeeds);

  const cases = ds.cases.filter((c) => only.includes(c.id));

  // 各 (case, snr, seed) の行
  interface Row {
    id: string; snr: string; db: number | null; seed: number | null;
    actualSnrDb: number | null; cer: number; hyp: string; sec: number; latencyMs: number;
  }
  const rows: Row[] = [];
  const latencies: number[] = [];
  let totalSec = 0;
  let calls = 0;

  const noisyCalls = cases.length * (SNRS.length - 1) * seeds.length;
  console.log(`# plan: ${cases.length}ケース × (1 clean + ${SNRS.length - 1} SNR × ${seeds.length} seed) = ${cases.length + noisyCalls} コール`);

  for (const c of cases) {
    const wavPath = join(process.cwd(), "fixtures/audio", `${c.id}.wav`);
    if (!existsSync(wavPath)) { console.error(`skip ${c.id}`); continue; }
    const cleanBuf = await readFile(wavPath);
    const wav = parseWav(cleanBuf);
    const sec = wav.samples.length / wav.channels / wav.sampleRate;

    for (const s of SNRS) {
      // clean は決定的なので1回、ノイズは seeds 本
      const trialSeeds: Array<number | null> = s.db === null ? [null] : seeds;
      for (const seed of trialSeeds) {
        let audioBuf: Buffer;
        let actual: number | null = null;
        if (s.db === null) {
          audioBuf = cleanBuf;
        } else {
          const noisy = addNoiseAtSnr(wav.samples, s.db, seed!);
          actual = Number(noisy.actualSnrDb.toFixed(1));
          audioBuf = writeWav(noisy.samples, wav.sampleRate, 1);
        }
        const t0 = performance.now();
        const rec = await recognizeSync({ audio: audioBuf, contentType: "audio/wav", grammar: "-a-general" });
        const latencyMs = performance.now() - t0;
        const cerVal = cer(c.text, rec.text, DEFAULT_NORMALIZE).cer;
        rows.push({ id: c.id, snr: s.tag, db: s.db, seed, actualSnrDb: actual, cer: cerVal, hyp: rec.text, sec, latencyMs });
        latencies.push(latencyMs);
        totalSec += sec; calls++;
        console.log(`${c.id} ${s.tag}${seed !== null ? `/seed${seed}` : ""}: CER ${(cerVal * 100).toFixed(1)}% | ${latencyMs.toFixed(0)}ms | "${rec.text}"`);
      }
    }
  }

  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const date = new Date().toISOString().slice(0, 10);

  // --- 表1: SNR別 macro CER の mean±σ(seedごとにケース平均→seed間で集計) ---
  console.log(`\n# ノイズSNR段階別 CER 多seed実測(AmiVoice -a-general / HTTP同期 / ${date})`);
  console.log(`# seed数: ${seeds.length} / 総コール: ${calls} / 音声合計: ${totalSec.toFixed(1)}秒 / ケース: ${cases.map((c) => c.id).join(", ")}`);
  console.log(`\n| SNR | macro CER (mean±σ) | seed間レンジ | 試行 |`);
  console.log(`|---|---|---|---|`);
  for (const s of SNRS) {
    if (s.db === null) {
      const sub = rows.filter((r) => r.snr === s.tag);
      const m = mean(sub.map((r) => r.cer));
      console.log(`| clean | ${pct(m)} (決定的) | — | ${sub.length} |`);
      continue;
    }
    // seedごとにケース平均(macro)を出す → seed間で mean±σ
    const macroPerSeed = seeds.map((seed) => {
      const sub = rows.filter((r) => r.snr === s.tag && r.seed === seed);
      return mean(sub.map((r) => r.cer));
    });
    const m = mean(macroPerSeed);
    const sd = stddev(macroPerSeed);
    const lo = Math.min(...macroPerSeed), hi = Math.max(...macroPerSeed);
    console.log(`| ${s.tag} | ${pct(m)} ± ${(sd * 100).toFixed(1)}pt | ${pct(lo)}〜${pct(hi)} | ${seeds.length}seed×${cases.length} |`);
  }

  // --- 表2: 崖の主役 order-001 のケース別(seed分散が一番出る) ---
  console.log(`\n# order-001 のSNR別 CER(seed分散)`);
  console.log(`| SNR | CER (mean±σ) | seed別 |`);
  console.log(`|---|---|---|`);
  for (const s of SNRS) {
    const sub = rows.filter((r) => r.id === "order-001" && r.snr === s.tag);
    if (!sub.length) continue;
    const cers = sub.map((r) => r.cer);
    const detail = s.db === null ? "決定的" : cers.map((x) => (x * 100).toFixed(0) + "%").join(", ");
    console.log(`| ${s.tag} | ${pct(mean(cers))}${sub.length > 1 ? ` ± ${(stddev(cers) * 100).toFixed(1)}pt` : ""} | ${detail} |`);
  }

  // --- 表3: レイテンシ分布 ---
  console.log(`\n# recognize レイテンシ(HTTP同期 / ${calls}コール / wall-clock・回線往復込み)`);
  console.log(`| 指標 | 値 |`);
  console.log(`|---|---|`);
  console.log(`| n | ${latencies.length} |`);
  console.log(`| mean | ${mean(latencies).toFixed(0)} ms |`);
  console.log(`| median (p50) | ${percentile(latencies, 50).toFixed(0)} ms |`);
  console.log(`| p95 | ${percentile(latencies, 95).toFixed(0)} ms |`);
  console.log(`| min / max | ${Math.min(...latencies).toFixed(0)} / ${Math.max(...latencies).toFixed(0)} ms |`);
  console.log(`# 注: 短尺クリップ(各約${(totalSec / calls).toFixed(1)}秒)の同期認識。長尺・WSストリーミングのレイテンシ特性は別。`);

  await mkdir(join(process.cwd(), "eval/out"), { recursive: true });
  await writeFile(
    join(process.cwd(), "eval/out/snr-robust.json"),
    JSON.stringify({
      date, grammar: "-a-general", seeds, calls, totalSec,
      latency: {
        n: latencies.length, meanMs: mean(latencies), medianMs: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95), minMs: Math.min(...latencies), maxMs: Math.max(...latencies),
      },
      rows,
    }, null, 2),
    "utf8",
  );
  console.log(`\n# wrote eval/out/snr-robust.json  (API usage this run: ${totalSec.toFixed(1)}s audio, ${calls} calls)`);
}

void main();
