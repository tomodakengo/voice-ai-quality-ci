import { test, expect } from "@playwright/test";

/**
 * fake audio による音声入力 E2E。
 *
 * 検証している記事ポイント:
 * - Chromium 起動フラグ(playwright.config.ts の launchOptions.args)で
 *   マイク入力が fixtures の WAV に差し替わる。
 * - permissions: ['microphone'] により getUserMedia の許可ダイアログが出ない。
 * - mock ASR モードなので実 AmiVoice キー不要 → CI が緑/クーポン消費ゼロ。
 *
 * 実APIで回したい場合は USE_MOCK_ASR=false + AMIVOICE_APPKEY を設定し、
 * MOCK_TRANSCRIPT への依存(下の文字列一致)を緩める。
 */

test.describe("音声コマンド PoC", () => {
  test("ページが読み込まれ、初期状態が正しい", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "音声コマンド PoC" })).toBeVisible();
    await expect(page.getByTestId("transcript")).toHaveText("");
    await expect(page.getByTestId("action")).toHaveText("—");
    // モード表示が mock であること
    await expect(page.locator("#mode")).toContainText("mock");
  });

  test("録音→fake audio→認識テキスト表示→LLM抽出までの一連が動く", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /録音開始/ }).click();

    // 録音状態へ遷移
    await expect(page.locator("#record")).toHaveAttribute("data-state", "recording");

    // mock が中間→確定を返すので、少し待って停止
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: /停止/ }).click();

    // 確定テキストが入る(mock の default シナリオ)
    await expect(page.getByTestId("transcript")).not.toHaveText("", { timeout: 10_000 });

    // LLM 抽出(フォールバック含む)が JSON を出す
    const action = page.getByTestId("action");
    await expect(action).not.toHaveText("—", { timeout: 10_000 });
    const json = await action.textContent();
    const parsed = JSON.parse(json ?? "{}");
    expect(parsed).toHaveProperty("intent");
    expect(parsed).toHaveProperty("modifiers");
  });

  test("マイク許可ダイアログ無しで getUserMedia が成功する", async ({ page }) => {
    await page.goto("/");
    const ok = await page.evaluate(async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        const tracks = s.getAudioTracks().length;
        s.getTracks().forEach((t) => t.stop());
        return tracks > 0;
      } catch {
        return false;
      }
    });
    expect(ok).toBe(true);
  });
});
