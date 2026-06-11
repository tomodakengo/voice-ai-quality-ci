# アーキテクチャ(構成図の元ネタ)

## 図1. Playwright fake-audio E2E(音声入力アプリの一気通貫テスト)

```mermaid
flowchart LR
    subgraph CI["GitHub Actions (headless)"]
        PW["Playwright<br/>chromium-fake-audio"]
    end

    WAV["fixtures/audio/*.wav<br/>(16kHz mono 実音声)"]
    PW -- "起動フラグ<br/>--use-file-for-fake-audio-capture" --> CHROME

    subgraph CHROME["Chromium"]
        FAKE["fake audio device<br/>(マイク差し替え)"]
        APP["音声入力アプリ<br/>app/index.html + main.ts"]
        FAKE -- "getUserMedia()<br/>permissions: microphone" --> APP
        APP -- "WebAudio: 48k→16k<br/>ダウンサンプル + 'p'フレーム" --> WSC
        WSC["AmiVoiceWsClient"]
    end

    WAV --> FAKE

    WSC -- "WebSocket s/p/e" --> ASR
    subgraph ASR["ASR バックエンド(切替)"]
        MOCK["mock-server.ts<br/>(既定/CI: キー不要)"]
        REAL["AmiVoice WS<br/>wss://acp-api.amivoice.com/v1/"]
    end
    ASR -- "U(中間)/A(確定)" --> WSC
    WSC -- "確定テキスト" --> APP
    APP -- "POST /api/extract" --> EXT["LLM抽出(サーバ側)<br/>Claude tool use + zod"]
    EXT -- "Action JSON" --> APP
    APP -- "data-testid で検証" --> PW
```

**ポイント**: ASR バックエンドは mock と実 AmiVoice を**同一WSプロトコルで切替**。
CI は mock(キー不要・クーポン消費ゼロ)、実APIE2Eは `USE_MOCK_ASR=false` で同じテストが通る。

---

## 図2. 評価ハーネス(ASR×LLM パイプラインの回帰テスト)

```mermaid
flowchart TD
    subgraph DESIGN["条件設計"]
        PICT["eval/factors.pict<br/>6因子(速度/SNR/ドメイン用語/<br/>フィラー/エンジン/辞書)"]
        PW["scripts/pairwise.py<br/>全192 → ペアワイズ12"]
        PICT --> PW
    end

    subgraph FIX["フィクスチャ生成"]
        TTS["TTS<br/>SAPI Haruka / VOICEVOX"]
        RS["resample-wav.ts<br/>→ 16kHz mono"]
        AUG["augment.ts<br/>ノイズ(校正SNR)/話速"]
        TTS --> RS --> AUG
    end

    subgraph MEASURE["計測"]
        ASR2["AmiVoice 認識<br/>HTTP同期 / WS<br/>(or 決定的シミュレータ)"]
        CER["CER 計測<br/>cer.ts + normalize.ts<br/>(正規化プリセット)"]
        EXT2["LLM 構造化抽出<br/>extract.ts + schema(zod)"]
        JUDGE["二段評価<br/>1.zodスキーマ検証<br/>2.LLM-as-judge"]
        ASR2 --> CER
        ASR2 --> EXT2 --> JUDGE
    end

    DGT["fixtures/cases/dataset.json<br/>(正解文 + 期待Action)"]
    AUG --> ASR2
    DGT -. "参照(CER)" .-> CER
    DGT -. "期待値(judge)" .-> JUDGE

    CER --> REPORT["eval/out/*.json<br/>+ Markdown表<br/>(notes/results.md)"]
    JUDGE --> REPORT
    PW -.-> MEASURE
```

**ポイント**: 「ASR の CER」だけでなく「**ASR誤り → LLM構造化出力の破綻**」まで一気通貫で計測。
LLM出力は **zod(形)+ LLM-as-judge(意味)** の二段で検証する。

---

## コンポーネント対応表

| 層 | ファイル | 役割 |
|---|---|---|
| 音声入力アプリ | `app/index.html`, `app/src/main.ts` | マイク録音UI・表示 |
| WSクライアント(ブラウザ) | `app/src/amivoice-ws-client.ts` | 48k→16k変換, s/p/e送信 |
| アプリサーバ | `app/server.ts` | 静的配信 + esbuildバンドル + /api/extract |
| AmiVoice(同期/非同期/WS) | `src/amivoice/{http-sync,http-async,ws-node}.ts` | 3つのI/F |
| モックASR | `src/amivoice/mock-server.ts` | オフラインE2E/CI用テストダブル |
| 音声処理 | `src/audio/{wav,augment}.ts` | WAV入出力, リサンプル, ノイズ/話速 |
| 評価 | `src/eval/{cer,normalize,judge}.ts` | CER, 正規化, judge |
| LLM | `src/llm/{extract,schema}.ts` | 構造化抽出 + zodスキーマ |
| 条件設計 | `eval/factors.pict`, `scripts/pairwise.py` | PICTペアワイズ |
| 計測実行 | `scripts/measure-*.ts`, `run-eval.ts` | 実測 & 集計 |
| CI | `.github/workflows/{ci,e2e,eval-nightly}.yml` | PR軽量 / E2E / 夜間フル |
