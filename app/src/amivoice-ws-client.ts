/**
 * ブラウザ用の AmiVoice WebSocket リアルタイム認識クライアント。
 *
 * 設計方針:
 * - 実APIにもローカル mock サーバ(src/amivoice/mock-server.ts)にも同じプロトコルで話す。
 *   オフライン(mock)時は appkey 不要 → CI/E2E がクーポンを消費せず緑になる。
 * - getUserMedia の音声を 16kHz / 16bit / mono PCM(lsb16k)へダウンサンプルして 'p' フレームで送る。
 *
 * プロトコル(テキストの1文字目がコマンド):
 *   送信: s(start) / p+PCM(audio) / e(end)
 *   受信: s / S(発話開始) / U(中間) / A(確定) / E(発話終了) / e(終了) / 先頭が小文字+空白でエラー
 */

export interface WsClientOptions {
  url: string;
  /** 実APIのときだけ必要。mock のときは空でよい */
  appkey?: string;
  audioFormat?: string; // 既定 lsb16k
  grammar?: string; // 既定 -a-general
  profileWords?: string;
  keepFillerToken?: boolean;
  onInterim?: (text: string) => void;
  onFinal?: (text: string, raw: unknown) => void;
  onError?: (message: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class AmiVoiceWsClient {
  private ws?: WebSocket;
  private audioCtx?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: ScriptProcessorNode;
  private started = false;
  private finalText = "";

  constructor(private readonly opts: WsClientOptions) {}

  /** マイクストリームを受け取り、接続→start→音声送信を開始する */
  async start(stream: MediaStream): Promise<void> {
    this.ws = new WebSocket(this.opts.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.opts.onOpen?.();
      this.ws!.send(this.buildStartCommand());
    };

    this.ws.onmessage = (ev) => this.handleMessage(ev.data);
    this.ws.onerror = () => this.opts.onError?.("WebSocket error");
    this.ws.onclose = () => this.opts.onClose?.();

    await this.pipeAudio(stream);
  }

  private buildStartCommand(): string {
    const fmt = this.opts.audioFormat ?? "lsb16k";
    const grammar = this.opts.grammar ?? "-a-general";
    const parts = [`s ${fmt} ${grammar}`];
    if (this.opts.appkey) parts.push(`authorization=${this.opts.appkey}`);
    if (this.opts.profileWords)
      parts.push(`profileWords=${encodeURIComponent(this.opts.profileWords)}`);
    if (this.opts.keepFillerToken) parts.push("keepFillerToken=1");
    return parts.join(" ");
  }

  private handleMessage(data: string | ArrayBuffer): void {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const cmd = text[0];
    const body = text.slice(2); // "X " の後ろ
    switch (cmd) {
      case "s":
        this.started = true;
        break;
      case "U": {
        const seg = safeJson(body);
        const t = (seg?.text as string) ?? "";
        if (t) this.opts.onInterim?.(t);
        break;
      }
      case "A": {
        const seg = safeJson(body);
        const t = (seg?.text as string) ?? "";
        this.finalText += t;
        this.opts.onFinal?.(this.finalText, seg);
        break;
      }
      case "e":
        this.close();
        break;
      default:
        // 小文字コマンド + 空白 + メッセージ はエラー扱い(docs準拠)
        if (cmd && cmd >= "a" && cmd <= "z" && body) {
          this.opts.onError?.(`${cmd}: ${body}`);
        }
    }
  }

  /** WebAudio で 16kHz/16bit/mono PCM に変換して 'p' フレーム送信 */
  private async pipeAudio(stream: MediaStream): Promise<void> {
    const targetRate = 16000;
    this.audioCtx = new AudioContext();
    this.source = this.audioCtx.createMediaStreamSource(stream);
    this.processor = this.audioCtx.createScriptProcessor(4096, 1, 1);

    this.source.connect(this.processor);
    this.processor.connect(this.audioCtx.destination);

    const inRate = this.audioCtx.sampleRate;
    this.processor.onaudioprocess = (e) => {
      if (!this.started || this.ws?.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm = downsampleToInt16(input, inRate, targetRate);
      // 'p' (0x70) + PCMバイト列
      const frame = new Uint8Array(pcm.byteLength + 1);
      frame[0] = 0x70;
      frame.set(new Uint8Array(pcm.buffer), 1);
      this.ws.send(frame);
    };
  }

  /** 'e'(end)送信して認識を確定させる */
  stop(): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send("e");
    this.processor?.disconnect();
    this.source?.disconnect();
    void this.audioCtx?.close();
  }

  private close(): void {
    this.ws?.close();
  }
}

function safeJson(s: string): Record<string, unknown> | null {
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Float32(-1..1) を線形補間ダウンサンプルして signed 16-bit LE に変換 */
function downsampleToInt16(
  input: Float32Array,
  inRate: number,
  outRate: number,
): Int16Array {
  if (outRate >= inRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = floatToInt16(input[i]!);
    return out;
  }
  const ratio = inRate / outRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = idx - lo;
    const sample = input[lo]! * (1 - frac) + input[hi]! * frac;
    out[i] = floatToInt16(sample);
  }
  return out;
}

function floatToInt16(f: number): number {
  const s = Math.max(-1, Math.min(1, f));
  return s < 0 ? s * 0x8000 : s * 0x7fff;
}
