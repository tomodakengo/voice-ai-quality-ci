/**
 * Node 用 AmiVoice WebSocket リアルタイム認識クライアント。
 * WAV ファイルを読み、PCM を 'p' フレームでストリーム送信して確定結果を集める。
 * 実API(wss://acp-api.amivoice.com/v1/)とローカル mock の両方に対応。
 *
 * 評価ハーネスから「WS経由の認識」を回帰テストするために使う。
 */
import WebSocket from "ws";
import { config } from "../config.js";
import { parseWav, pcmBytes } from "../audio/wav.js";
import { buildStartCommand, type AmiVoiceResult, type AmiVoiceSegment } from "./types.js";
import { readFile } from "node:fs/promises";

export interface WsRecognizeOptions {
  wavPath: string;
  grammar?: string;
  profileWords?: string;
  keepFillerToken?: boolean;
  /** mock のときは appkey 不要 */
  useMock?: boolean;
  /** 1フレームのサンプル数(送信粒度) */
  chunkSamples?: number;
}

export async function recognizeWs(opts: WsRecognizeOptions): Promise<AmiVoiceResult> {
  const useMock = opts.useMock ?? config.mock.useMockAsr;
  const url = useMock ? `ws://localhost:${config.mock.port}` : config.amivoice.wsUrl;
  const appkey = useMock ? "" : config.amivoice.appkey;
  if (!useMock && !appkey) {
    throw new Error("AMIVOICE_APPKEY が無いため実WSは使えません(USE_MOCK_ASR=true を検討)");
  }

  const wavBuf = await readFile(opts.wavPath);
  const wav = parseWav(wavBuf);
  const pcm = pcmBytes(wav);
  const chunkBytes = (opts.chunkSamples ?? 4096) * 2;

  return new Promise<AmiVoiceResult>((resolve, reject) => {
    const ws = new WebSocket(url);
    const segments: AmiVoiceSegment[] = [];
    let started = false;

    const timeout = setTimeout(() => {
      ws.terminate();
      reject(new Error("WS recognize timed out"));
    }, 60_000);

    ws.on("open", () => {
      const start = buildStartCommand(appkey, {
        audioFormat: "lsb16k",
        grammar: opts.grammar ?? config.amivoice.grammar,
        profileWords: opts.profileWords,
        keepFillerToken: opts.keepFillerToken,
      });
      ws.send(start);
    });

    ws.on("message", (raw: Buffer, isBinary: boolean) => {
      const msg = isBinary ? "" : raw.toString("utf8");
      const cmd = msg[0];
      if (cmd === "s") {
        started = true;
        void streamAudio(ws, pcm, chunkBytes).then(() => ws.send("e"));
      } else if (cmd === "A") {
        const seg = safeJson(msg.slice(2));
        if (seg) segments.push(toSegment(seg));
      } else if (cmd === "e") {
        clearTimeout(timeout);
        ws.close();
        const text = segments.map((s) => s.text).join("");
        resolve({ text, results: segments, raw: segments });
      } else if (cmd && cmd >= "a" && cmd <= "z" && msg.length > 2 && cmd !== "p") {
        clearTimeout(timeout);
        reject(new Error(`AmiVoice WS error: ${msg}`));
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    void started;
  });
}

async function streamAudio(ws: WebSocket, pcm: Buffer, chunkBytes: number): Promise<void> {
  for (let off = 0; off < pcm.length; off += chunkBytes) {
    const slice = pcm.subarray(off, Math.min(off + chunkBytes, pcm.length));
    const frame = Buffer.concat([Buffer.from([0x70]), slice]); // 'p' + PCM
    ws.send(frame);
    await sleep(5); // 実APIに優しいペース。mockでは無害。
  }
}

function toSegment(j: Record<string, unknown>): AmiVoiceSegment {
  const tokens = Array.isArray(j.tokens) ? (j.tokens as Record<string, unknown>[]) : [];
  return {
    text: String(j.text ?? ""),
    confidence: Number(j.confidence ?? 0),
    starttime: Number(j.starttime ?? 0),
    endtime: Number(j.endtime ?? 0),
    tags: (j.tags as string[]) ?? [],
    rulename: String(j.rulename ?? ""),
    tokens: tokens.map((t) => ({
      written: String(t.written ?? ""),
      spoken: t.spoken as string | undefined,
      confidence: Number(t.confidence ?? 0),
      starttime: Number(t.starttime ?? 0),
      endtime: Number(t.endtime ?? 0),
    })),
  };
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
