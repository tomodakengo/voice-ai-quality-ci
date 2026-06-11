import "dotenv/config";

/**
 * 一元化した設定。env が無ければ安全な既定値にフォールバックする。
 * APIキーは絶対にここへハードコードしない(.env / GitHub Secrets 経由)。
 */
function env(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return fallback;
  return v === "1" || v === "true" || v === "yes";
}

export const config = {
  amivoice: {
    appkey: env("AMIVOICE_APPKEY"),
    httpSyncUrl: env(
      "AMIVOICE_HTTP_SYNC_URL",
      "https://acp-api.amivoice.com/v1/recognize",
    ),
    httpAsyncUrl: env(
      "AMIVOICE_HTTP_ASYNC_URL",
      "https://acp-api-async.amivoice.com/v1/recognitions",
    ),
    wsUrl: env("AMIVOICE_WS_URL", "wss://acp-api.amivoice.com/v1/"),
    grammar: env("AMIVOICE_GRAMMAR", "-a-general"),
  },
  anthropic: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001"),
  },
  mock: {
    // appkey が無いか USE_MOCK_ASR=true ならオフライン(モック)で動かす。
    useMockAsr: bool("USE_MOCK_ASR", true) || env("AMIVOICE_APPKEY") === "",
    port: Number(env("MOCK_ASR_PORT", "9100")),
  },
  app: {
    port: Number(env("APP_PORT", "8080")),
  },
} as const;

export function assertAmivoiceKey(): string {
  if (!config.amivoice.appkey) {
    throw new Error(
      "AMIVOICE_APPKEY が未設定です。.env に設定するか USE_MOCK_ASR=true でモックを使ってください。",
    );
  }
  return config.amivoice.appkey;
}
