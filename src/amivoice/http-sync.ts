/**
 * AmiVoice 同期HTTP音声認識。
 * 一次情報: https://docs.amivoice.com/amivoice-api/manual/request-syntax/
 *
 * multipart/form-data で以下を送る:
 *   u: APPKEY(認証)
 *   d: パラメータ。grammarFileNames を含む(例: grammarFileNames=-a-general)
 *   a: 音声バイナリ(ファイル)
 *
 * ★ a パラメータの罠(競合記事 gen99 氏も言及 / notes/gotchas.md 参照):
 *   - "a" は音声ファイル本体のフィールド名。エンジン指定は "d" 内の grammarFileNames。
 *     "a" と grammarFileNames(="-a-general" のように先頭が a- で始まる)を混同しやすい。
 *   - grammarFileNames は引用符やスペースの扱いに敏感。複数指定は空白区切り。
 */
import { config, assertAmivoiceKey } from "../config.js";
import type { AmiVoiceResult, AmiVoiceSegment } from "./types.js";

/**
 * d パラメータ(認識条件)をスペース区切り key=value で組む。
 * AmiVoice の d は WebSocket の s コマンド同様スペース区切り。&区切りは不可。
 */
export function buildD(opts: {
  grammar: string;
  profileId?: string;
  profileWords?: string;
  keepFillerToken?: boolean;
}): string {
  const parts = [`grammarFileNames=${opts.grammar}`];
  if (opts.profileId) parts.push(`profileId=${opts.profileId}`);
  // profileWords はコンパクトJSON(スペースなし)前提。スペースがあると d の区切りと衝突する。
  if (opts.profileWords) parts.push(`profileWords=${opts.profileWords.replace(/\s+/g, "")}`);
  if (opts.keepFillerToken) parts.push("keepFillerToken=1");
  return parts.join(" ");
}

export interface HttpSyncOptions {
  audio: Blob | Buffer;
  contentType?: string; // 例: "audio/wav", "audio/x-pcm;bit=16;rate=16000"
  grammar?: string;
  profileId?: string;
  profileWords?: string;
  keepFillerToken?: boolean;
}

export async function recognizeSync(
  opts: HttpSyncOptions,
): Promise<AmiVoiceResult> {
  const appkey = assertAmivoiceKey();
  const grammar = opts.grammar ?? config.amivoice.grammar;

  // d パラメータ(認識条件)。★AmiVoice の d は「スペース区切り」key=value。
  //   URLSearchParams(=&区切り)で組むと "received illegal service authorization" になる(gotchas#16)。
  //   profileWords はスペースを含まないコンパクトJSON(JSON.stringify既定)であること。
  const d = buildD({ grammar, profileId: opts.profileId, profileWords: opts.profileWords, keepFillerToken: opts.keepFillerToken });

  const form = new FormData();
  form.set("u", appkey);
  form.set("d", d);
  const blob =
    opts.audio instanceof Blob
      ? opts.audio
      : new Blob([Uint8Array.from(opts.audio)], { type: opts.contentType ?? "audio/wav" });
  form.set("a", blob, "audio.wav");

  const res = await fetch(config.amivoice.httpSyncUrl, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`AmiVoice sync HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as RawSyncResponse;
  return normalize(json);
}

interface RawSyncResponse {
  results?: Array<{
    confidence?: number;
    starttime?: number;
    endtime?: number;
    tags?: string[];
    rulename?: string;
    text?: string;
    tokens?: Array<{
      written?: string;
      spoken?: string;
      confidence?: number;
      starttime?: number;
      endtime?: number;
    }>;
  }>;
  text?: string;
  utteranceid?: string;
  code?: string;
  message?: string;
}

export function normalize(json: RawSyncResponse): AmiVoiceResult {
  // ★重要: AmiVoice は認証失敗等でも HTTP 200 を返し、エラーは body の message に入る。
  //   例: {"results":[{"text":"",...}],"text":"","code":"-","message":"received illegal service authorization"}
  //   results が空配列で存在するため「!json.results」だけでは捕捉できない。message 非空で必ず弾く。
  if (json.message && json.message.trim()) {
    throw new Error(`AmiVoice error (code=${json.code ?? "?"}): ${json.message}`);
  }
  const results: AmiVoiceSegment[] = (json.results ?? []).map((r) => ({
    text: r.text ?? "",
    confidence: r.confidence ?? 0,
    starttime: r.starttime ?? 0,
    endtime: r.endtime ?? 0,
    tags: r.tags ?? [],
    rulename: r.rulename ?? "",
    tokens: (r.tokens ?? []).map((t) => ({
      written: t.written ?? "",
      spoken: t.spoken,
      confidence: t.confidence ?? 0,
      starttime: t.starttime ?? 0,
      endtime: t.endtime ?? 0,
    })),
  }));
  const text = json.text ?? results.map((r) => r.text).join("");
  return { text, results, utteranceid: json.utteranceid, raw: json };
}
