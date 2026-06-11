/**
 * 依存ゼロ(ffmpeg不要)の音声データ拡張。
 *   - addNoiseAtSnr: 目標SNR(dB)になるよう校正したホワイトノイズを重畳
 *   - changeTempo  : 単純リサンプルによる擬似話速変更(※ピッチも変わる。caveat明記)
 *
 * SNRは信号RMSとノイズRMSの比で定義:
 *   SNR_dB = 20*log10(rms_signal / rms_noise)
 *   → rms_noise = rms_signal / 10^(SNR/20)
 * これにより「実SNR」を明示した状態でノイズ量を決められる(推測値でなく計算値)。
 */
import { writeWav, type WavData } from "./wav.js";

export function rms(samples: Int16Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/** 決定的な白色雑音(mulberry32, seed固定で再現可能) */
function whiteNoise(n: number, targetRms: number, seed: number): Int16Array {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // 一様乱数(-1,1)のRMSは 1/sqrt(3)。targetRmsに合わせてスケール。
  const scale = targetRms / (1 / Math.sqrt(3));
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const u = rand() * 2 - 1;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(u * scale)));
  }
  return out;
}

export interface NoiseResult {
  samples: Int16Array;
  signalRms: number;
  noiseRms: number;
  /** 実際に適用したSNR(dB)。計算値。 */
  actualSnrDb: number;
}

export function addNoiseAtSnr(signal: Int16Array, snrDb: number, seed = 12345): NoiseResult {
  const sRms = rms(signal);
  const nRms = sRms / Math.pow(10, snrDb / 20);
  const noise = whiteNoise(signal.length, nRms, seed);
  const out = new Int16Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    out[i] = Math.max(-32768, Math.min(32767, signal[i]! + noise[i]!));
  }
  return {
    samples: out,
    signalRms: sRms,
    noiseRms: nRms,
    actualSnrDb: 20 * Math.log10(sRms / nRms),
  };
}

/** 擬似話速変更(リサンプル方式)。tempo>1で速く・短く。※ピッチ変化あり。 */
export function changeTempo(samples: Int16Array, tempo: number): Int16Array {
  const outLen = Math.floor(samples.length / tempo);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * tempo;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = idx - lo;
    out[i] = Math.round(samples[lo]! * (1 - frac) + samples[hi]! * frac);
  }
  return out;
}

export function toWavBuffer(wav: WavData, samples: Int16Array): Buffer {
  return writeWav(samples, wav.sampleRate, 1);
}
