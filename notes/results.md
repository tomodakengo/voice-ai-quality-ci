# 実測結果(記事素材)

> 測定条件は各表の見出しに明記。数値は再現可能(`npm run ...` で再生成)。
> 音声は **SAPI(Microsoft Haruka, ja-JP)合成 → 16kHz/16bit/mono へリサンプル**。
> VOICEVOX が使える環境では `npm run gen:fixtures` で差し替え可能(より自然な発話)。
> **【実測】=実 AmiVoice API / 【シミュレータ】=決定的ASR誤りモデル(ffmpeg/特化エンジン等が
> 使えない条件の代替。ハーネスの集計ロジック検証用)** を明記する。

---

## A.【実測】AmiVoice 認識 + 正規化プリセット感度

**条件**: AmiVoice `-a-general` / HTTP同期 / 各ケース1回 / SAPI Haruka 16kHz mono / 2026-06-11
**音声合計**: 22.8秒(6ケース) / **再生成**: `npm run measure:real`

| ケース | 正解 | 認識結果 | CER(default) | CER(+digits) | CER(+digits+fillers) |
|---|---|---|---|---|---|
| order-001 | ホットコーヒーを一杯ください | ホットコーヒーを一杯ください。 | 0.0% | 0.0% | 0.0% |
| order-002 | アイスカフェラテをラージで二つお願いします | アイスカフェラテをラージで二つお願いします。 | 0.0% | 0.0% | 0.0% |
| schedule-001 | 来週の月曜日に定例会議を設定してください | 来週の月曜日に定例会議を設定してください。 | 0.0% | 0.0% | 0.0% |
| schedule-002 | 明日の十五時にミーティングを入れてください | 明日の**15時**にミーティングを入れてください。 | 9.5% | 0.0% | 0.0% |
| domain-001 | デシベルとサンプリングレートの設定を確認してください | デシベルとサンプリングレートの設定を確認してください。 | 0.0% | 0.0% | 0.0% |
| filler-001 | えーっと、ホットコーヒーをですね、一杯ください | ホットコーヒーをですね、**いっぱい**ください。 | 38.1% | 38.1% | 28.6% |
| **平均** | | | **7.9%** | **6.3%** | **4.8%** |

**読みどころ**: 同じ認識結果でも正規化ルールで平均 CER 7.9%→4.8%。`schedule-002` は ASR が
数詞を算用数字で返す(`十五時`→`15時`)ため digits 正規化で 9.5%→0%。日本語 CER は
**正規化ルールの明文化が必須**。

---

## B.【実測】ノイズSNR段階別 CER(校正済みホワイトノイズ重畳)

**条件**: AmiVoice `-a-general` / HTTP同期 / order-001,order-002,filler-001 の3ケース /
Node製ノイズミキサ(実SNRは計算値)/ 2026-06-11
**試行**: 12回 / **音声合計**: 43.1秒 / **再生成**: `npm run measure:snr`

| SNR | ケース平均 CER | 試行回数 | 代表的な誤認識(order-001:「ホットコーヒーを一杯ください」) |
|---|---|---|---|
| clean | 12.7% | 3 | ホットコーヒーを一杯ください(0%) |
| 20dB | 12.7% | 3 | ホットコーヒーを一杯ください(0%) |
| 10dB | 46.0% | 3 | **パソコンBをいっぱいください**(71%) |
| 5dB | 48.4% | 3 | ポストコンビニを1回ください(50%) |

**読みどころ**: 20dB までは劣化ゼロ、**10dB で崖**(CER急増)。汎用エンジンは中程度ノイズに
強いが、SNR 10dB 付近で破綻する。filler-001 のベースライン誤り(38%)が clean 平均を押し上げている。

---

## C.【実測】エンジン比較(会話汎用 vs 音声入力向け)

**条件**: AmiVoice `-a-general`(会話汎用) vs `-a-general-input`(音声入力向け)/ HTTP同期 /
order-001,order-002,schedule-002 / clean & 10dBノイズ / 2026-06-11
**試行**: 12回 / **音声合計**: 39.0秒 / **再生成**: `npm run measure:engine`

