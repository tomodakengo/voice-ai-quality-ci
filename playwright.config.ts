import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

/**
 * Playwright config for fake-audio E2E.
 *
 * 要点(記事の核):
 * - Chromium の起動フラグでマイク入力を WAV ファイルに差し替える。
 *   --use-fake-device-for-media-stream : 実デバイスの代わりに合成デバイスを使う
 *   --use-fake-ui-for-media-stream     : getUserMedia の許可ダイアログを自動承認
 *   --use-file-for-fake-audio-capture  : 合成デバイスの音声を WAV ファイルにする
 * - permissions: ['microphone'] を context に付けると、--use-fake-ui を使わなくても
 *   許可が下りる。両方併用して headless でも安定させる。
 * - WAV は 16kHz / 16bit / mono を基本にする(詳細は notes/gotchas.md)。
 */

const FIXTURE_WAV = resolve(
  process.cwd(),
  "fixtures/audio",
  process.env.E2E_FIXTURE_WAV ?? "hello_16k_mono.wav",
);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${process.env.APP_PORT ?? 8080}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    permissions: ["microphone"],
  },
  projects: [
    {
      name: "chromium-fake-audio",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-audio-capture=${FIXTURE_WAV}`,
            // ループ再生させたくない場合は WAV パスに %noloop を付ける:
            // `--use-file-for-fake-audio-capture=${FIXTURE_WAV}%noloop`
          ],
        },
      },
    },
  ],
  // app サーバと mock ASR を同時起動。実APIを使うときは USE_MOCK_ASR=false。
  webServer: [
    {
      command: "npm run mock-asr",
      port: Number(process.env.MOCK_ASR_PORT ?? 9100),
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
    },
    {
      command: "npm run app",
      port: Number(process.env.APP_PORT ?? 8080),
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
    },
  ],
});
