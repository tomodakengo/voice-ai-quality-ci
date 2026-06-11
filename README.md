# voice-ai-quality-ci

音声AIアプリ(**AmiVoice × LLM**)の品質を **CIで守る**ための検証用PoC。
Zennfes Spring 2026 記事「音声AIアプリの品質をCIで守る — AmiVoice×LLMアプリのテスト戦略
(評価ハーネス + Playwright E2E)」の**実測・検証フェーズの成果物**。

> 記事素材は [`notes/handoff.md`](notes/handoff.md)(統合)/ [`notes/results.md`](notes/results.md)(実測表)/
> [`notes/gotchas.md`](notes/gotchas.md)(失敗の記録)/ [`notes/architecture.md`](notes/architecture.md)(構成図)。

## 何ができるか

1. **Playwright fake-audio E2E** — Chromium起動フラグで実音声WAVをマイクに注入し、
   getUserMedia → AmiVoice WSリアルタイム認識 → 画面表示 → LLM構造化抽出 を headless で検証。
   mock ASR と実APIを同一プロトコルで切替(CIはmockでクーポン消費ゼロ)。
2. **評価ハーネス** — CER(文字誤り率・正規化プリセット)、PICTペアワイズ設計(192→12)、
   LLM-as-judge、**ASR誤り→LLM出力の伝播**を計測。実API/決定的シミュレータ両対応。
3. **CI(GitHub Actions)** — PR軽量(typecheck/unit/eval-smoke)、E2E、夜間フル。秘密情報スキャン付き。

## クイックスタート

```bash
npm ci
cp .env.example .env     # キーを設定。.env はコミットされない(.gitignore + check-secrets)

# オフライン(キー不要)
npm run typecheck && npm run test:unit && npm run eval:smoke
npm run gen:wav && npx playwright install chromium && npm run e2e

# 実測(要 AMIVOICE_APPKEY / ANTHROPIC_API_KEY)
npm run gen:sapi && npm run pipeline:real    # TTS→16k化→AmiVoice→CER 一括
```

詳細な再現手順は [`notes/handoff.md` §8](notes/handoff.md)。

## ディレクトリ

```
app/            最小の音声入力Webアプリ(mic→WS→LLM)+ サーバ
src/amivoice/   同期HTTP / 非同期HTTP / WebSocket クライアント + mockサーバ
src/eval/       CER / 正規化 / LLM-judge / ASR誤りシミュレータ
src/llm/        構造化抽出 + zodスキーマ
src/audio/      WAV入出力 / リサンプル / ノイズ・話速加工(ffmpeg不要)
scripts/        フィクスチャ生成・ペアワイズ・実測スクリプト
tests/          unit(node:test)+ e2e(Playwright)
eval/           PICTモデル + 出力(eval/out)
.github/        CIワークフロー3種
```

## 安全性

- APIキーは `.env` + GitHub Secrets。`npm run check-secrets` でコミット前にスキャン。
- 無償クーポンコード `Na5bkyRHoi` は公開情報(記事掲載可)。**APIキーは絶対に露出させない**。

## ライセンス / 注意

検証用PoC。AmiVoice API仕様は [`notes/handoff.md` §7](notes/handoff.md) に一次確認メモ
(✅実測 / 📄ドキュメント / ⚠️未確認 の別つき)。
