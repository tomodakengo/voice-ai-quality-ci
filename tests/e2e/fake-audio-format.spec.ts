import { test, expect } from "@playwright/test";

/**
 * Chromium fake audio が実際に「音」を届けているかを WebAudio で実測する。
 *
 * これは記事の核(WAVフォーマット要件の切り分け)の土台。
 * getUserMedia → AnalyserNode で RMS を測り、無音(=フォーマット不適合で
 * 取り込まれなかった)かどうかを判定する。
 *
 * 現在の起動フィクスチャは playwright.config.ts の E2E_FIXTURE_WAV(既定:
 * hello_16k_mono.wav)。フォーマット行列を試すには env を変えて再実行する:
 *   E2E_FIXTURE_WAV=hello_44k_mono.wav npx playwright test fake-audio-format
 * 結果は notes/results.md の表に転記する。
 */

async function measureRms(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    // 数フレーム積算して RMS を取る
    let peak = 0;
    const start = performance.now();
    while (performance.now() - start < 800) {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      if (rms > peak) peak = rms;
      await new Promise((r) => setTimeout(r, 50));
    }
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    return peak;
  });
}

test("fake audio から非無音のサンプルが取り込まれている", async ({ page }) => {
  await page.goto("/");
  const rms = await measureRms(page);
  // eslint-disable-next-line no-console
  console.log(`[fake-audio] peak RMS = ${rms.toFixed(5)} (fixture=${process.env.E2E_FIXTURE_WAV ?? "hello_16k_mono.wav"})`);
  // 合成トーンなので十分大きい RMS が出る。無音(フォーマット不適合)なら ~0。
  expect(rms).toBeGreaterThan(0.001);
});
