/**
 * AmiVoice 非同期HTTP音声認識。
 * 一次情報: https://docs.amivoice.com/amivoice-api/manual/asr-request/
 *
 * 流れ:
 *   1. POST /v1/recognitions に音声を投げる → sessionid を受け取る
 *   2. GET /v1/recognitions/{sessionid} をポーリング → status が completed になるまで待つ
 *
 * 長尺音声(数分以上)向け。E2Eアプリは WS を使うが、バッチ評価では非同期も比較対象にする。
 */
import { config, assertAmivoiceKey } from "../config.js";
import type { AmiVoiceResult } from "./types.js";
import { normalize } from "./http-sync.js";

export interface HttpAsyncOptions {
  audio: Blob | Buffer;
  contentType?: string;
  grammar?: string;
  profileWords?: string;
  /** ポーリング間隔ms */
  pollIntervalMs?: number;
  /** タイムアウトms */
  timeoutMs?: number;
}

interface RegisterResponse {
  sessionid?: string;
  code?: string;
  message?: string;
}

interface StatusResponse {
  status?: "queued" | "started" | "processing" | "completed" | "error";
  // 完了時は同期と同じ results 構造
  results?: unknown;
  text?: string;
  utteranceid?: string;
  code?: string;
  message?: string;
}

export async function recognizeAsync(
  opts: HttpAsyncOptions,
): Promise<AmiVoiceResult> {
  const appkey = assertAmivoiceKey();
  const grammar = opts.grammar ?? config.amivoice.grammar;

  const d = new URLSearchParams();
  d.set("grammarFileNames", grammar);
  if (opts.profileWords) d.set("profileWords", opts.profileWords);

  const form = new FormData();
  form.set("u", appkey);
  form.set("d", d.toString());
  const blob =
    opts.audio instanceof Blob
      ? opts.audio
      : new Blob([Uint8Array.from(opts.audio)], { type: opts.contentType ?? "audio/wav" });
  form.set("a", blob, "audio.wav");

  const reg = await fetch(config.amivoice.httpAsyncUrl, {
    method: "POST",
    body: form,
  });
  if (!reg.ok) {
    throw new Error(`AmiVoice async register HTTP ${reg.status}: ${await reg.text()}`);
  }
  const regJson = (await reg.json()) as RegisterResponse;
  if (!regJson.sessionid) {
    throw new Error(
      `AmiVoice async: no sessionid (${regJson.code ?? ""} ${regJson.message ?? ""})`,
    );
  }

  const interval = opts.pollIntervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  const statusUrl = `${config.amivoice.httpAsyncUrl}/${regJson.sessionid}`;

  while (Date.now() < deadline) {
    await sleep(interval);
    const sres = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${appkey}` },
    });
    if (!sres.ok) continue;
    const sjson = (await sres.json()) as StatusResponse;
    if (sjson.status === "completed") {
      return normalize(sjson as Parameters<typeof normalize>[0]);
    }
    if (sjson.status === "error") {
      throw new Error(`AmiVoice async error: ${sjson.message ?? "unknown"}`);
    }
  }
  throw new Error("AmiVoice async: timed out waiting for completion");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
