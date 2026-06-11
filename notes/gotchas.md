# ハマったポイント(時系列メモ)

> エラーメッセージは原文。記事の「ハマったポイント」素材。原因と回避策をセットで。

---

## 1. AmiVoice HTTP同期:multipart の `u`/`d`/`a` フィールドと grammarFileNames

**症状**: パラメータ名を取り違えると認証や認識条件が通らない。競合記事(gen99氏)も `a`
パラメータで躓いたと言及。

**事実(一次確認)**:
- multipart/form-data の3フィールド:
  - `u` = APPKEY(認証)
  - `d` = 認識条件の文字列(`grammarFileNames=-a-general` を含む `key=value` 連結)
  - `a` = **音声ファイル本体**
- 罠は「`a`(音声フィールド)」と「エンジン名 `-a-general`(先頭が `a-`)」が紛らわしいこと。
  エンジン指定は `a` ではなく `d` の中の `grammarFileNames`。
- WebSocket では `s <audioFormat> <grammarFileNames> authorization=<APPKEY> ...` の
  start コマンド1行に集約される(`src/amivoice/types.ts: buildStartCommand`)。

**回避策**: フィールドの役割をコード内コメントに明記し、両IFで同じ `grammarFileNames` を渡す
ヘルパに統一(`src/amivoice/http-sync.ts`, `ws-node.ts`)。

**結果**: `-a-general` で HTTP同期・WebSocket とも一発認識成功。両IFで**同一テキスト**を確認:
`ホットコーヒーを一杯ください。`

---

## 2. AmiVoice は数詞を算用数字で返す(`十五時` → `15時`)

**症状**: 正解 `明日の十五時に…` に対し認識 `明日の15時に…`。文字一致で CER 9.5%。

**原因**: ASR の数詞正規化。**誤りではない**が、正解側の表記と食い違うと CER に出る。

**回避策**: CER 正規化に `normalizeDigits`(漢数字↔算用数字を寄せる)を用意し、
プリセットで CER 感度を比較(`src/eval/normalize.ts`)。これで 9.5%→0%。

**教訓**: 日本語 CER は**正規化ルールの明文化が必須**。ルール次第で平均 7.9%→4.8% も動く(results.md A)。

---

## 3. AmiVoice はフィラーを既定で落とす + かな化が残差になる

**症状**: 正解 `えーっと、ホットコーヒーをですね、一杯ください` →
認識 `ホットコーヒーをですね、いっぱいください。`
- `えーっと` は消える(`keepFillerToken` 既定オフ)
- `一杯` → `いっぱい`(かな化)で CER 残差

**回避策**: `keepFillerToken=1` でフィラー保持を選べるよう実装。CER 側は `stripFillers`
プリセットでフィラー無視も選べる。ただし `一杯→いっぱい` のかな化はフィラー除去では消えない。

**伝播影響(重要)**: かな化で LLM が `quantity:1` を取りこぼし、`いっぱい` を modifier 扱い。
→ **ASRの1トークンの揺れが下流の構造化フィールド欠落に直結**(results.md B、記事のキラー)。

---

## 4. SAPI(Windows TTS)の出力は 22.05kHz。AmiVoice は 16kHz 必須

**症状**: `System.Speech` で合成した WAV は `rate=22050 bits=16 ch=1`。
AmiVoice `lsb16k` は 16kHz 前提。

**制約**: 本環境に **ffmpeg が無い**(`ffmpeg: command not found`)。

**回避策**: 依存ゼロの Node 製リサンプラを実装(`scripts/resample-wav.ts`、線形補間で
22.05k/24k→16k mono 変換)。`tsx scripts/resample-wav.ts --glob '*.sapi.wav'` で一括。
ffmpeg がある環境では `scripts/convert-wav.sh`(高品質)を使う。

**教訓**: 「TTSの素の出力」と「ASRの要求フォーマット」は一致しない。**変換段を必ず挟む**。
記事の再現性のため、ffmpeg無しでも回る純Node経路を用意した。

---

## 5. Playwright:ボタンの aria-label がアクセシブル名を固定してしまう

**症状**:
```
locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: /停止/ })
```
録音開始後、ボタンの表示テキストは `■ 停止` に変えたのに `getByRole({name:/停止/})` が一致せず。

**原因**: `<button aria-label="録音開始">` を付けていたため、**アクセシブル名は aria-label が優先**。
表示テキストを変えても name は `録音開始` のまま。

**回避策**: 静的な `aria-label` を外し、状態は textContent + `data-state` 属性で表現。
Playwright snapshot で `button "録音開始": ■ 停止`(name と内容が乖離)に気付けた。

---

## 6. Playwright:UI状態の反映が `await` の後だと録音状態が見えない

**症状**: クリック直後に `data-state="recording"` を期待するが、`await client.start()`
(getUserMedia + AudioContext構築)を待ってから更新していたため、テストが状態遷移を捉えられない。

