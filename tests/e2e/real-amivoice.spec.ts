import { test, expect } from "@playwright/test";

/**
 * 実 AmiVoice WebSocket に対する真のE2E(fake audio → ブラウザ → 実API → 画面表示)。
 *
 * 既定はスキップ。実行するには:
 *   USE_MOCK_ASR=false RUN_REAL_E2E=1 E2E_FIXTURE_WAV=order-001.wav npx playwright test real-amivoice
 * 前提: .env に AMIVOICE_APPKEY、fixtures/audio/order-001.wav(実音声16kHz mono)。
 *
 * これが通れば「fake audioで注入した実音声が、ブラウザのgetUserMedia→16kへダウンサンプル
 * →AmiVoice WSリアルタイム認識→画面表示」まで一気通貫で動くことの証明になる。
 */
const RUN = process.env.RUN_REAL_E2E === "1" && process.env.USE_MOCK_ASR === "false";

test.describe("実 AmiVoice E2E", () => {
  test.skip(!RUN, "RUN_REAL_E2E=1 かつ USE_MOCK_ASR=false のときのみ実行");

  test("fake audio(実音声)→ AmiVoice WS → 認識テキスト表示", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await expect(page.locator("#mode")).toContainText("real");

    await page.getByRole("button", { name: /録音開始/ }).click();
    // 実音声2.7秒 + WS往復。十分待ってから停止。
    await page.waitForTimeout(5000);
    await page.getByRole("button", { name: /停止/ }).click();

    const transcript = page.getByTestId("transcript");
    await expect(transcript).not.toHaveText("", { timeout: 20_000 });
    const text = (await transcript.textContent()) ?? "";
    // order-001.wav = 「ホットコーヒーを一杯ください」。主要語が含まれることを確認。
    expect(text).toMatch(/コーヒー|ください/);

    // LLM抽出まで到達
    await expect(page.getByTestId("action")).not.toHaveText("—", { timeout: 20_000 });
  });
});
