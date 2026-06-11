/**
 * VOICEVOX(ローカル・無料・再現性高)でテスト発話を合成する。
 *
 * 前提: VOICEVOX エンジンを起動しておく(既定 http://localhost:50021)。
 *   - アプリ版を起動 or `docker run -p 50021:50021 voicevox/voicevox_engine`
 * エンジンが居なければ、合成はスキップして scripts/gen-synthetic-wav.ts の
 * 合成トーンへフォールバックする旨を案内する(CI/オフラインでも止まらない)。
 *
 * 出力: fixtures/audio/<caseId>.<rate>.wav (VOICEVOX は 24kHz 出力 → 後段で
 * scripts/convert-wav.* により lsb16k へ変換する)。
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ENGINE = process.env.VOICEVOX_URL ?? "http://localhost:50021";
const OUT = join(process.cwd(), "fixtures/audio");

interface Case {
  id: string;
  text: string;
  tts?: { speaker?: number; speedScale?: number };
}

async function engineAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${ENGINE}/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function synth(text: string, speaker: number, speedScale: number): Promise<Buffer> {
  // 1) audio_query で韻律パラメータを得る
  const q = await fetch(
    `${ENGINE}/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`,
    { method: "POST" },
  );
  if (!q.ok) throw new Error(`audio_query failed: ${q.status}`);
  const query = (await q.json()) as Record<string, unknown>;
  query.speedScale = speedScale;
  query.outputSamplingRate = 24000;

  // 2) synthesis で WAV を生成
  const s = await fetch(`${ENGINE}/synthesis?speaker=${speaker}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!s.ok) throw new Error(`synthesis failed: ${s.status}`);
  return Buffer.from(await s.arrayBuffer());
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const ds = JSON.parse(
    await readFile(join(process.cwd(), "fixtures/cases/dataset.json"), "utf8"),
  ) as { cases: Case[] };

  if (!(await engineAlive())) {
    // eslint-disable-next-line no-console
    console.error(
      `[gen-fixtures] VOICEVOX エンジンに接続できません (${ENGINE})。\n` +
        `  起動例: docker run --rm -p 50021:50021 voicevox/voicevox_engine:cpu-latest\n` +
        `  オフラインで動かす場合は \`npm run gen:wav\`(合成トーン)を使ってください。`,
    );
    process.exit(2);
  }

  for (const c of ds.cases) {
    const speaker = c.tts?.speaker ?? 3;
    const speed = c.tts?.speedScale ?? 1.0;
    const wav = await synth(c.text, speaker, speed);
    const path = join(OUT, `${c.id}.24k.wav`);
    await writeFile(path, wav);
    // eslint-disable-next-line no-console
    console.log(`synth ${c.id} -> ${path} (${wav.length} bytes, speaker=${speaker}, speed=${speed})`);
  }
  // eslint-disable-next-line no-console
  console.log("\n次: scripts/convert-wav.(sh|ps1) で lsb16k(16kHz/16bit/mono)へ変換してください。");
}

void main();
