import { z } from "zod";

/**
 * 音声コマンドから抽出する構造化アクションのスキーマ。
 * 「ASRの誤りが LLM 出力にどう伝播するか」を定量化するため、
 * LLM の出力は必ずこの zod スキーマで検証する(期待値スキーマ検証)。
 */
export const ActionSchema = z.object({
  /** 大分類の意図 */
  intent: z.enum(["order", "schedule", "query", "unknown"]),
  /** 対象(商品名・会議名など) */
  item: z.string().nullable(),
  /** 数量(無ければ null) */
  quantity: z.number().int().positive().nullable(),
  /** 日時(ISO 8601 文字列 or 自然言語。無ければ null) */
  datetime: z.string().nullable(),
  /** 補足(サイズ・ホット/アイス等の修飾) */
  modifiers: z.array(z.string()).default([]),
});

export type Action = z.infer<typeof ActionSchema>;

/** LLM-as-judge の評価結果スキーマ */
export const JudgeSchema = z.object({
  /** 期待アクションと実アクションが意味的に一致するか */
  match: z.boolean(),
  /** 0..1 のスコア */
  score: z.number().min(0).max(1),
  /** 不一致の理由(あれば) */
  reason: z.string(),
});

export type Judge = z.infer<typeof JudgeSchema>;

/** JSON Schema 表現(Anthropic tool 定義に使う) */
export const ACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: ["order", "schedule", "query", "unknown"] },
    item: { type: ["string", "null"] },
    quantity: { type: ["integer", "null"] },
    datetime: { type: ["string", "null"] },
    modifiers: { type: "array", items: { type: "string" } },
  },
  required: ["intent", "item", "quantity", "datetime", "modifiers"],
} as const;
