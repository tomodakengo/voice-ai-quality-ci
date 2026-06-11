/**
 * AmiVoice 認識結果の型。
 *
 * 一次情報: https://docs.amivoice.com/amivoice-api/manual/
 * WebSocket / HTTP いずれも「A」イベント(発話確定)で下記 JSON を返す。
 * token 単位の confidence と starttime/endtime(ms) は評価ハーネスの採点に使う。
 *
 * 注意: 実APIのフィールドはドキュメントで都度確認すること(推測で記事に書かない)。
 * 本型は docs の代表例に合わせているが、エンジンにより tags/rulename 等は変動しうる。
 */
export interface AmiVoiceToken {
  /** 表記(書き言葉) */
  written: string;
  /** 読み(話し言葉)。エンジンにより無いこともある */
  spoken?: string;
  /** 0..1 の信頼度 */
  confidence: number;
  /** 発話開始からの相対ms */
  starttime: number;
  endtime: number;
}

export interface AmiVoiceSegment {
  text: string;
  confidence: number;
  starttime: number;
  endtime: number;
  tags?: string[];
  rulename?: string;
  tokens: AmiVoiceToken[];
}

export interface AmiVoiceResult {
  /** 全セグメントを連結した最終テキスト */
  text: string;
  results: AmiVoiceSegment[];
  utteranceid?: string;
  /** 生レスポンス(デバッグ・記事素材用に保持) */
  raw?: unknown;
}

/** WebSocket リアルタイムIFのイベント種別 */
export type WsEvent =
  | { type: "start" }
  | { type: "utteranceStart"; time: number }
  | { type: "utteranceEnd"; time: number }
  | { type: "interim"; text: string; result: AmiVoiceSegment | null }
  | { type: "final"; result: AmiVoiceResult }
  | { type: "end" }
  | { type: "error"; message: string };

/** start コマンドのパラメータ。記事の「a パラメータ周りの罠」検証用に明示する。 */
export interface AmiVoiceStartParams {
  /**
   * 音声フォーマット文字列。
   * lsb16k = 16kHz / 16bit / signed little-endian / mono (推奨)
   * 他: lsb8k, msb16k, mulaw, alaw, "16k", "8k"
   */
  audioFormat?: string;
  /** grammarFileNames。汎用: -a-general / 数字優先: -a-general-input 等 */
  grammar?: string;
  /** ユーザー辞書(プロファイル)ID */
  profileId?: string;
  /** 単語登録(profileWords)。改行区切りの "表記 読み 品詞" 形式 */
  profileWords?: string;
  /** フィラー(えー/あのー等)をトークンに残すか */
  keepFillerToken?: boolean;
  /** 区切りなし連続認識など、追加 key=value */
  extra?: Record<string, string>;
}

export function buildStartCommand(
  appkey: string,
  params: AmiVoiceStartParams,
): string {
  const audioFormat = params.audioFormat ?? "lsb16k";
  const grammar = params.grammar ?? "-a-general";
  // 形式: s <audioFormat> <grammarFileNames> key=value ...
  const parts = [`s ${audioFormat} ${grammar}`, `authorization=${appkey}`];
  if (params.profileId) parts.push(`profileId=${params.profileId}`);
  if (params.profileWords)
    parts.push(`profileWords=${encodeURIComponent(params.profileWords)}`);
  if (params.keepFillerToken) parts.push("keepFillerToken=1");
  for (const [k, v] of Object.entries(params.extra ?? {})) {
    parts.push(`${k}=${v}`);
  }
  return parts.join(" ");
}
