/**
 * 実 AmiVoice + 実 LLM による実測スクリプト(記事の一次データ)。
 *
 * 測定内容:
 *   1. 各ケースを AmiVoice 汎用エンジン(-a-general, HTTP同期)で認識し、認識文を取得
 *   2. CER を 3 つの正規化プリセットで計算し、正規化ルール感度を表にする
 *        - default          : 空白・記号除去
 *        - +digits          : 漢数字→算用数字も寄せる
 *        - +digits+fillers  : フィラー除去も加える
 *   3. 認識文 → 実 LLM 抽出 → 期待アクションと実 LLM judge(誤り伝播)
 *
 * 測定条件は必ず出力に残す(エンジン名・日付・試行回数)。
 * クーポン消費に配慮し、各ケース1回・短尺クリップのみ。
 *
 * 使い方: tsx scripts/measure-real.ts [--out eval/out/real.json]
 * 要: AMIVOICE_APPKEY, ANTHROPIC_API_KEY(.env)。音声は fixtures/audio/<id>.wav。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { recognizeSync } from "../src/amivoice/http-sync.js";
import { cer } from "../src/eval/cer.js";
import { extractAction } from "../src/llm/extract.js";
import { judgeAction } from "../src/eval/judge.js";
import type { Action } from "../src/llm/schema.js";

interface Case {
  id: string;
  text: string;
  normalizedText?: string;
  domain: string;
  expected: Action;
}

const GRAMMAR = process.env.AMIVOICE_GRAMMAR ?? "-a-general";
const PRESETS = {
  default: { stripSpace: true, stripPunct: true },
  "+digits": { stripSpace: true, stripPunct: true, normalizeDigits: true },
  "+digits+fillers": { stripSpace: true, stripPunct: true, normalizeDigits: true, stripFillers: true },
} as const;

async function main(): Promise<void> {
  const ds = JSON.parse(
    await readFile(join(process.cwd(), "fixtures/cases/dataset.json"), "utf8"),
  ) as { cases: Case[] };

  const rows: Array<{
    id: string;
    domain: string;
    reference: string;
    hypothesis: string;
    cerDefault: number;
    cerDigits: number;
    cerDigitsFillers: number;
    extractSource: string;
    action: Action;
    judgeMatch: boolean;
    judgeScore: number;
  }> = [];

  for (const c of ds.cases) {
    const wav = join(process.cwd(), "fixtures/audio", `${c.id}.wav`);
    if (!existsSync(wav)) {
      console.error(`skip ${c.id}: ${wav} が無い`);
      continue;
    }
    const audio = await readFile(wav);
    const rec = await recognizeSync({ audio, contentType: "audio/wav", grammar: GRAMMAR });
    const ref = c.text;
    const hyp = rec.text;

    const cDef = cer(ref, hyp, PRESETS.default).cer;
    const cDig = cer(ref, hyp, PRESETS["+digits"]).cer;
    const cDigFil = cer(ref, hyp, PRESETS["+digits+fillers"]).cer;

    const ext = await extractAction(hyp);
    const verdict = await judgeAction(c.expected, ext.action);

    rows.push({
      id: c.id, domain: c.domain, reference: ref, hypothesis: hyp,
      cerDefault: cDef, cerDigits: cDig, cerDigitsFillers: cDigFil,
      extractSource: ext.source, action: ext.action,
      judgeMatch: verdict.match, judgeScore: verdict.score,
    });
    console.log(`measured ${c.id}: CER ${(cDef * 100).toFixed(1)}% / hyp="${hyp}"`);
  }

  // --- Markdown 表 ---
  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const date = new Date().toISOString().slice(0, 10);
  print("");
  print(`# 実測(AmiVoice ${GRAMMAR} / HTTP同期 / 各1回 / SAPI Haruka合成音声 16kHz mono / ${date})`);
  print("");
  print("## 1. ケース別 CER と正規化プリセット感度");
  print("| ケース | 正解 | 認識結果 | CER(default) | CER(+digits) | CER(+digits+fillers) |");
  print("|---|---|---|---|---|---|");
  for (const r of rows) {
    print(`| ${r.id} | ${r.reference} | ${r.hypothesis} | ${pct(r.cerDefault)} | ${pct(r.cerDigits)} | ${pct(r.cerDigitsFillers)} |`);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  print(`| **平均** | | | **${pct(mean(rows.map((r) => r.cerDefault)))}** | **${pct(mean(rows.map((r) => r.cerDigits)))}** | **${pct(mean(rows.map((r) => r.cerDigitsFillers)))}** |`);

  print("");
  print("## 2. ASR → LLM 抽出 の伝播(実LLM)");
  print("| ケース | 抽出元 | judge一致 | score | 抽出アクション |");
  print("|---|---|---|---|---|");
  for (const r of rows) {
    print(`| ${r.id} | ${r.extractSource} | ${r.judgeMatch ? "✓" : "✗"} | ${r.judgeScore} | \`${JSON.stringify(r.action)}\` |`);
  }
  const matchRate = rows.filter((r) => r.judgeMatch).length / rows.length;
  print(`\n判定一致率: ${pct(matchRate)} (${rows.filter((r) => r.judgeMatch).length}/${rows.length})`);

  const outIdx = process.argv.indexOf("--out");
  const out = outIdx >= 0 ? process.argv[outIdx + 1]! : "eval/out/real.json";
  await mkdir(join(process.cwd(), "eval/out"), { recursive: true });
  await writeFile(join(process.cwd(), out), JSON.stringify({ grammar: GRAMMAR, date, rows }, null, 2), "utf8");
  print(`\n# wrote ${out}`);
}

function print(s: string): void {
  // eslint-disable-next-line no-console
  console.log(s);
}

void main();
