/**
 * 認識テキスト → 構造化アクション抽出(LLM)。
 *
 * - Anthropic Claude の tool use(構造化出力)で Action を取り出し、zod で検証する。
 * - ANTHROPIC_API_KEY が無い場合は、決定的なルールベースのフォールバックを使う。
 *   → CI / オフラインでも回帰テストが回る(再現性重視)。
 *
 * 最新モデルは Claude 4.x 系。既定は安価な claude-haiku-4-5。
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { ActionSchema, ACTION_JSON_SCHEMA, type Action } from "./schema.js";

export interface ExtractResult {
  action: Action;
  /** "llm" | "fallback" — どちらで抽出したか(計測条件に記録) */
  source: "llm" | "fallback";
}

export async function extractAction(transcript: string): Promise<ExtractResult> {
  if (!config.anthropic.apiKey) {
    return { action: ruleBasedExtract(transcript), source: "fallback" };
  }
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });
  const msg = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: 512,
    tools: [
      {
        name: "emit_action",
        description: "認識テキストから構造化アクションを1件抽出する",
        input_schema: ACTION_JSON_SCHEMA as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: "emit_action" },
    messages: [
      {
        role: "user",
        content:
          `次の音声認識テキストから、ユーザーの意図を構造化して抽出してください。\n` +
          `日時は相対表現(来週の月曜 等)はそのまま文字列で構いません。\n\n` +
          `テキスト: 「${transcript}」`,
      },
    ],
  });
  const toolUse = msg.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return { action: ruleBasedExtract(transcript), source: "fallback" };
  }
  const parsed = ActionSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    // スキーマ不一致 → フォールバック(記事: LLM出力のスキーマ検証で破綻を捕捉)
    return { action: ruleBasedExtract(transcript), source: "fallback" };
  }
  return { action: parsed.data, source: "llm" };
}

/**
 * 決定的なルールベース抽出。LLM 不在時のフォールバック兼、
 * 「ASR誤り → 抽出ズレ」の伝播を再現性高く観測するための基準実装。
 */
export function ruleBasedExtract(text: string): Action {
  const t = text.normalize("NFKC");
  const modifiers: string[] = [];
  for (const m of ["ホット", "アイス", "エスプレッソ", "ラージ", "スモール", "急ぎ"]) {
    if (t.includes(m)) modifiers.push(m);
  }
  const qty = matchQuantity(t);

  // 順序に注意: 「設定してください」のように複数キーワードを含む場合、
  // schedule(会議/予定/設定)を order(汎用の「ください」)より優先する。
  let intent: Action["intent"] = "unknown";
  if (/(会議|予定|設定|スケジュール|ミーティング|アポ)/.test(t)) intent = "schedule";
  else if (/(注文|変更|コーヒー|ラテ|個|杯)/.test(t) || /(を|の).*(ください|お願い)/.test(t))
    intent = "order";
  else if (/(教えて|何|いつ|どこ|ですか)/.test(t)) intent = "query";

  let item: string | null = null;
  const itemMatch = t.match(/(ホットコーヒー|アイスコーヒー|コーヒー|カフェラテ|ラテ|定例会議|会議)/);
  if (itemMatch) item = itemMatch[1]!;

  let datetime: string | null = null;
  const dt = t.match(/(来週|今日|明日|明後日|今週)?の?(月|火|水|木|金|土|日)曜日?/);
  if (dt) datetime = dt[0];

  return { intent, item, quantity: qty, datetime, modifiers };
}

function matchQuantity(t: string): number | null {
  const arabic = t.match(/(\d+)\s*(個|杯|つ|名|件)/);
  if (arabic) return Number(arabic[1]);
  const kanji: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  const km = t.match(/([一二三四五六七八九十]+)\s*(個|杯|つ|名|件)/);
  if (km) return kanji[km[1]![0]!] ?? null;
  return null;
}
