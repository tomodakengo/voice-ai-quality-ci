/**
 * 評価ハーネス本体。ASR→LLM パイプラインの回帰テスト。
 *
 * 各テストケース × 条件(エンジン/辞書/SNR/話速)について:
 *   1. ASR(既定: 決定的シミュレータ / --real で AmiVoice WS)で仮説テキストを得る
 *   2. CER(参照=正解書き起こし)を計算
 *   3. LLM 抽出(フォールバック含む)→ 期待アクションと judge
 * を回し、以下を集計して Markdown 表 + JSON で出力する:
 *   - エンジン比較(汎用 vs 特化)の CER
 *   - 辞書 before/after の CER(ドメイン用語ケース)
 *   - ASR誤り → LLM抽出の伝播(judge 一致率)
 *
 * 使い方:
 *   npm run eval            # フルセット(シミュレータ)
 *   npm run eval:smoke      # スモーク(数ケース)
 *   tsx scripts/run-eval.ts --real   # 実 AmiVoice WS(要 AMIVOICE_APPKEY / fixtures WAV)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { cer, aggregateCer, type CerResult } from "../src/eval/cer.js";
import { DEFAULT_NORMALIZE } from "../src/eval/normalize.js";
import { simulateAsr, type SimFactors } from "../src/eval/asr-sim.js";
import { extractAction, ruleBasedExtract } from "../src/llm/extract.js";
import { judgeAction } from "../src/eval/judge.js";
import { recognizeWs } from "../src/amivoice/ws-node.js";
import type { Action } from "../src/llm/schema.js";

const SMOKE = process.argv.includes("--smoke");
const REAL = process.argv.includes("--real");
const USE_LLM = process.argv.includes("--llm"); // 既定はフォールバック(決定的)

interface Case {
  id: string;
  text: string;
  domain: string;
  expected: Action;
  tts?: { speaker?: number; speedScale?: number };
  note?: string;
}

interface RunRow {
  caseId: string;
  domain: string;
  engine: string;
  dict: boolean;
  snr: SimFactors["snr"];
  speed: number;
  cer: CerResult;
  judgeMatch: boolean;
  judgeScore: number;
  asrSource: string;
  hypothesis: string;
}

async function asr(ref: string, wavId: string, f: SimFactors): Promise<{ hyp: string; src: string }> {
  if (REAL) {
    const wav = join(process.cwd(), "fixtures/audio", `${wavId}.wav`);
    if (!existsSync(wav)) throw new Error(`fixtures/audio/${wavId}.wav が無い(gen-fixtures→convert を実行)`);
    const r = await recognizeWs({ wavPath: wav, grammar: f.engine === "特化" ? "-a-general" : "-a-general" });
    return { hyp: r.text, src: "amivoice" };
  }
  return { hyp: simulateAsr(ref, f).hypothesis, src: "simulated" };
}

async function extractFrom(hyp: string): Promise<{ action: Action; source: string }> {
  if (USE_LLM) return extractAction(hyp);
  return { action: ruleBasedExtract(hyp), source: "fallback" };
}

async function main(): Promise<void> {
  const ds = JSON.parse(
    await readFile(join(process.cwd(), "fixtures/cases/dataset.json"), "utf8"),
  ) as { cases: Case[] };

  let cases = ds.cases;
  if (SMOKE) cases = cases.slice(0, 2);

  // 条件マトリクス。smoke では絞る。
  const engines: SimFactors["engine"][] = ["汎用", "特化"];
  const dicts = [false, true];
  const snrs: SimFactors["snr"][] = SMOKE ? ["clean", "10dB"] : ["clean", "20dB", "10dB", "5dB"];
  const speeds = SMOKE ? [1.0] : [0.9, 1.0, 1.3];

  const rows: RunRow[] = [];
  for (const c of cases) {
    for (const engine of engines) {
      for (const dict of dicts) {
        for (const snr of snrs) {
          for (const speed of speeds) {
            const f: SimFactors = {
              engine, dict, snr, speed,
              domainTerm: c.domain === "tech",
            };
            const { hyp, src } = await asr(c.text, c.id, f);
            const cerRes = cer(c.text, hyp, DEFAULT_NORMALIZE);
            const ext = await extractFrom(hyp);
            const verdict = await judgeAction(c.expected, ext.action);
            rows.push({
              caseId: c.id, domain: c.domain, engine, dict, snr, speed,
              cer: cerRes, judgeMatch: verdict.match, judgeScore: verdict.score,
              asrSource: src, hypothesis: hyp,
            });
          }
        }
      }
    }
  }

  report(rows, cases);
  await mkdir(join(process.cwd(), "eval/out"), { recursive: true });
  await writeFile(
    join(process.cwd(), "eval/out", SMOKE ? "eval-smoke.json" : "eval-full.json"),
    JSON.stringify({ generatedConditions: { engines, dicts, snrs, speeds }, rows }, null, 2),
    "utf8",
  );
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function avg(ns: number[]): number {
  return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0;
}

function report(rows: RunRow[], cases: Case[]): void {
  const mode = REAL ? "real AmiVoice" : "simulated ASR";
  const extractor = USE_LLM ? "LLM" : "rule-based fallback";
  log(`\n# 評価ハーネス結果  (ASR=${mode}, 抽出=${extractor}, ケース数=${cases.length}, 実行行=${rows.length})`);
  log(`# 日付情報・件数は notes/results.md へ転記する。\n`);

  // 1) エンジン比較(汎用 vs 特化): micro CER
  log("## エンジン比較(micro CER)");
  log("| エンジン | micro CER | judge一致率 |");
  log("|---|---|---|");
  for (const engine of ["汎用", "特化"]) {
    const sub = rows.filter((r) => r.engine === engine);
    const agg = aggregateCer(sub.map((r) => r.cer));
    const match = avg(sub.map((r) => (r.judgeMatch ? 1 : 0)));
    log(`| ${engine} | ${pct(agg.microCer)} | ${pct(match)} |`);
  }

  // 2) 辞書 before/after(ドメイン用語ケースのみ)
  const tech = rows.filter((r) => r.domain === "tech" && r.engine === "汎用");
  if (tech.length) {
    log("\n## 辞書 before/after(techドメイン × 汎用エンジン, micro CER)");
    log("| 辞書 | micro CER | judge一致率 |");
    log("|---|---|---|");
    for (const dict of [false, true]) {
      const sub = tech.filter((r) => r.dict === dict);
      const agg = aggregateCer(sub.map((r) => r.cer));
      const match = avg(sub.map((r) => (r.judgeMatch ? 1 : 0)));
      log(`| ${dict ? "あり" : "なし"} | ${pct(agg.microCer)} | ${pct(match)} |`);
    }
  }

  // 3) SNR別 CER(汎用・辞書なし)
  log("\n## SNR別 CER(汎用・辞書なし)");
  log("| SNR | micro CER |");
  log("|---|---|");
  const snrOrder = ["clean", "20dB", "10dB", "5dB"];
  for (const snr of snrOrder) {
    const sub = rows.filter((r) => r.engine === "汎用" && !r.dict && r.snr === snr);
    if (!sub.length) continue;
    const agg = aggregateCer(sub.map((r) => r.cer));
    log(`| ${snr} | ${pct(agg.microCer)} |`);
  }

  // 4) 誤り伝播: CER帯ごとの judge 一致率
  log("\n## ASR誤り → LLM抽出 の伝播(CER帯別 judge一致率)");
  log("| CER帯 | 行数 | judge一致率 |");
  log("|---|---|---|");
  const bands: Array<[string, (c: number) => boolean]> = [
    ["0% (誤りなし)", (c) => c === 0],
    ["0–10%", (c) => c > 0 && c <= 0.1],
    ["10–25%", (c) => c > 0.1 && c <= 0.25],
    [">25%", (c) => c > 0.25],
  ];
  for (const [label, test] of bands) {
    const sub = rows.filter((r) => test(r.cer.cer));
    if (!sub.length) continue;
    const match = avg(sub.map((r) => (r.judgeMatch ? 1 : 0)));
    log(`| ${label} | ${sub.length} | ${pct(match)} |`);
  }
  log("");
}

function log(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s);
}

void main();
