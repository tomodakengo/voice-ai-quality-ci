import { test } from "node:test";
import assert from "node:assert/strict";
import { cer } from "../../src/eval/cer.js";
import { normalize } from "../../src/eval/normalize.js";
import { ruleBasedExtract } from "../../src/llm/extract.js";
import { deterministicJudge } from "../../src/eval/judge.js";
import { simulateAsr } from "../../src/eval/asr-sim.js";

test("CER: 完全一致は 0", () => {
  const r = cer("こんにちは", "こんにちは");
  assert.equal(r.cer, 0);
  assert.equal(r.substitutions + r.deletions + r.insertions, 0);
});

test("CER: 1文字置換 = 1/N", () => {
  const r = cer("こんにちは", "こんにちわ");
  assert.equal(r.refLen, 5);
  assert.equal(r.substitutions, 1);
  assert.equal(r.cer, 1 / 5);
});

test("CER: 挿入と削除を内訳まで数える", () => {
  // 参照 "あい" -> 仮説 "あXい" は挿入1
  const ins = cer("あい", "あxい");
  assert.equal(ins.insertions, 1);
  // 参照 "あい" -> 仮説 "あ" は削除1
  const del = cer("あい", "あ");
  assert.equal(del.deletions, 1);
});

test("normalize: NFKC + 空白/記号除去", () => {
  assert.equal(normalize("Ａ Ｂ、Ｃ。"), "ABC");
});

test("normalize: フィラー除去オプション", () => {
  assert.equal(
    normalize("えーっとコーヒーですね", { stripFillers: true, stripPunct: true, stripSpace: true }),
    "コーヒー",
  );
});

test("normalize: 漢数字→算用数字オプション", () => {
  assert.equal(normalize("二十三", { normalizeDigits: true }), "23");
});

test("ruleBasedExtract: order を抽出", () => {
  const a = ruleBasedExtract("ホットコーヒーを一杯ください");
  assert.equal(a.intent, "order");
  assert.equal(a.quantity, 1);
  assert.ok(a.modifiers.includes("ホット"));
});

test("ruleBasedExtract: schedule が order より優先", () => {
  const a = ruleBasedExtract("来週の月曜日に定例会議を設定してください");
  assert.equal(a.intent, "schedule");
});

test("deterministicJudge: 完全一致で match", () => {
  const exp = { intent: "order" as const, item: "コーヒー", quantity: 1, datetime: null, modifiers: [] };
  const v = deterministicJudge(exp, { ...exp });
  assert.equal(v.match, true);
  assert.equal(v.score, 1);
});

test("simulateAsr: 決定的(同入力→同出力)", () => {
  const f = { snr: "10dB" as const, speed: 1.0, domainTerm: false, engine: "汎用" as const, dict: false };
  const a = simulateAsr("ホットコーヒーを一杯ください", f);
  const b = simulateAsr("ホットコーヒーを一杯ください", f);
  assert.equal(a.hypothesis, b.hypothesis);
});

test("simulateAsr: clean は誤りゼロ(ドメイン用語なし)", () => {
  const f = { snr: "clean" as const, speed: 1.0, domainTerm: false, engine: "汎用" as const, dict: false };
  const a = simulateAsr("こんにちは音声認識のテストです", f);
  assert.equal(a.hypothesis, "こんにちは音声認識のテストです");
});
