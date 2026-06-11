/**
 * ブラウザ側エントリ。録音ボタン → getUserMedia → AmiVoice WS → 確定テキスト →
 * /api/extract で LLM 構造化抽出 → 画面表示。
 *
 * E2E では Chromium の fake audio フラグでマイクが WAV に差し替わる。
 * data-testid 属性は Playwright のセレクタ用。
 */
import { AmiVoiceWsClient } from "./amivoice-ws-client.js";

interface AppConfig {
  useMock: boolean;
  wsUrl: string;
  appkey: string;
  grammar: string;
}

const $ = <T extends HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;

const recordBtn = $<HTMLButtonElement>("#record");
const transcriptEl = $("#transcript");
const interimEl = $("#interim");
const actionEl = $("#action");
const logEl = $("#log");
const modeEl = $("#mode");

function log(msg: string): void {
  logEl.textContent = msg;
}

let cfg: AppConfig;
let client: AmiVoiceWsClient | undefined;
let stream: MediaStream | undefined;
let recording = false;
let lastFinal = "";

async function loadConfig(): Promise<void> {
  const res = await fetch("/config.json");
  cfg = (await res.json()) as AppConfig;
  modeEl.textContent = `(モード: ${cfg.useMock ? "mock" : "real AmiVoice"})`;
}

async function startRecording(): Promise<void> {
  // UI は楽観的に即時更新(await の前に状態を反映)
  recording = true;
  recordBtn.dataset.state = "recording";
  recordBtn.textContent = "■ 停止";
  log("マイク取得中…");

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    log(`マイク取得失敗: ${(err as Error).message}`);
    stopRecording();
    return;
  }
  lastFinal = "";
  transcriptEl.textContent = "";
  interimEl.textContent = "";
  actionEl.textContent = "—";

  client = new AmiVoiceWsClient({
    url: cfg.wsUrl,
    appkey: cfg.appkey || undefined,
    grammar: cfg.grammar,
    onOpen: () => log("WS接続。発話を認識中…"),
    onInterim: (t) => (interimEl.textContent = t),
    onFinal: (t) => {
      lastFinal = t;
      transcriptEl.textContent = t;
      interimEl.textContent = "";
    },
    onError: (m) => log(`エラー: ${m}`),
    onClose: () => {
      log("WS切断。LLM抽出を実行…");
      void runExtract(lastFinal);
    },
  });
  await client.start(stream);
}

function stopRecording(): void {
  client?.stop();
  stream?.getTracks().forEach((t) => t.stop());
  recording = false;
  recordBtn.dataset.state = "idle";
  recordBtn.textContent = "🎙 録音開始";
}

async function runExtract(transcript: string): Promise<void> {
  if (!transcript) {
    log("認識テキストが空でした。");
    return;
  }
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  const data = await res.json();
  actionEl.textContent = JSON.stringify(data.action, null, 2);
  log(`抽出完了 (source: ${data.source})`);
}

recordBtn.addEventListener("click", () => {
  if (recording) stopRecording();
  else void startRecording();
});

void loadConfig().then(() => log("準備完了。録音を開始してください。"));
