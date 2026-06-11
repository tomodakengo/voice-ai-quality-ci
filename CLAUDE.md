# 音声AIアプリの品質をCIで守る — 検証プロジェクト

## このプロジェクトの目的

Zennfes Spring 2026 のコンテスト「音声認識APIと生成AIで作る音声体験」(締切 2026-06-26)向け記事の**実測・検証フェーズ**を行う。

記事テーマ(本命案):
**「音声AIアプリの品質をCIで守る — AmiVoice×LLMアプリのテスト戦略(評価ハーネス + Playwright E2E)」**

- 審査基準は ①完成度と再現性 ②有益性と課題解決 ③独自性 の3つ。審査はスポンサー(アドバンスト・メディア)。
- 競合38件はほぼ全て「作ってみた」系で、品質保証・テストの観点はゼロ。検証・実測系の記事が最もブックマーク率が高い。
- 記事執筆とZennリポジトリへのPRは別チャット(Claude.aiプロジェクト)側で行う。**このリポジトリの成果物は記事の素材**。

## 役割分担

- **Claude Code(ここ)**: PoC実装、API実測、CI構築、数値とハマりどころの記録
- **Claude.aiプロジェクト**: 記事構成・執筆・推敲・PR作成

## 検証すべき項目(優先度順)

### 1. Playwright + fake audio によるE2Eテスト(記事の独自性の核)

Chromiumの起動フラグでマイク入力をWAVファイルに差し替え、音声入力UIを自動テストできるか検証する。

```
--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream        # マイク許可ダイアログをスキップ
--use-file-for-fake-audio-capture=/path/to/fixture.wav
```

検証ポイント:
- [ ] WAVフォーマット要件の特定(サンプリングレート/ビット深度/チャンネル数で何が通り、何が無音になるか)。失敗パターンも記録する(記事の「ハマったポイント」素材)
- [ ] 音声再生のタイミング挙動(getUserMedia開始時に頭から再生されるか、ループするか、`%noloop` サフィックスの挙動)
- [ ] Playwrightの `launchOptions.args` + `permissions: ['microphone']` の組み合わせ
- [ ] headless / headed での挙動差(CIはheadless前提)
- [ ] テスト対象として最小の音声入力Webアプリ(マイク→AmiVoice WebSocket→認識結果表示→LLM処理)を自作する

### 2. AmiVoice API の実装と仕様の一次確認

公式ドキュメント: https://docs.amivoice.com/amivoice-api/manual/getting-started/
無償クーポン(月10時間、5・6月): `Na5bkyRHoi` — 案内: https://acp.amivoice.com/blog/zenn_2026/

検証ポイント:
- [ ] 3つのI/F(同期HTTP / 非同期HTTP / WebSocketリアルタイム)の使い分けと、E2Eテスト対象アプリにはWebSocketを採用
- [ ] エンジン選択(`grammarFileNames`: 汎用 `-a-general` 等)とドメイン特化エンジンの指定方法
- [ ] `a` パラメータ周りの罠(競合記事 gen99 氏も「ハマった」と言及。一次情報として自分でも踏んで記録する)
- [ ] トークン単位の confidence・タイムスタンプの取得方法(評価ハーネスの採点に使う)
- [ ] ユーザー辞書(profileWords等)の登録方法と、before/after の認識精度差
- [ ] 認証方式(APPKEY の渡し方)。**キーは絶対にコミットしない。`.env` + `.gitignore`、CIはGitHub Secrets**

### 3. テスト音声フィクスチャの生成パイプライン

- [ ] TTSでテスト発話を合成(候補: VOICEVOX(ローカル・無料・再現性高)/ OpenAI TTS / Azure Speech。記事の再現性重視ならVOICEVOX優先で比較検討)
- [ ] ffmpeg/soxで Chromium fake capture と AmiVoice 双方の要件に合うWAVへ変換するスクリプト化
- [ ] ノイズ重畳(SNR段階別)・話速変更(atempo)・フィラー挿入をスクリプトで再現可能にする

### 4. 評価ハーネス(ASR×LLMパイプラインの回帰テスト)

- [ ] テスト条件の因子設計: 話速 × ノイズ(SNR) × ドメイン用語の有無 × フィラーの有無 など。**PICTでペアワイズ設計**し、全組み合わせとの件数差を記事に書く
- [ ] CER(文字誤り率)計測: 日本語なので文字ベース。正規化ルール(数字・記号・空白)を明文化する
- [ ] エンジン別(汎用 vs 特化)・辞書有無での CER 比較表を出す
- [ ] LLM出力(構造化抽出など)の正しさは LLM-as-judge + 期待値スキーマ検証(zod等)の二段構え
- [ ] 「ASRの誤りがLLM出力にどう伝播するか」を1ケースでいいので定量的に示す(記事のキラーコンテンツ候補)

### 5. CI(GitHub Actions)

- [ ] 評価ハーネスのスモーク版(数ファイルのみ)をPRごとに実行、フルセットは手動/夜間
- [ ] Playwright E2E を headless Chromium + fake audio で実行
- [ ] APIキーは Secrets、使用量を食いすぎない設計(クーポン枠は月10時間)
- [ ] 失敗時のアーティファクト(認識結果JSON、trace、スクリーンショット)保存

## 記事側が必要とするアウトプット(成果物の形式)

実測が終わったら以下を `notes/` ディレクトリにまとめてほしい。これをそのまま執筆チャットに持ち込む。

1. `notes/results.md` — 実測数値の表(Markdownテーブル)。CER比較、エンジン比較、辞書before/after、E2E実行時間など
2. `notes/gotchas.md` — ハマったポイントの時系列メモ(エラーメッセージ原文、原因、回避策)。記事の信頼性はここで決まる
3. `notes/architecture.md` — 構成図の元ネタ(テキストで可。Mermaid歓迎)
4. コードは記事掲載に耐える最小例に整理(リポジトリは公開前提。キー・クーポンコードの混入チェック必須)

## 制約・注意

- 言語/スタックは TypeScript + Playwright を基本とし、計測スクリプトはPythonでも可(jiwer等が楽なら)
- 数値は必ず「測定条件つき」で記録する(エンジン名、音声長、試行回数、日付)
- API仕様はドキュメントで一次確認し、推測で書かない(記事の正確性に直結)
- クーポンコードは記事には書いてよい(公開情報)が、APIキーは絶対に露出させない
