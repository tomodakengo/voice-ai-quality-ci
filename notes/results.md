# 実測結果(記事素材)

> 測定条件は各表の見出しに明記。数値は再現可能(`npm run ...` で再生成)。
> 音声は **SAPI(Microsoft Haruka, ja-JP)合成 → 16kHz/16bit/mono へリサンプル**。
> VOICEVOX が使える環境では `npm run gen:fixtures` で差し替え可能(より自然な発話)。

---

## A. AmiVoice 実認識 + 正規化プリセット感度

**条件**: AmiVoice `-a-general` / HTTP同期 / 各ケース1回 / SAPI Haruka 16kHz mono / 2026-06-11
**再生成**: `npx tsx scripts/measure-real.ts`

| ケース | 正解 | 認識結果 | CER(default) | CER(+digits) | CER(+digits+fillers) |
|---|---|---|---|---|---|
| order-001 | ホットコーヒーを一杯ください | ホットコーヒーを一杯ください。 | 0.0% | 0.0% | 0.0% |
| order-002 | アイスカフェラテをラージで二つお願いします | アイスカフェラテをラージで二つお願いします。 | 0.0% | 0.0% | 0.0% |
| schedule-001 | 来週の月曜日に定例会議を設定してください | 来週の月曜日に定例会議を設定してください。 | 0.0% | 0.0% | 0.0% |
| schedule-002 | 明日の十五時にミーティングを入れてください | 明日の**15時**にミーティングを入れてください。 | 9.5% | 0.0% | 0.0% |
| domain-001 | デシベルとサンプリングレートの設定を確認してください | デシベルとサンプリングレートの設定を確認してください。 | 0.0% | 0.0% | 0.0% |
| filler-001 | えーっと、ホットコーヒーをですね、一杯ください | ホットコーヒーをですね、**いっぱい**ください。 | 38.1% | 38.1% | 28.6% |
| **平均** | | | **7.9%** | **6.3%** | **4.8%** |

### 読みどころ(記事のキー)
- **正規化ルールで CER は大きく動く**。同じ認識結果でも平均 7.9% → 4.8% に変わる。
  数値の表記(`十五時` vs `15時`)と句読点・フィラーの扱いを**明文化しないと CER は比較できない**。
- `schedule-002`: AmiVoice は数詞を**算用数字**で返す(`十五時`→`15時`)。
  `normalizeDigits` を入れると CER 9.5%→0%。**正解側の表記を ASR 出力に寄せる**ルールが要る。
- `filler-001`: `えーっと` は AmiVoice が**自動的に落とす**(`keepFillerToken` 既定オフ)。
  さらに `一杯`→`いっぱい`(かな化)。フィラー除去しても CER 28.6% が残るのはこのかな化が主因。

---

## B. ASR → LLM 抽出 の誤り伝播(実 LLM)

**条件**: 上記Aの認識結果 → Claude `claude-haiku-4-5` で構造化抽出 → LLM-as-judge
**再生成**: `npx tsx scripts/measure-real.ts`(`eval/out/real.json` に全文)

| ケース | CER | judge一致 | 抽出されたアクション | 備考 |
|---|---|---|---|---|
| order-001 | 0% | ✓ | `{intent:order, item:ホットコーヒー, quantity:1}` | |
| order-002 | 0% | ✓ | `{intent:order, item:アイスカフェラテ, quantity:2, modifiers:[ラージ]}` | |
| schedule-001 | 0% | ✓ | `{intent:schedule, item:定例会議, datetime:来週の月曜日}` | |
| schedule-002 | 0%※ | ✓ | `{intent:schedule, datetime:明日の15時}` | ※digits正規化後 |
| domain-001 | 0% | ✗ | `{intent:query, item:デシベルと…}` | **正解ラベルが曖昧**(下記) |
| filler-001 | 28.6% | ✗ | `{intent:order, item:ホットコーヒー, quantity:null, modifiers:[いっぱい]}` | **ASR誤りが伝播** |

判定一致率: **66.7% (4/6)**

### キラーコンテンツ:`filler-001` の誤り伝播
- ASR が `一杯`→`いっぱい`(かな化)した結果、LLM は**数量を取り違えた**:
  期待 `quantity:1` → 実際 `quantity:null, modifiers:["いっぱい"]`。
- **ASR の 1 トークンの揺れが、下流の構造化フィールド欠落に直結する**ことを定量的に示せた。
  → 記事の主張「ASRだけ・LLMだけのテストでは捕まらない。**パイプライン全体の回帰テスト**が要る」の実例。

### 副産物:LLM-as-judge が「曖昧な正解」を炙り出す(`domain-001`)
- ASR は完璧(CER 0%)だが judge は不一致。原因は**正解ラベル設計**:
  「設定を確認してください」を期待 `schedule` としたが、LLM は `query` と解釈。後者の方が妥当。
- 教訓: **期待値(ground truth)の品質も回帰テストの対象**。judge の不一致はバグだけでなく
  「正解の曖昧さ」も検出する。zod スキーマ検証(形)+ LLM-judge(意味)の二段が効く所以。

