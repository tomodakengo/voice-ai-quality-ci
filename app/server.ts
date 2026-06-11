/**
 * 最小の音声入力Webアプリのサーバ。
 *
 * - GET /            → index.html
 * - GET /main.js     → app/src/main.ts を esbuild でブラウザ向けにバンドルして配信
 * - GET /config.json → クライアントへ ws URL とモード(mock/real)を渡す
 * - POST /api/extract→ 認識テキストを受け、サーバ側で LLM 抽出(APIキーはサーバに留める)
 *
 * APIキー保護: ANTHROPIC_API_KEY はサーバ側でのみ使う。mock モードでは AmiVoice の
 * appkey もブラウザに出さない。実APIモードのキー配布はトークン発行プロキシが本来の形
 * (notes/gotchas.md 参照)。
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { config } from "../src/config.js";
import { extractAction } from "../src/llm/extract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = config.app.port;

async function bundleClient(): Promise<string> {
  const result = await build({
    entryPoints: [join(__dirname, "src/main.ts")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    write: false,
    sourcemap: "inline",
  });
  return result.outputFiles[0]!.text;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (req.method === "GET" && url.pathname === "/") {
      const html = await readFile(join(__dirname, "index.html"), "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/main.js") {
      const js = await bundleClient();
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" });
      res.end(js);
      return;
    }
    if (req.method === "GET" && url.pathname === "/config.json") {
      const useMock = config.mock.useMockAsr;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          useMock,
          wsUrl: useMock ? `ws://localhost:${config.mock.port}` : config.amivoice.wsUrl,
          // mock では appkey を出さない。実API時のみ(自己責任で)配布。
          appkey: useMock ? "" : config.amivoice.appkey,
          grammar: config.amivoice.grammar,
        }),
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/extract") {
      const body = await readBody(req);
      const { transcript } = JSON.parse(body || "{}") as { transcript?: string };
      const result = await extractAction(transcript ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
      return;
    }
    res.writeHead(404);
    res.end("Not found");
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Server error: ${(err as Error).message}`);
  }
});

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[app] http://localhost:${PORT}  (ASR mode: ${config.mock.useMockAsr ? "mock" : "real AmiVoice"})`,
  );
});
