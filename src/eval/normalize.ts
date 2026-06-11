/**
 * 日本語 CER 計測のための正規化ルール。
 *
 * CER は文字単位なので、表記揺れをどう畳むかで数値が変わる。ルールを明文化し、
 * 参照(正解)と仮説(認識結果)の双方へ同じ正規化を適用する。
 *
 * 既定ルール(記事に明記する):
 *   1. NFKC 正規化(全角英数記号→半角、半角カナ→全角 等)
 *   2. 空白(半角/全角/タブ/改行)を全削除
 *   3. 記号・約物(句読点/中黒/括弧/長音以外)を削除
 *   4. オプション: 数字を算用数字へ寄せる(漢数字↔算用数字の揺れ対策)
 *
 * オプションは options で切替可能にして、ルールごとの CER 感度を記事で比較できるようにする。
 */

export interface NormalizeOptions {
  /** 空白を除去する(既定 true) */
  stripSpace?: boolean;
  /** 記号・約物を除去する(既定 true) */
  stripPunct?: boolean;
  /** 漢数字を算用数字へ寄せる(既定 false) */
  normalizeDigits?: boolean;
  /** フィラー(えー/あのー/えーっと/ですね 等)を除去する(既定 false) */
  stripFillers?: boolean;
}

// 注意: 長音符「ー」(U+30FC) は語の一部なので除去しない(例: コーヒー)。
const PUNCT = /[、。，．・「」『』（）()【】\[\]｛｝{}…―‐\-—~〜!！?？:：;；"'"'`]/g;
const SPACE = /[\s　]+/g;
const FILLERS = /(えーっと|えーと|えー|あのー|あの|そのー|まあ|なんか|ですね|えっと)/g;

const KANJI_DIGITS: Record<string, string> = {
  〇: "0", 零: "0", 一: "1", 二: "2", 三: "3", 四: "4", 五: "5",
  六: "6", 七: "7", 八: "8", 九: "9",
};

/** 「二十三」式の簡易漢数字→算用数字(十/百/千の桁を解釈) */
function kanjiToArabic(s: string): string {
  return s.replace(/[〇零一二三四五六七八九十百千]+/g, (run) => {
    // 単純な桁構成のみ対応(万以上は対象外、認識結果の数量表現を想定)
    let total = 0;
    let current = 0;
    for (const ch of run) {
      if (ch === "十") current = (current || 1) * 10, (total += current), (current = 0);
      else if (ch === "百") current = (current || 1) * 100, (total += current), (current = 0);
      else if (ch === "千") current = (current || 1) * 1000, (total += current), (current = 0);
      else current += Number(KANJI_DIGITS[ch] ?? 0);
    }
    total += current;
    return String(total);
  });
}

export function normalize(input: string, opts: NormalizeOptions = {}): string {
  const {
    stripSpace = true,
    stripPunct = true,
    normalizeDigits = false,
    stripFillers = false,
  } = opts;

  let s = input.normalize("NFKC");
  if (stripFillers) s = s.replace(FILLERS, "");
  if (normalizeDigits) s = kanjiToArabic(s);
  if (stripPunct) s = s.replace(PUNCT, "");
  if (stripSpace) s = s.replace(SPACE, "");
  return s;
}

/** 既定の正規化プリセット(CERの分母に使う標準) */
export const DEFAULT_NORMALIZE: NormalizeOptions = {
  stripSpace: true,
  stripPunct: true,
  normalizeDigits: false,
  stripFillers: false,
};