| 条件 | エンジン | ケース平均 CER | 試行回数 |
|---|---|---|---|
| clean | -a-general | 3.2% | 3 |
| clean | -a-general-input | 3.2% | 3 |
| 10dB | -a-general | 36.5% | 3 |
| **10dB** | **-a-general-input** | **14.3%** | 3 |

**読みどころ(キラー)**: clean では両者同等だが、**10dBノイズ下で `-a-general-input` が圧勝**
(CER 36.5%→14.3%)。order-001 10dB では `-a-general` が「パソコンBをいっぱい」(71%)になる一方、
`-a-general-input` は**完璧に認識(0%)**。短い発話コマンド+ノイズでは音声入力向けエンジンが頑健。

> ⚠️ ドメイン特化エンジン(`-a-medgeneral` 等)は**空応答=クーポンで権限なし**のため未測定(下記G)。

---

## D.【実測】WAVフォーマット受理性(2層)

### D-1. AmiVoice 側(HTTP同期, order-001実音声, `-a-general`, 2026-06-11)
**試行**: 8回 / **音声合計**: 約24秒 / **再生成**: `npm run measure:format`

| フォーマット | 判定 | CER | 認識結果/エラー原文 |
|---|---|---|---|
| 16kHz/16bit/mono PCM(基準=lsb16k) | 成功 | 0.0% | ホットコーヒーを一杯ください。 |
| 8kHz/16bit/mono PCM | 成功 | 0.0% | ホットコーヒーを一杯ください。 |
| 44.1kHz/16bit/mono PCM | 成功 | 0.0% | ホットコーヒーを一杯ください。 |
| 16kHz/16bit/**stereo** PCM | 成功 | 0.0% | ホットコーヒーを一杯ください。 |
| **ヘッダ無し生PCM**(audio/wav詐称) | 成功 | 0.0% | ホットコーヒーを一杯ください。 |
| 空(0バイト) | **無音** | - | results空/textなし |
| ゴミバイト列(audio/wav詐称) | **無音** | - | results空/textなし |
| 不正appkey | **エラー** | - | `received illegal service authorization`(**HTTP 200**+message) |

**読みどころ**: AmiVoice HTTP同期は WAV ヘッダを読んで内部リサンプルするため、レート/チャンネルに
**非常に寛容**(8k/44k/stereo すべて成功)。一方で**認証失敗でも HTTP 200 を返し、エラーは
body の `message` に入る**(後述 gotchas#1)。不正入力はエラーではなく**無音(空応答)**に落ちる。

### D-2. ブラウザ(Chromium fake capture)側
**条件**: Playwright 1.60 / `--use-file-for-fake-audio-capture` / getUserMedia→AnalyserNode peak RMS / headless
**再生成**: `E2E_FIXTURE_WAV=<file> npx playwright test fake-audio-format`

| フィクスチャ | レート/ch | peak RMS | 判定 |
|---|---|---|---|
| hello_16k_mono.wav | 16kHz / mono | 0.565 | ✅ 取り込みOK |
| hello_8k_mono.wav | 8kHz / mono | 0.388 | ✅ 取り込みOK |
| hello_44k_mono.wav | 44.1kHz / mono | 0.515 | ✅ 取り込みOK |
| hello_16k_stereo.wav | 16kHz / stereo | 0.373 | ✅ 取り込みOK |
| invalid.wav(非WAVテキスト) | - | **0.000** | ⚠️ **無音**(デコード不可) |

**読みどころ**: Chromium fake capture は有効WAVなら**何でも内部リサンプルして取り込む**(無音にならない)。
デコード不能なファイルのみ無音(RMS 0)。**フォーマット制約の本丸はブラウザではなく AmiVoice 側**。

---

## E.【実測】ASR → LLM 抽出 の誤り伝播

**条件**: 上記の認識結果 → Claude `claude-haiku-4-5` で構造化抽出 → LLM-as-judge / 2026-06-11
**再生成**: `npm run measure:real`(`eval/out/real.json`)

### E-1. clean 6ケースの伝播(judge一致率 4/6 = 66.7%)
| ケース | CER | judge | 抽出アクション | 備考 |
|---|---|---|---|---|
| order-001 | 0% | ✓ | `{order, ホットコーヒー, q=1}` | |
| order-002 | 0% | ✓ | `{order, アイスカフェラテ, q=2, [ラージ]}` | |
| schedule-001 | 0% | ✓ | `{schedule, 定例会議, 来週の月曜日}` | |
| schedule-002 | 0%※ | ✓ | `{schedule, 明日の15時}` | ※digits正規化後 |
| domain-001 | 0% | ✗ | `{query, デシベルと…}` | 正解ラベルが曖昧(下記G) |
| filler-001 | 28.6% | ✗ | `{order, ホットコーヒー, **q=null**, [いっぱい]}` | ASR誤りが伝播 |

### E-2. キラー4点セット(ノイズ誘発の致命的伝播)
| 項目 | 値 |
|---|---|
| 入力音声(正解文) | ホットコーヒーを一杯ください |
| 認識結果(10dBノイズ, `-a-general`) | **パソコンBをいっぱいください**(CER 71%) |
| LLM構造化出力 | `{intent:order, item:"パソコンB", quantity:1, modifiers:[]}` |
| 期待値 | `{intent:order, item:"ホットコーヒー", quantity:1}` |

**読みどころ**: ASR が品名を `ホットコーヒー`→`パソコンB` と誤ると、LLM は**スキーマ的に妥当だが
意味は完全に誤った注文**を自信を持って生成する。`filler-001` では `一杯`→`いっぱい`(かな化)で
**数量(quantity:1)を取りこぼす**。→ **ASRの1トークンの揺れが下流の構造化フィールドを壊す**。
「ASRだけ・LLMだけのテストでは捕まらない。パイプライン全体の回帰テストが要る」の実証。

---

## F.【シミュレータ】劣化条件の網羅(ハーネス集計ロジックの検証)

clean合成音声では汎用エンジンが強く、ffmpeg無し・特化エンジン権限なしの制約もあるため、
**因子全網羅の集計・伝播分析ロジック**は決定的ASR誤りシミュレータで検証した(実音声の追試はG参照)。
**条件**: simulated ASR / rule-based抽出 / 6ケース×エンジン2×辞書2×SNR4×話速3 = 288行 / `npm run eval`

| 区分 | micro CER | judge一致率 |
|---|---|---|
| 汎用エンジン(モデル) | 10.9% | 86.1% |
| 特化エンジン(モデル) | 7.3% | 88.2% |
| 辞書なし(tech×汎用) | 27.0% | 83.3% |
| 辞書あり(tech×汎用) | 12.3% | 83.3% |

**誤り伝播(CER帯→judge一致率)**: 0%→100% / 0–10%→86.7% / 10–25%→77.5% / >25%→46.7%
→ 実測E(CER上昇でjudge低下)と**同じ単調傾向**を再現。

---

## H. ペアワイズ設計の件数削減

**条件**: 因子6(速度3×SNR4×ドメイン用語2×フィラー2×エンジン2×辞書2)/ `npm run pairwise`

| 指標 | 値 |
|---|---|
| 全組み合わせ | **192** |
| ペアワイズ(2因子網羅) | **12** |
| 削減率 | **6.2%**(1/16以下) |
| 2因子ペア網羅 | 92/92(**100%**, スクリプトで検証済み) |

---

## I. E2E 実行時間 / API使用量

| 項目 | 値 |
|---|---|
| voice-input.spec(3テスト, mock) | 約9秒 |
| fake-audio-format.spec(1テスト) | 約8秒 |
| 実 AmiVoice E2E(real-amivoice.spec) | 約8秒(1テスト, 実音声→実WS) ✅ green |
| **本検証のAmiVoice API使用量合計** | **約5〜6分**(無償枠10時間の約1%) |

---

## 測定環境
- OS: Windows 11 Pro / Node v22.21.1 / Python 3.13
- AmiVoice: `-a-general`, `-a-general-input`(HTTP同期 & WebSocket で同一結果を確認)
- LLM: Anthropic `claude-haiku-4-5`(構造化抽出 tool use + LLM-as-judge)
- TTS: SAPI Microsoft Haruka(ja-JP)。ffmpeg/VOICEVOX 不使用(Nodeリサンプラ/ノイズミキサで代替)