**回避策**: UIは**楽観的更新**(awaitの前に `recording=true` と表示を反映)、失敗時に戻す。
UX的にも即時フィードバックで正しい(`app/src/main.ts: startRecording`)。

---

## 7. CER 正規化が長音符「ー」を消してしまう(`コーヒー`→`コヒ`)

**症状**: ユニットテスト失敗:
```
Expected values to be strictly equal:
'コヒ' !== 'コーヒー'
```

**原因**: 記号除去の文字クラスに**長音符 ー(U+30FC)**を含めてしまった。
ダッシュ類(―, ‐, -)を消すつもりが、語の一部である長音符まで除去。

**回避策**: `ー`(U+30FC)を除去対象から外す。NFKC正規化や半角カナ起因の表記揺れと
混同しやすいので、文字クラスにコメントで明記(`src/eval/normalize.ts`)。

---

## 8. ペアワイズ生成の貪欲法が第1因子を固定してしまう(被覆漏れ)

**症状**: 出力の全行で `速度=0.9`。`(速度=1.0, …)` のペアが未被覆なのに 7 行で停止。

**原因**: 行を空から組むと第1因子は gain=0 で常に先頭水準(0.9)を選ぶ。以降も同様で
特定水準に固着 → 2因子網羅が破綻。

**回避策**: **未被覆ペアを「種(seed)」にして** その2因子を確定させてから残りを貪欲に埋める方式へ。
各反復で必ず1ペア以上カバーするので全網羅で停止。検証スクリプトで 92/92 ペア網羅を確認。
結果、12ケースで全192組合せの2因子を100%被覆。

---

## 9. TypeScript:Node の `Buffer` を `Blob`/`FormData` に入れると型エラー

**症状**:
```
TS2322: Type 'Buffer<ArrayBufferLike>' is not assignable to type 'BlobPart'.
  Type 'SharedArrayBuffer' is not assignable to type 'ArrayBuffer'.
```

**原因**: Node の `Buffer` の backing は `ArrayBufferLike`(SharedArrayBuffer を含みうる)で、
DOM の `BlobPart`(`ArrayBufferView<ArrayBuffer>`)に代入不可。

**回避策**: `new Blob([Uint8Array.from(buffer)], …)` で `Uint8Array<ArrayBuffer>` に正規化。

---

## 10. 環境ツールの不在(ffmpeg / pict / VOICEVOX)

- `ffmpeg: command not found` → 音声変換・拡張は純Node(リサンプラ)+ シェルスクリプト(ffmpeg前提)の二経路。
- `pict: command not found` → PICTモデル(`eval/factors.pict`)を**自前Python**で解釈・生成(`scripts/pairwise.py`)。
- VOICEVOX エンジン未起動(`localhost:50021` 不達)→ SAPI(Haruka)で代替。`scripts/gen-fixtures.ts`
  はエンジン不達時に明示メッセージで停止し、`npm run gen:wav`(合成トーン)へ誘導。

**教訓**: 記事の再現性のため「フル機能(ffmpeg/VOICEVOX/pict)」と「最小依存(Node/Python標準)」の
**両経路**を用意。CI は最小依存だけで緑になる。

---

## 11. Windows のコンソール文字化け(計測には無害)

**症状**: bash 経由 `python` の日本語 stderr が `# ���q��=6` と化ける。`curl -d` の日本語も文字化け。

**原因**: Windows コンソールのコードページと UTF-8 の不一致(出力のみ)。

**回避策**: 数値・判定は**ファイル(JSON / Markdown, UTF-8)出力を正**とし、コンソールは参考。
抽出ロジックの確認は curl ではなく `tsx` スクリプト経由で行い、シェルのエンコード問題を回避。

---

## 12.【重要】AmiVoice は認証失敗でも HTTP 200 を返す(エラーは body の message)

**症状**: 不正な APPKEY で叩いても **HTTP ステータスは 200**。`res.ok` を信じると失敗を見逃す。
実際のレスポンス原文:
```json
{"results":[{"tokens":[],"tags":[],"rulename":"","text":""}],"text":"","code":"-","message":"received illegal service authorization"}
```

**原因**: AmiVoice HTTP同期はアプリ層エラー(認証/パラメータ不正)を **body の `message`** で返す。
しかも `results` は**空配列で存在する**ため、「`!json.results` のときだけ throw」では捕捉できない
(自前コードの初期実装がまさにこのバグで、認証失敗を「無音」として握り潰していた)。

**回避策**: `message` が非空なら必ず例外化する(`src/amivoice/http-sync.ts: normalize`)。
```ts
if (json.message && json.message.trim())
  throw new Error(`AmiVoice error (code=${json.code}): ${json.message}`);
```

