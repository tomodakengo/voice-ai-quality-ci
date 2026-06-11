/**
 * コミット前の秘密情報チェック。リポジトリ公開前提なので、APIキー混入を機械的に弾く。
 *
 * 検出対象:
 *   - AmiVoice APPKEY らしき長い英数字トークン(.env.example / docs の説明文は除外)
 *   - Anthropic キー(sk-ant-...)、汎用の sk- キー
 *   - .env が tracked になっていないか
 *
 * クーポンコード(Na5bkyRHoi)は公開情報なので許可リストに入れる。
 * 非ゼロ終了で CI を落とす。
 */
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const ALLOW = [
  "Na5bkyRHoi", // 公開クーポンコード(記事掲載可)
];

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "OpenAI-style key", re: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  // AmiVoice appkey っぽい: 30文字以上の16進/英数の塊(コメント説明は別途除外)
  { name: "Possible AmiVoice appkey", re: /\b[0-9a-f]{40,}\b/g },
];

function listFiles(): string[] {
  const out = execSync("git ls-files", { encoding: "utf8" });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !f.startsWith("node_modules/"))
    // バイナリ・自明に安全なものは除外
    .filter((f) => !/\.(wav|png|webm|zip|woff2?)$/.test(f));
}

async function main(): Promise<void> {
  const files = listFiles();
  let findings = 0;

  // .env が tracked になっていないか
  if (files.includes(".env")) {
    console.error("❌ .env が git に追跡されています。`git rm --cached .env` してください。");
    findings++;
  }

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    // 例示ファイルは緩める(空値の代入や説明のため)
    const isExample = /\.env\.example$|\.md$/.test(file);
    for (const { name, re } of PATTERNS) {
      const matches = content.match(re) ?? [];
      for (const m of matches) {
        if (ALLOW.includes(m)) continue;
        // .env.example / docs の「AMIVOICE_APPKEY=」のような空・プレースホルダは無視
        if (isExample && /^[A-Z_]+=$/.test(m)) continue;
        console.error(`❌ ${file}: ${name} らしき文字列を検出: ${m.slice(0, 12)}…`);
        findings++;
      }
    }
    // 値の入った env 代入(KEY=実値)を検出
    const assign = content.match(/(AMIVOICE_APPKEY|ANTHROPIC_API_KEY)\s*=\s*([^\s#"']+)/g) ?? [];
    for (const a of assign) {
      const val = a.split("=")[1]?.trim() ?? "";
      if (val && !ALLOW.includes(val) && !file.endsWith(".example")) {
        console.error(`❌ ${file}: APIキーに実値が入っています: ${a.slice(0, 24)}…`);
        findings++;
      }
    }
  }

  if (findings > 0) {
    console.error(`\n秘密情報チェック失敗: ${findings} 件。コミット前に除去してください。`);
    process.exit(1);
  }
  console.log("✅ 秘密情報チェック OK(APIキー混入なし)");
}

void main();