---

## C. ASR 劣化ストレステスト(決定的シミュレータ)

clean 合成音声では汎用エンジンが強すぎて劣化条件を観測できない。**ノイズ重畳・話速変更を
ffmpeg で作る前段**(`scripts/augment-audio.sh`)が未導入(本環境に ffmpeg 無し)のため、
劣化条件は**決定的 ASR 誤りシミュレータ**(`src/eval/asr-sim.ts`)で代替し、ハーネスの
集計・伝播分析ロジックを検証した。実音声+ノイズでの再測は ffmpeg 導入後の追試項目。

**条件**: simulated ASR / rule-based 抽出 / 6ケース × エンジン2 × 辞書2 × SNR4 × 話速3 = 288行
**再生成**: `npm run eval`(`eval/out/eval-full.json`)

### C-1. SNR別 CER(汎用・辞書なし)
| SNR | micro CER |
|---|---|
| clean | 5.5% |
| 20dB | 7.5% |
| 10dB | 14.2% |
| 5dB | 22.9% |

### C-2. エンジン比較 / 辞書 before-after(シミュレータのモデル上)
| 区分 | micro CER | judge一致率 |
|---|---|---|
| 汎用エンジン | 10.9% | 86.1% |
| 特化エンジン | 7.3% | 88.2% |
| 辞書なし(tech×汎用) | 27.0% | 83.3% |
| 辞書あり(tech×汎用) | 12.3% | 83.3% |

### C-3. 誤り伝播(CER帯 → judge一致率)※シミュレータでも単調劣化を再現
| CER帯 | 行数 | judge一致率 |
|---|---|---|
| 0%(誤りなし) | 110 | 100.0% |
| 0–10% | 83 | 86.7% |
| 10–25% | 80 | 77.5% |
| >25% | 15 | 46.7% |

> CER が上がるほど judge 一致率が単調に下がる。実測B(filler-001)と同じ傾向。

---

## D. Playwright fake audio:WAVフォーマット行列

**条件**: Chromium(Playwright 1.60)/ `--use-file-for-fake-audio-capture` /
getUserMedia → AnalyserNode で peak RMS 実測 / headless
**再生成**: `E2E_FIXTURE_WAV=<file> npx playwright test fake-audio-format`

| フィクスチャ | レート/ch | 取り込み(peak RMS) | 判定 |
|---|---|---|---|
| hello_16k_mono.wav | 16kHz / mono | 0.565 | ✅ 取り込みOK |
| hello_8k_mono.wav | 8kHz / mono | 0.388 | ✅ 取り込みOK |
| hello_44k_mono.wav | 44.1kHz / mono | 0.515 | ✅ 取り込みOK |
| hello_16k_stereo.wav | 16kHz / stereo | 0.373 | ✅ 取り込みOK |

### 読みどころ
- Chromium の fake capture は **WAV のレート/チャンネルを内部でリサンプル**する。
  8k/44.1k/stereo いずれも無音にならず取り込まれた(= ブラウザ側のフォーマット要件は緩い)。
- **厳しいのは AmiVoice 側**(`lsb16k` = 16kHz/16bit/mono)。
  したがって変換責務は「ブラウザ取り込み」ではなく「サーバ/クライアントが WS へ送る PCM」にある。
  本PoCは WebAudio で 16kHz mono にダウンサンプルしてから `p` フレーム送信(`app/src/amivoice-ws-client.ts`)。

---

## E. ペアワイズ設計の件数削減

**条件**: 因子6(速度3 × SNR4 × ドメイン用語2 × フィラー2 × エンジン2 × 辞書2)
**再生成**: `npm run pairwise`(`eval/out/pairwise.json`)

| 指標 | 値 |
|---|---|
| 全組み合わせ | **192** |
| ペアワイズ(2因子網羅) | **12** |
| 削減率 | **6.2%**(1/16以下) |
| 2因子ペア網羅 | 92/92(**100%**, 検証済み) |

> 全数192を12ケースに圧縮。CIのスモークはこの12を回し、フルは夜間。

---

## F. E2E 実行時間(参考)

**条件**: ローカル Windows 11 / Chromium headless / mock ASR
| スイート | テスト数 | 所要 |
|---|---|---|
| voice-input.spec.ts | 3 | 約9秒(webServer起動込み) |
| fake-audio-format.spec.ts | 1 | 約8秒 |

> mock ASR モードのため AmiVoice クーポンを消費しない。CIはこの構成で緑を維持。

---

## 測定環境
- OS: Windows 11 Pro / Node v22.21.1 / Python 3.13
- AmiVoice: `-a-general`(汎用)、HTTP同期 & WebSocket 双方で同一結果を確認
- LLM: Anthropic `claude-haiku-4-5`(構造化抽出 tool use + LLM-as-judge)
- TTS: SAPI Microsoft Haruka(ja-JP)。ffmpeg/VOICEVOX 不使用(Nodeリサンプラで16k化)
