/**
 * CER(文字誤り率)計測。日本語なので文字ベース。
 *   CER = (S + D + I) / N
 *     S=置換, D=削除, I=挿入, N=参照の文字数
 * レーベンシュタイン距離で S/D/I を内訳まで出す(記事の誤り内訳分析に使う)。
 */
import { normalize, DEFAULT_NORMALIZE, type NormalizeOptions } from "./normalize.js";

export interface CerResult {
  cer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  refLen: number;
  hypLen: number;
  /** 正規化後の参照/仮説(デバッグ・記事素材用) */
  refNorm: string;
  hypNorm: string;
}

export function cer(
  reference: string,
  hypothesis: string,
  opts: NormalizeOptions = DEFAULT_NORMALIZE,
): CerResult {
  const ref = [...normalize(reference, opts)];
  const hyp = [...normalize(hypothesis, opts)];
  const { distance, s, d, i } = levenshtein(ref, hyp);
  const refLen = ref.length;
  return {
    cer: refLen === 0 ? (hyp.length === 0 ? 0 : 1) : distance / refLen,
    substitutions: s,
    deletions: d,
    insertions: i,
    refLen,
    hypLen: hyp.length,
    refNorm: ref.join(""),
    hypNorm: hyp.join(""),
  };
}

/** 編集距離 + 操作内訳(バックトレース) */
function levenshtein(
  ref: string[],
  hyp: string[],
): { distance: number; s: number; d: number; i: number } {
  const n = ref.length;
  const m = hyp.length;
  // dp[i][j] = ref[0..i) を hyp[0..j) に変換する最小コスト
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i]![0] = i;
  for (let j = 0; j <= m; j++) dp[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1, // deletion (ref文字を消す)
        dp[i]![j - 1]! + 1, // insertion (hyp文字を足す)
        dp[i - 1]![j - 1]! + cost, // substitution / match
      );
    }
  }
  // バックトレースで S/D/I を数える
  let i = n;
  let j = m;
  let s = 0;
  let d = 0;
  let ins = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1] && dp[i]![j] === dp[i - 1]![j - 1]) {
      i--; j--;
    } else if (i > 0 && j > 0 && dp[i]![j] === dp[i - 1]![j - 1]! + 1) {
      s++; i--; j--;
    } else if (i > 0 && dp[i]![j] === dp[i - 1]![j]! + 1) {
      d++; i--;
    } else {
      ins++; j--;
    }
  }
  return { distance: dp[n]![m]!, s, d, i: ins };
}

/** 複数ケースの CER を集計(マイクロ平均: 全文字をまとめて分母にする) */
export function aggregateCer(results: CerResult[]): {
  microCer: number;
  macroCer: number;
  totalSub: number;
  totalDel: number;
  totalIns: number;
  totalRefLen: number;
} {
  const totalSub = results.reduce((a, r) => a + r.substitutions, 0);
  const totalDel = results.reduce((a, r) => a + r.deletions, 0);
  const totalIns = results.reduce((a, r) => a + r.insertions, 0);
  const totalRefLen = results.reduce((a, r) => a + r.refLen, 0);
  const microCer = totalRefLen === 0 ? 0 : (totalSub + totalDel + totalIns) / totalRefLen;
  const macroCer = results.length === 0 ? 0 : results.reduce((a, r) => a + r.cer, 0) / results.length;
  return { microCer, macroCer, totalSub, totalDel, totalIns, totalRefLen };
}
