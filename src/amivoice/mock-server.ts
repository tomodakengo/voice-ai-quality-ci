/**
 * オフライン用モック ASR WebSocket サーバ。
 *
 * 目的:
 * - 実 AmiVoice API キー(無償クーポンは月10時間)を消費せずに E2E / CI を緑にする。
 * - AmiVoice WS プロトコル(s/p/e ⇄ s/S/U/A/E/e)を模倣する。
 * - 受信した 'start' コマンドの grammar / profileWords を見て、決め打ちの認識結果を返す。
 *   返すテキストは MOCK_TRANSCRIPT env か、grammar に紐づくシナリオで切替可能。
 *
 * これは「テストダブル」であり認識はしない。記事では「実APIモードとモックモードを
 * 同一プロトコルで切替え、CIではモードを固定」という設計として紹介する。
 */
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "../config.js";

const PORT = config.mock.port;

/** シナリオ: grammar や送信テキストに依らず、環境変数で返答を差し替えられる */
const SCENARIOS: Record<string, string> = {
  default: "こんにちは、音声認識のテストです",
  order: "ホットコーヒーをエスプレッソに変更してください",
  meeting: "来週の月曜日に定例会議を設定してください",
};

function transcriptFor(grammar: string): string {
  const fromEnv = process.env.MOCK_TRANSCRIPT?.trim();
  if (fromEnv) return fromEnv;
  if (grammar.includes("order")) return SCENARIOS.order!;
  if (grammar.includes("meeting")) return SCENARIOS.meeting!;
  return SCENARIOS.default!;
}

function makeSegment(text: string) {
  // 1文字=1トークン相当の擬似タイムスタンプ/confidence を付ける
  let t = 0;
  const tokens = [...text].map((ch) => {
    const start = t;
    t += 120;
    return {
      written: ch,
      spoken: ch,
      confidence: 0.9 + (ch.charCodeAt(0) % 10) / 100,
      starttime: start,
      endtime: t,
    };
  });
  return {
    text,
    confidence: 0.95,
    starttime: 0,
    endtime: t,
    tags: [],
    rulename: "",
    tokens,
  };
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws: WebSocket) => {
  let grammar = "-a-general";
  let audioReceived = false;

  ws.on("message", (raw: Buffer, isBinary: boolean) => {
    const firstByte = raw[0];
    // 'p' (0x70) は音声フレーム
    if (isBinary || firstByte === 0x70) {
      audioReceived = true;
      return; // モックは音声を捨てる
    }
    const msg = raw.toString("utf8");
    const cmd = msg[0];
    if (cmd === "s") {
      // s <fmt> <grammar> key=value...
      const parts = msg.split(/\s+/);
      grammar = parts[2] ?? grammar;
      ws.send("s"); // start ack
      ws.send("S 0"); // 発話開始
      // 中間結果を1回流す
      const text = transcriptFor(grammar);
      const interim = text.slice(0, Math.ceil(text.length / 2));
      ws.send(`U ${JSON.stringify({ text: interim })}`);
    } else if (cmd === "e") {
      const text = transcriptFor(grammar);
      const seg = makeSegment(audioReceived ? text : text);
      const result = { results: [seg], utteranceid: "mock-0001" };
      ws.send(`A ${JSON.stringify(seg)}`); // 発話確定(本来は results配列だが互換のためseg)
      ws.send("E 0"); // 発話終了
      ws.send("e"); // セッション終了
      void result;
      ws.close();
    }
  });

  ws.on("error", () => ws.close());
});

// eslint-disable-next-line no-console
console.log(`[mock-asr] listening on ws://localhost:${PORT}`);

process.on("SIGINT", () => {
  wss.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  wss.close();
  process.exit(0);
});