**教訓**: 外部ASR APIは「HTTPステータス」ではなく「**body のステータスフィールド**」で
成否判定する。回帰テストの assertion もここを見ること。

---

## 13. 不正入力は「エラー」ではなく「無音(空応答)」に落ちる

**症状**: ゴミバイト列・存在しない grammar 名(`-a-nonexistent-engine`)・0バイトを送っても
例外は出ず、`text:""`(空)が返る。

**回避策**: ハーネス側で「空応答」を**異常として扱うか正常な無音として扱うか**を明示。
本PoCは CER 計測時に空応答を CER=100%(全削除)として扱い、表では「無音」と区別表記。

---

## 14. ユーザー辞書(profileWords)の形式は JSON 配列(当初スペース区切りで失敗)

**症状(当初)**: `profileWords` を「表記 よみ 品詞」「表記\t品詞\tよみ」等のテキストで渡すと
**空応答 or 認証エラー**。

**原因**: profileWords の正しい形式は **JSON 配列**(一次確認、下記リンク):
```json
[{"written":"AMI","spoken":"あみ"},{"written":"躑躅森","spoken":"つつじもり","classname":"名前"}]
```
`written`(表記)/ `spoken`(カタカナ読み)/ 任意 `classname`(クラス)。
profileId と併用すると profileWords が優先。
出典: https://docs.amivoice.com/en/amivoice-api/manual/reference-profilewords/

**さらなる罠**: この JSON を `d` に入れても、**`d` がスペース区切りでないと失敗**する(gotcha#16)。
profileWords の JSON は `JSON.stringify` 既定の**スペースなし**にすること(スペースがあると d 区切りと衝突)。

**測定結果**: 形式・配置を正した上で order-001(10dB/5dB ノイズ)と固有名詞ケース
(躑躅森 / AmiVoice / 造語 ぐるぐるぺん)で before/after を実測したが、**CER 改善は観測されず**:
- ノイズ下: 音響的に `ホットコーヒー`→`パソコンB` と崩れており、単語登録(言語モデル側のバイアス)では復元不能。
- clean: `-a-general` が躑躅森・AmiVoice・造語まで**辞書なしで正解**(改善余地なし)。

**結論**: 辞書の配管は正しく動く(リクエスト成功)が、**今回の条件(明瞭なTTS音声+強力な汎用エンジン)
では可視の改善差を作れなかった**。辞書が効くのは「明瞭だが真にOOVな語/同音衝突」のはずで、
SAPI音声でその条件を作れなかった(タイムボックスで打ち切り)。記事では「効果は条件依存・本検証では
有意差なし」と正確に書く。

---

## 16.【重要】HTTP同期の `d` パラメータは「スペース区切り」key=value(`&`区切り不可)

**症状**: grammarFileNames に加えて profileWords など**2つ目のパラメータ**を `d` に足すと、
`received illegal service authorization`(認証エラー)で**全リクエストが失敗**。1つだけなら成功。

**原因**: `d` を `URLSearchParams`(=`&` 区切り)で組んでいた。AmiVoice の `d` は
**WebSocket の `s` コマンド同様スペース区切り**。`grammarFileNames=-a-general&profileWords=...` だと
`&` 以降が壊れ、AmiVoice はリクエスト全体を不正と見なし**認証エラーを返す**(誤解を招くメッセージ)。
パラメータ1個(`grammarFileNames=-a-general`)のときは区切りが要らず**たまたま動いていた**。

**検証**(同一音声・同一キー):
| d の組み方 | 結果 |
|---|---|
| `grammarFileNames=-a-general profileWords=[...]`(スペース) | ✅ 成功 |
| `grammarFileNames=-a-general&profileWords=[...]`(&) | ❌ illegal service authorization |
| profileWords を別フォームフィールド | ❌ illegal service authorization |

**回避策**: `d` をスペース区切りで自前構築(`src/amivoice/http-sync.ts:buildD`)。
profileWords の JSON はスペースを除去してから入れる。

**教訓**: 「1個だと動くが2個目で壊れる」系は区切り文字の取り違えを疑う。
HTTP同期の `d` と WebSocket の `s` は**同じスペース区切り文法**で統一されている。

---

## 15. ドメイン特化エンジンは無償クーポンで空応答(権限なし)

**症状**: `-a-medgeneral`(医療)・`-a-bizmrreps`・`-a-financegeneral` を指定すると
例外は出ないが**認識結果が空**。`-a-general` / `-a-general-input` は正常。

**原因(推定)**: 無償クーポンの権限範囲。特化エンジンは契約/エントリが別途必要と思われる(未確認)。

**対応**: エンジン比較は利用可能な `-a-general`(会話汎用) vs `-a-general-input`(音声入力向け)で実施。
「汎用 vs ドメイン特化」の実測は**未達**(results.md G の未達項目に記載)。
