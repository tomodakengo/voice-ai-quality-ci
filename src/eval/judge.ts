/**
 * LLM出力(構造化アクション)の正しさ評価。二段構え:
 *   1. スキーマ検証(zod): 形が期待どおりか(これは extract 側で実施済み)
 *   2. 意味的一致: 期待アクションと実アクションが意味的に一致するか
 *      - ANTHROPIC_API_KEY があれば LLM-as-judge
 *      - 無ければ決定的なフィールド比較(再現性のためのフォールバック)
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { JudgeSchema, type Action, type Judge } from "../llm/schema.js";

export async function judgeAction(
  expected: Action,
  actual: Action,
): Promise<Judge & { source: "llm" | "fallback" }> {
  if (!config.anthropic.apiKey) {
    return { ...deterministicJudge(expected, actual), source: "fallback" };
  }
  try {
    const client = new Anthropic({ apiKey: config.anthropic.apiKey });
    const msg = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 300,
      tools: [
        {
          name: "verdict",
          description: "2つのアクションが意味的に一致するか判定する",
          input_schema: {
            type: "object",
            properties: {
              match: { type: "boolean" },
              score: { type: "number" },
              reason: { type: "string" },
            },
            required: ["match", "score", "reason"],
          } as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "verdict" },
      messages: [
        {
          role: "user",
          content:
            `音声コマンドから抽出した構造化アクションの一致判定をしてください。\n` +
            `intent と item/quantity/datetime が意味的に合っていれば match=true。\n` +
            `表記揺れ(ホットコーヒー≒コーヒー(ホット))は許容。\n\n` +
            `期待: ${JSON.stringify(expected)}\n実際: ${JSON.stringify(actual)}`,
        },
      ],
    });
    const tool = msg.content.find((c) => c.type === "tool_use");
    if (tool && tool.type === "tool_use") {
      const parsed = JudgeSchema.safeParse(tool.input);
      if (parsed.success) return { ...parsed.data, source: "llm" };
    }
  } catch {
    // ネットワーク/キー不正時はフォールバック
  }
  return { ...deterministicJudge(expected, actual), source: "fallback" };
}

/** 決定的フィールド比較。intent一致を主、他は部分加点。 */
export function deterministicJudge(expected: Action, actual: Action): Judge {
  let score = 0;
  const reasons: string[] = [];
  if (expected.intent === actual.intent) score += 0.5;
  else reasons.push(`intent mismatch (${expected.intent} vs ${actual.intent})`);

  if (eqLoose(expected.item, actual.item)) score += 0.2;
  else reasons.push(`item mismatch`);

  if (expected.quantity === actual.quantity) score += 0.15;
  else reasons.push(`quantity mismatch`);

  if (eqLoose(expected.datetime, actual.datetime)) score += 0.15;
  else reasons.push(`datetime mismatch`);

  const match = expected.intent === actual.intent && score >= 0.7;
  return {
    match,
    score: Number(score.toFixed(3)),
    reason: reasons.length ? reasons.join("; ") : "all fields agree",
  };
}

function eqLoose(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const na = a.normalize("NFKC");
  const nb = b.normalize("NFKC");
  return na === nb || na.includes(nb) || nb.includes(na);
}
