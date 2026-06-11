/**
 * 決定的 ASR 誤りシミュレータ。
 *
 * なぜ存在するか:
 *   - 無償クーポン枠(月10時間)を消費せず、CI/オフラインで評価ハーネスの
 *     「CER比較表」「誤り伝播分析」を再現性高く回すため。
 *   - 実 AmiVoice を使う場合は recognizeWs(src/amivoice/ws-node.ts)に差し替える。
 *     ハーネス側のインタフェース(参照→仮説テキスト)は同一。
 *
 * モデル(記事に明記する想定):
 *   - SNR が低いほど文字置換/削除が増える
 *   - 話速が 1.0 から外れるほど誤りが増える
 *   - ドメイン用語は、汎用エンジン+辞書なしのとき同音異義へ化けやすい
 *   - 特化エンジン or 辞書ありでドメイン用語の誤りが大きく減る
 *
 * 出力は seed(text+factors)で完全に決定的。
 */

export interface SimFactors {
  snr: "clean" | "20dB" | "10dB" | "5dB";
  speed: number; // 0.9 / 1.0 / 1.3
  domainTerm: boolean;
  engine: "汎用" | "特化";
  dict: boolean;
}

/** ドメイン用語 → 汎用エンジンが起こしがちな同音/近音誤り */
const HOMOPHONE: Record<string, string> = {
  デシベル: "弟子ベル",
  サンプリングレート: "サンプル リング 礼糖",
  定例会議: "綴例会議",
  カフェラテ: "カフェ ラ テ",
  エスプレッソ: "エス プレッソ",
};

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 決定的 PRNG(mulberry32) */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SNR_ERR: Record<SimFactors["snr"], number> = {
  clean: 0.0,
  "20dB": 0.03,
  "10dB": 0.09,
  "5dB": 0.18,
};

// 近音で置換しやすい仮名(化けやすさのモデル)
const CONFUSABLE: Record<string, string> = {
  し: "ち", ち: "し", つ: "す", す: "つ", き: "ぎ", た: "だ",
  か: "が", ば: "ぱ", ご: "ご", ー: "", ん: "ん", "、": "", "。": "",
};

export interface SimResult {
  hypothesis: string;
  engine: "simulated";
  factors: SimFactors;
}

export function simulateAsr(reference: string, f: SimFactors): SimResult {
  const seed = hashSeed(reference + JSON.stringify(f));
  const rand = rng(seed);

  let text = reference;

  // 1) ドメイン用語の化け(汎用 & 辞書なし のときだけ強く効く)
  if (f.domainTerm && f.engine === "汎用" && !f.dict) {
    for (const [term, wrong] of Object.entries(HOMOPHONE)) {
      if (text.includes(term)) text = text.split(term).join(wrong);
    }
  } else if (f.domainTerm && f.dict && f.engine === "汎用") {
    // 辞書ありだと一部だけ化ける
    for (const [term, wrong] of Object.entries(HOMOPHONE)) {
      if (text.includes(term) && rand() < 0.2) text = text.split(term).join(wrong);
    }
  }

  // 2) 音響条件(SNR/話速)による一般誤り率
  const speedPenalty = Math.abs(f.speed - 1.0) * 0.15;
  const enginePenalty = f.engine === "特化" ? -0.02 : 0;
  const errRate = Math.max(0, SNR_ERR[f.snr] + speedPenalty + enginePenalty);

  const chars = [...text];
  const out: string[] = [];
  for (const ch of chars) {
    const r = rand();
    if (r < errRate) {
      const op = rand();
      if (op < 0.6 && CONFUSABLE[ch] !== undefined) {
        out.push(CONFUSABLE[ch]); // 置換
      } else if (op < 0.8) {
        // 削除(何も出さない)
      } else {
        out.push(ch, ch); // 挿入(重複)
      }
    } else {
      out.push(ch);
    }
  }
  return { hypothesis: out.join(""), engine: "simulated", factors: f };
}
