# 改善点の調査結果（gofile-jd2 v0.7.1）

## 1. 概要

- GoFile（gofile.io）のページにツールバーを追加し、表示中のフォルダ・選択項目・貼り付けた URL を Click'n'Load（`/flashgot`）で JDownloader 2 へ送る Tampermonkey / Violentmonkey 用ユーザースクリプト。
- 本体は `gofile-jd2.user.js`（418 行）の 1 ファイルのみ。エントリポイントは末尾の `boot()` → `start()`。`document-start` で `Object.prototype.loadSeq` にセッターを仕掛け、GoFile の FileManager を捕まえて表示中フォルダと選択状態を読む。
- UI は GoFile 自身の ES モジュール（`/js/ui/menu.js`・`popup.js`・`toast.js`）と Tailwind のクラスを流用している。
- その他のファイル：README.md（56 行）、THIRD_PARTY_NOTICES.md、LICENSE、.gitignore。外部パッケージ・ビルド・テストはなし。

**調査範囲**：追跡されている全ファイル（上記 5 ファイル）。git 履歴は、秘密情報が含まれていないかの確認にだけ使いました。GoFile 側のページ・モジュールの実物は見ていないので、GoFile の内部仕様に関わる指摘は、コードとコメントから読み取れる範囲での判断です。

**実行したコマンド**（読み取りのみ）

```
git ls-files / ls -la / wc -l      # 構成と規模の把握
node --check gofile-jd2.user.js    # 構文チェック（OK）
git log -p --all | grep -iE '...'  # APIキー・パスワード等のコミット有無の確認
```

## 2. 一覧表

| ID | 観点 | 概要（1行） | 該当箇所 | 効果 | 作業量 | 確認レベル |
|---|---|---|---|---|---|---|
| A-1 | バグ | モジュール読込失敗時は TM メニューも登録されず、案内している代替手段が使えない | gofile-jd2.user.js `start` / `boot` L167-176, L403-406, L412-415 / README L40-47 | 高 | 中 | コード確認 |
| A-2 | バグ | 貼り付けた `#file=` 付き URL がフォルダ全体として送られる／1 単語の行を ID と誤認 | gofile-jd2.user.js `parseContentIds` L95-103 | 中 | 小 | コード確認 |
| A-3 | バグ | 設定画面の接続テスト・保存が popup の同期描画に依存している | gofile-jd2.user.js `openSettings` L289, L299-309 | 中 | 小 | 推測 |
| A-4 | バグ | 送る URL の組み立てで、コード欠落や単一ファイル表示の URL 形式を確認していない | gofile-jd2.user.js `runCurrent` L207-209 | 低 | 小 | 推測 |
| B-1 | 設計 | GoFile の内部状態の読み取りが `start` 内の各所に散らばっている | gofile-jd2.user.js `currentChildren` / `runCurrent` / `buildBar` / `mountBar` | 中 | 中 | コード確認 |
| B-2 | 設計 | `rootCode`・`mode === 'all'` の命名が実際の意味と合っていない | gofile-jd2.user.js `runCurrent` L204-219, `buildBar` L352 | 低 | 小 | コード確認 |
| B-3 | 設計 | 設定キーと既定値が読み出しと保存に分かれて重複している | gofile-jd2.user.js L85-88, `openSettings` L290-292 | 低 | 小 | コード確認 |
| C-1 | パフォーマンス | ページ全体の DOM 変更のたびに `mountBar` が同期実行される | gofile-jd2.user.js `start` L408, `mountBar` L384-400 | 低 | 小 | コード確認 |
| D-1 | UI/UX | 送信中・接続テスト中の表示がなく、二重送信でき、タイムアウトの原因が分からない | gofile-jd2.user.js `send` L180-193, `gmRequest` L115-128, `openSettings` L301-308 | 中 | 小 | 推測 |
| D-2 | UI/UX | Click'n'Load アドレスを検証せず保存するため、誤入力時のエラー文が的外れになる | gofile-jd2.user.js `openSettings` L290, `gmRequest` L124 | 低 | 小 | コード確認 |
| D-3 | UI/UX | 警告バナーに role がなく、ポップアップは Enter で確定できない | gofile-jd2.user.js `showBanner` L55-80, `runUrls` / `openSettings` | 低 | 小 | コード確認 |
| E-1 | ドキュメント | GoFile への依存点と仕様変更時の調べ方の保守メモがない | README.md（該当節なし） | 低 | 小 | コード確認 |
| E-2 | ドキュメント | 別の PC の JD2 へ送るときに JD2 側で必要な設定が書かれていない | README.md L15, L23 | 低 | 小 | 推測 |
| F-1 | 依存関係 | FileManager を捕まえた後の仕様変更（status 値・セレクタ等）は無言で失敗する | gofile-jd2.user.js `mountBar` L384-400, `watchHook` L370-382 | 中 | 小 | コード確認 |
| F-2 | 依存関係 | 自前の UI が、GoFile の CSS に存在するとは限らない Tailwind クラスに依存している | gofile-jd2.user.js `buildBar` L333-334, `openSettings` L281, `ICON` L315-316 | 低 | 小 | 推測 |
| F-3 | 開発環境 | lint・formatter の設定がない | リポジトリ直下 | 低 | 小 | コード確認 |

## 3. 詳細

### A. バグ・不具合

#### A-1 モジュール読込失敗時は TM メニューも登録されず、案内している代替手段が使えない

- **内容**：GoFile の UI モジュールの `import` に失敗すると `start()` が例外で終わる。Tampermonkey メニューの登録（`GM_registerMenuCommand`）は `start()` の終盤にあるので、このときはメニュー自体が出ない。そもそも `runUrls` / `openSettings` / `send` は GoFile の `popup`・`toast` に依存しているので、登録できたとしても動かない。それなのに README の「警告表示」節には、モジュールを読み込めない場合も含めて「このときも『URL を指定して送る』（Tampermonkey のメニュー）は使えます」と書いてある。GoFile の仕様変更でいちばん起こりやすい壊れ方のときに、用意したはずの逃げ道がない状態です。
- **該当箇所**：`gofile-jd2.user.js` `start` L167-176（import と関数の存在チェック）、L403-406（メニュー登録）、`boot` L412-415／`README.md` L40-47
- **根拠コード**：
  ```js
  const [{ openMenu }, { popup }, { toast }] = await Promise.all([mod('/js/ui/menu.js'), mod('/js/ui/popup.js'), mod('/js/ui/toast.js')]);
  ...
  if (missing.length) throw new Error(`見つからない関数: ${missing.join(', ')}`);
  ...
  // Tampermonkey のメニューからも呼べるようにする（フォルダページ以外でも使える）
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('URL を指定して JDownloader 2 へ送る', runUrls);
  ```
  ```md
  - GoFile の内部モジュールを読み込めない
  - ページのファイル管理部分を取得できない

  このときも「URL を指定して送る」（Tampermonkey のメニュー）は使えます。
  ```
- **修正案**：メニュー登録を `start()` より前（トップレベル）に移す。モジュールを読み込めなかったときは、素の DOM で最低限の代替を出す（`prompt()` で URL を受け取って `jdAdd` に渡し、結果は `showBanner` か `alert` で示す）。設定も同じように `prompt()` で代替する。代替まで作らない場合でも、README L47 と起動失敗バナーの文言を実態に合わせる（モジュールが読めないときは使えない、と書く）。
- **効果の理由**：GoFile の更新で壊れたとき、スクリプトを直すまで JD2 へ送る手段がなくなる。日常的に使うツールなので、この状態の影響が最も大きい。
- **動作確認方法**：`mod()` に渡すパスを一時的に存在しないもの（例 `/js/ui/menu_x.js`）に変えて読み込み、赤いバナーが出ること、Tampermonkey のメニューに項目があること、そこから URL を送れることを確かめる。
- **依存関係**：E-1（README の保守メモ）に壊れ方の一覧を書く場合は、この修正の結果に合わせる。

#### A-2 貼り付けた `#file=` 付き URL がフォルダ全体として送られる／1 単語の行を ID と誤認

- **内容**：`parseContentIds` は `/d/` の後のコードだけを取り出して `gofileUrl(code)` に組み直す。そのため `https://gofile.io/d/abc#file=xyz` のような個別ファイルの URL（このスクリプト自身が「選択した項目」で作る形式）を貼ると、`#file=` が落ちてフォルダ全体が送られる。また、URL を含まない行のうち英数字とハイフンだけでできた行はすべて ID とみなすので、メモや単語（`test` など）が混ざると存在しない ID として JD2 に送られる。
- **該当箇所**：`gofile-jd2.user.js` `parseContentIds` L95-103、利用側 `runUrls` L245-249
- **根拠コード**：
  ```js
  const urls = [...line.matchAll(/gofile\.io\/d\/([^/?#\s]+)/gi)].map((m) => m[1]);
  if (urls.length) ids.push(...urls);
  else if (/^\s*[A-Za-z0-9-]+\s*$/.test(line)) ids.push(line.trim());
  ...
  send(ids.map(gofileUrl), pwd);
  ```
- **修正案**：コードではなく URL を返すようにし、`#file=<id>` があれば残す（例：`/gofile\.io\/d\/([^/?#\s]+)(#file=[^\s&]+)?/gi` で 2 つ目のグループも拾い、`gofileUrl(m[1]) + (m[2] ?? '')` を返す）。ID だけの行は、GoFile のコードとしてありうる長さ（例：5 文字以上）に絞るか、少なくとも送る前のトーストに件数を出して気づけるようにする。重複除去は組み立てた URL 単位で行う。
- **効果の理由**：個別ファイルの URL を貼ったときに、意図しない大量ダウンロードが始まる（自動開始がオンの初期設定では確認もなしに始まる）。
- **動作確認方法**：「URL を指定して…」に `https://gofile.io/d/<フォルダ>#file=<ID>` を貼って送り、JD2 のリンクグラバー（自動開始をオフにして確認）にそのファイルだけが入ることを確かめる。`test` だけの行を混ぜたときの挙動も見る。

#### A-3 設定画面の接続テスト・保存が popup の同期描画に依存している

- **内容**：`openSettings` は `popup.open()` の直後に `queueMicrotask` で `document.forms[FORM_ID]` を探し、接続テストボタンにイベントを付けている。GoFile の popup が中身を次のフレームや非同期で描画するようになると、フォームが見つからずにボタンが何も反応しなくなる（`?.` で黙って終わる）。保存ボタン側の `document.forms[FORM_ID].elements` は `?.` がないので、同じ状況では例外になって保存できない。`runUrls` の側は `setTimeout(…, 50)` を使っていて、待ち方も揃っていない。今は動いているので、popup が同期的に描画しているとみられるが、GoFile の実装次第で壊れる。
- **該当箇所**：`gofile-jd2.user.js` `openSettings` L289、L299-309／`runUrls` L254
- **根拠コード**：
  ```js
  queueMicrotask(() => {
    const form = document.forms[FORM_ID];
    form?.querySelector('[data-gm-act="test"]')?.addEventListener('click', async () => {
  ```
  ```js
  onClick: (h) => {
    const els = document.forms[FORM_ID].elements;
  ```
- **修正案**：描画のタイミングに依存しないように、`document` に 1 回だけ委譲リスナーを付ける（`document.addEventListener('click', e => { if (e.target.closest('[data-gm-act="test"]')) … })`）。保存側は、フォームが見つからなければ `toast` でエラーを出して終える。
- **効果の理由**：接続テストは README のセットアップ手順 3 で使う。GoFile の変更で黙って動かなくなると、原因の切り分けがしにくい。
- **動作確認方法**：設定画面で接続テストを押し、JD2 の起動中と停止中でそれぞれ成功・失敗のトーストが出ることを確かめる。

#### A-4 送る URL の組み立てで、コード欠落や単一ファイル表示の URL 形式を確認していない

- **内容**：(1) `rootCode` が `st.folder.code` からも `fm.params?.contentId` からも取れないと、`https://gofile.io/d/undefined` を JD2 に送ってしまう。(2) 単一ファイルの表示では FileManager の状態ではなく `location.href` から `?` と `#` を取り除いた URL を送っている。GoFile が単一ファイルの表示をハッシュやクエリで表す形式なら、そのファイルではなくフォルダ全体が送られる。(2) が実際に起きるかは、GoFile の URL 形式を確認していないので未確認。
- **該当箇所**：`gofile-jd2.user.js` `runCurrent` L207-209
- **根拠コード**：
  ```js
  if (st.fileView) return send([location.href.split(/[?#]/)[0]]);
  const rootCode = st.folder.code ?? fm.params?.contentId;
  if (mode === 'all') return send([gofileUrl(rootCode)]);
  ```
- **修正案**：`rootCode` が取れないときは送らずにエラーのトーストを出す。単一ファイルの表示では、まず GoFile の単一ファイルページの URL 形式を確かめる。`/d/<ファイルのコード>` の形なら今のままでよいが、そうでなければ状態から `${gofileUrl(folderCode)}#file=${fileId}` を組み立てる。
- **効果の理由**：起きるのは GoFile の仕様変更時か特定の URL 形式のときに限られるが、起きれば無意味な送信やフォルダ全体の送信になる。
- **動作確認方法**：単一ファイルのページで「このファイル」を送り、リンクグラバーにそのファイルだけが入ることを確かめる。
- **依存関係**：B-1（状態の読み取りを 1 か所にまとめる）と一緒に直すと楽。

### B. 設計・可読性

#### B-1 GoFile の内部状態の読み取りが `start` 内の各所に散らばっている

- **内容**：`fm.state.folder` / `children` / `contents` / `items` / `selection` / `fileView` / `status`、`fm.destroyed` / `root` / `params.contentId`、子要素の `id` / `type` / `code` といった GoFile 内部のプロパティを、`currentChildren`・`runCurrent`・`buildBar`・`mountBar` がそれぞれ直接読んでいる。`start()` 自体も、UI・送信・設定・ツールバー・監視を一つのクロージャに抱えた約 240 行の関数になっている。
- **該当箇所**：`gofile-jd2.user.js` `currentChildren` L197-202、`runCurrent` L204-219、`buildBar` L345、`mountBar` L387-392
- **根拠コード**：
  ```js
  const sel = fm?.state?.selection?.size ?? 0;                                         // buildBar
  const ready = fm && !fm.destroyed && fm.state?.status === 'ready' && fm.root?.isConnected; // mountBar
  const c = folder?.children ?? folder?.contents ?? {};                                 // currentChildren
  ```
- **修正案**：GoFile 依存の読み取りを `gofile` オブジェクト（例：`isReady()` / `isFileView()` / `currentCode()` / `selectedEntries()` / `entryUrl(entry)`）にまとめ、他の関数はそれだけを使う。ファイルを分ける必要はなく、セクションを分けるだけで十分。
- **効果の理由**：GoFile の仕様変更で直す場所が 1 か所になり、F-1 の検知や A-4 の確認も入れやすくなる。
- **動作確認方法**：リファクタリングの後に、フォルダページ（選択あり／なし）と単一ファイルのページで、メニューの各項目が今まで通りに送れることを確かめる。
- **依存関係**：F-1・A-4 の下準備になる（必須の前提ではない）。

#### B-2 `rootCode`・`mode === 'all'` の命名が実際の意味と合っていない

- **内容**：`rootCode` はルートではなく表示中のフォルダ（サブフォルダの場合もある）のコード。`runCurrent('all')` は、単一ファイルの表示では「このファイル」の意味でも使われている。
- **該当箇所**：`gofile-jd2.user.js` `runCurrent` L208-215、`buildBar` L352
- **根拠コード**：
  ```js
  const rootCode = st.folder.code ?? fm.params?.contentId;
  ...
  ? [{ label: 'このファイル', icon: 'file', onClick: () => runCurrent('all') }]
  ```
- **修正案**：`rootCode` → `folderCode` に改名する。モードは `'folder' | 'selected' | 'file'` に分けるか、関数を `sendCurrentFolder` / `sendSelected` / `sendCurrentFile` に分ける。
- **効果の理由**：あとで読み返したときに、「サブフォルダで選んだファイルがどのフォルダ URL で送られるか」を誤解しにくくなる。
- **動作確認方法**：B-1 と同じ。

#### B-3 設定キーと既定値が読み出しと保存に分かれて重複している

- **内容**：`'cfg.jdUrl'` などのキー文字列と既定値が、読み出し用の関数（L86-88）と保存処理（L290-292）に別々に書かれている。設定を 1 つ足すたびに 3 か所（読み出し・フォーム・保存）を揃える必要がある。
- **該当箇所**：`gofile-jd2.user.js` L85-88、`openSettings` L290-292
- **根拠コード**：
  ```js
  const jdUrlSetting = () => GM_getValue('cfg.jdUrl') ?? DEFAULT_JD_URL;
  ...
  GM_setValue('cfg.jdUrl', els.jdUrl.value.trim() || DEFAULT_JD_URL);
  ```
- **修正案**：`const CFG = { jdUrl: { key: 'cfg.jdUrl', def: DEFAULT_JD_URL }, … }` と `getCfg(name)` / `setCfg(name, v)` にまとめる。
- **効果の理由**：設定項目が 3 つのうちは小さいが、増やすときの書き漏れを防げる。
- **動作確認方法**：設定を変えて保存し、再読み込みしても値が残っていること、送信時に反映されることを確かめる。

### C. パフォーマンス

#### C-1 ページ全体の DOM 変更のたびに `mountBar` が同期実行される

- **内容**：`document.documentElement` の subtree 全体を見る MutationObserver が、変更のたびに `mountBar` を呼ぶ。その中で `querySelector('#fm-root')` などが毎回走る。一つひとつは軽いが、ファイル数の多いフォルダの描画やサムネイルの読み込み、トーストの表示など、ツールバーと関係のない変更でも毎回動く。バーの挿入自体も次の呼び出しを引き起こす。利用者 1 人の想定規模では、体感できる差はおそらくない。
- **該当箇所**：`gofile-jd2.user.js` `start` L408、`mountBar` L384-400
- **根拠コード**：
  ```js
  new MutationObserver(mountBar).observe(document.documentElement, { childList: true, subtree: true });
  ```
- **修正案**：`requestAnimationFrame` で 1 フレームに 1 回にまとめる（`let queued; const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; mountBar(); }); } };`）。
- **効果の理由**：大きなフォルダを開いたときの余計な処理が減る。ただし、今問題になっているわけではない。
- **動作確認方法**：ファイル数の多いフォルダとサブフォルダの間を行き来して、ツールバーが毎回正しく出直すことを確かめる。

その他、通信（送信 1 回につき 1 リクエスト）やモジュールの読み込み（起動時に 3 つを並列で 1 回）に無駄は見つからなかった。

### D. 使い勝手（UI/UX）

※ いずれも実際には操作しておらず、コードから判断したものです。

#### D-1 送信中・接続テスト中の表示がなく、二重送信でき、タイムアウトの原因が分からない

- **内容**：送信や接続テストを押してから結果のトーストが出るまで（最大 15 秒）、画面に何の変化もない。その間にもう一度押せば同じ内容を再送する。また、初回の送信では JD2 に許可ダイアログが出る（README L38）。JD2 がダイアログへの応答を待ってから HTTP 応答を返すとすると、15 秒以内に「許可」を押さなければ「タイムアウト」とだけ表示される。実際には許可後にリンクが追加されるので、失敗と思って再送することになる（JD2 側の挙動は未確認）。
- **該当箇所**：`gofile-jd2.user.js` `send` L180-193、`gmRequest` L122-125、`openSettings` L301-308
- **根拠コード**：
  ```js
  timeout: 15000,
  ...
  ontimeout: () => reject(new Error('タイムアウト')),
  ```
  ```js
  async function send(urls, password) {
    try {
      await jdAdd(urls, password);
  ```
- **修正案**：`send` の冒頭で「JDownloader 2 へ送信中…」のトーストを出し、送信中は再入を防ぐフラグを立てる。接続テストのボタンは実行中だけ `disabled` にして文言を「確認中…」にする。タイムアウトの文言は「JD2 から応答がありません。JD2 に許可の確認が出ていないか見てください」のように、次にとる行動が分かるものにする。送信だけタイムアウトを長く（例 60 秒）するのもよい。
- **効果の理由**：毎回の送信で「押せたか」が分かるようになり、初回の許可ダイアログでの誤った再送も防げる。
- **動作確認方法**：JD2 の許可記録を消して（または別のブラウザプロファイルで）初回の送信を行い、ダイアログに 15 秒以上応答しないときの表示を見る。送信ボタンを連打して、1 回しか送られないことを確かめる。

#### D-2 Click'n'Load アドレスを検証せず保存するため、誤入力時のエラー文が的外れになる

- **内容**：`127.0.0.1:9666` のようにスキームのないアドレスや、タイプミスを含むアドレスもそのまま保存される。送信時は `onerror` で一律に「接続できません（JDownloader 2 は起動していますか？）」と出るので、設定の誤りに気づきにくい。
- **該当箇所**：`gofile-jd2.user.js` `openSettings` L290、`gmRequest` L124
- **根拠コード**：
  ```js
  GM_setValue('cfg.jdUrl', els.jdUrl.value.trim() || DEFAULT_JD_URL);
  ```
- **修正案**：保存時に `new URL(v)` で解釈できるか、プロトコルが `http:` / `https:` かを確かめる。スキームがなければ `http://` を補うか、エラーを出して保存しない。
- **効果の理由**：設定を変えるのはまれだが、変えたときの切り分けが楽になる。
- **動作確認方法**：`127.0.0.1:9666` と入力して保存したときに、補完されるかエラーになることを確かめる。

#### D-3 警告バナーに role がなく、ポップアップは Enter で確定できない

- **内容**：(1) 警告バナーには `role="alert"` がなく、閉じるボタンも `aria-label` がなく「×」だけなので、読み上げでは意味が伝わりにくい（ツールバーのボタンには `aria-label` が付いている）。(2) 設定画面はフォームの submit を `return false` で止めていて、「URL を指定して…」にもキーボードで確定する手段がない。そのため、入力後に毎回マウスで「保存」や「送る」を押す必要がある。
- **該当箇所**：`gofile-jd2.user.js` `showBanner` L58-74、`openSettings` L264、`runUrls` L229-237
- **根拠コード**：
  ```js
  close.textContent = '×';
  close.title = '閉じる';
  ```
  ```html
  <form id="${FORM_ID}" class="space-y-4" onsubmit="return false">
  ```
- **修正案**：バナーに `box.setAttribute('role', 'alert')`、閉じるボタンに `aria-label="閉じる"` を付ける。設定画面のテキスト欄では Enter、URL の textarea では Ctrl+Enter で、それぞれ保存・送信と同じ処理を呼ぶ。
- **効果の理由**：小さいが、URL を貼ってすぐ送るという日常の操作が少し速くなる。
- **動作確認方法**：URL 欄に貼って Ctrl+Enter で送れること、設定の欄で Enter を押すと保存されることを確かめる。

### E. ドキュメント

README の概要・インストール手順・設定・使い方は、コードの動作（`/flashgot` への送信、`autostart`、`<jd:packagename>` の付加、`#file=` の形式）と一致していることを確認しました。ただし「警告表示」節（L40-47）の記述は実態と食い違っていて、これは A-1 にまとめています。

#### E-1 GoFile への依存点と仕様変更時の調べ方の保守メモがない

- **内容**：GoFile の仕様変更で壊れたときに見るべき依存点が、コード中のコメントに一部書かれているだけで、一覧になっていない。依存点は、`loadSeq` フックの前提（コンストラクタ内で `this.loadSeq = 0` と代入していること。クラスフィールド構文 `loadSeq = 0;` に変わるとセッターを通らなくなる）、使っている `state` のプロパティ名、`#fm-root` / `#fm-toolbar`、3 つの UI モジュールのパスと引数の形（`popup.open({title,size,content,actions})`、`toast(msg,{type})`、`openMenu({anchor,placement,items})`）、メニューのアイコン名（`file` / `list-checks` / `folder-tree` / `link`）。
- **該当箇所**：README.md（該当する節なし）、`gofile-jd2.user.js` L33-50 のコメント
- **根拠コード**：
  ```js
  // FileManager のコンストラクタが `this.loadSeq = 0` を代入した瞬間に拾う。
  ...
  if (this && this.state && this.root && 'selection' in this.state) fm = this;
  ```
- **修正案**：README の末尾（または `.user.js` の冒頭のコメント）に「GoFile への依存点」という短い節を作り、上の一覧と、壊れたときの確認手順（DevTools で `/js/ui/*.js` の export を見る、FileManager のコンストラクタを検索する、など）を書く。
- **効果の理由**：数か月後に GoFile の変更で壊れたとき、どこから調べればよいかがすぐ分かる。
- **動作確認方法**：文書だけの変更なので、記載したプロパティ名やセレクタがコードと一致しているかを読んで確かめる。
- **依存関係**：B-1 で依存をまとめた場合は、そのまとめた場所を指すように書く。A-1 の修正後の動作に合わせる。

#### E-2 別の PC の JD2 へ送るときに JD2 側で必要な設定が書かれていない

- **内容**：README は「JD2 を別のポートや別の PC で動かしているときは、ここでアドレスを変えます」とだけ書いている。JD2 の Click'n'Load は、初期設定ではローカルホストからの接続しか受け付けない（高度な設定の `RemoteAPI: Extern Interface Localhost Only` 相当）と思われ、アドレスを変えるだけではつながらない可能性が高い（JD2 側は未確認）。
- **該当箇所**：README.md L15、L23
- **根拠コード**：
  ```md
  JD2 を別のポートや別の PC で動かしているときは、ここでアドレスを変えます。
  ```
- **修正案**：別の PC で使う場合に JD2 側で必要な設定を確かめ、1 行追記する。使う予定がなければ「同じ PC で動かす前提」と書いてもよい。
- **効果の理由**：今は同じ PC で使う前提とみられるので、効果は小さい。
- **動作確認方法**：別の PC の JD2 に対して接続テストを行い、記載どおりの設定でつながることを確かめる。

### F. 依存関係・開発環境

**メタデータの確認結果（特になし）**：`@grant` の 5 つ（`GM_getValue` / `GM_setValue` / `GM_xmlhttpRequest` / `GM_registerMenuCommand` / `unsafeWindow`）はすべて使われていて、使っていないのに宣言されているものも、使っているのに宣言されていないものもない。`@connect` は、localhost と 127.0.0.1 を列挙して確認なしで接続できるようにし、`*` で別の PC のアドレスも（Tampermonkey の確認を経て）使えるようにしているので、用途に対して必要十分。`@run-at document-start` は `loadSeq` フックに必須。`@match https://gofile.io/*` も用途に合っている。

**GoFile への依存箇所**（仕様変更で壊れやすい順）：

1. `Object.prototype.loadSeq` フックと FileManager の判定条件（L41-50）：コンストラクタ内での代入とプロパティ名に依存。壊れたときは `watchHook` が 10 秒後に警告する。
2. `fm.state` の各プロパティ（`status === 'ready'`、`selection` が Set、`folder.children`/`contents`、`fileView`、`folder.code`、子要素の `id`/`type`/`code`）：壊れても検知されない（F-1）。
3. DOM のセレクタ `#fm-root` / `#fm-toolbar`（L371、L395）：壊れても検知されない（F-1）。
4. UI モジュール `/js/ui/menu.js`・`popup.js`・`toast.js` のパスと export 名（L172-176）：検知される（ただし A-1）。引数の形（`actions`、`h.close()`、`items` の書式、アイコン名）の変化は検知されない。
5. GoFile の Tailwind クラス・`input` / `panel` / `icon-btn` / `btn-secondary`（F-2）：見た目だけの問題。

#### F-1 FileManager を捕まえた後の仕様変更（status 値・セレクタ等）は無言で失敗する

- **内容**：警告が出るのは「モジュールを読み込めない」と「FileManager を捕まえられない」の 2 つだけ。FileManager は捕まえられても、`state.status` の値が `'ready'` 以外に変わった場合や、`#fm-toolbar` / `#fm-root` の ID が変わった場合は、`mountBar` が黙って `return` し、ツールバーが出なくなるだけになる。利用者からは、スクリプトが壊れたのか読み込み中なのかの区別がつかない。
- **該当箇所**：`gofile-jd2.user.js` `mountBar` L384-400、`watchHook` L370-382
- **根拠コード**：
  ```js
  const ready = fm && !fm.destroyed && fm.state?.status === 'ready' && fm.root?.isConnected;
  if (!ready) {
    existing?.remove();
    return;
  }
  ...
  const target = fileView ? document.querySelector('#fm-root') : document.querySelector('#fm-toolbar');
  if (!target) return;
  ```
- **修正案**：`watchHook` の 10 秒タイマーの判定を「`fm` がない」から「ツールバーを置けていない（`!document.getElementById(BAR_ID)`）」に広げる。警告文には、どの条件で止まったか（`fm` なし／`status=…`／`#fm-toolbar` なし）を入れる。
- **効果の理由**：GoFile の変更でツールバーが消えたとき、すぐに「仕様変更だ」と分かり、どこが変わったかの手がかりも得られる。
- **動作確認方法**：一時的に `'#fm-toolbar'` を存在しないセレクタに変えて読み込み、10 秒後に原因つきの警告が出ることを確かめる。
- **依存関係**：B-1 をやると判定を 1 か所に書けるが、単独でも直せる。

#### F-2 自前の UI が、GoFile の CSS に存在するとは限らない Tailwind クラスに依存している

- **内容**：ツールバーや設定画面は GoFile の Tailwind クラスで見た目を作っている。Tailwind はサイトのソースで使われているクラスしか CSS を生成しないので、GoFile 自身が使っていないクラス（`border-sky-500`、`hover:bg-sky-500/10`、`max-w-3xl`、`size-5` など）は効かない可能性があり、GoFile の更新で突然効かなくなる可能性もある。実際に効いているかは未確認。
- **該当箇所**：`gofile-jd2.user.js` `buildBar` L333-334、`openSettings` L281、`ICON` L315-316
- **根拠コード**：
  ```html
  <button type="button" data-gm-act="test" class="w-full rounded-lg border border-sky-500 px-3 py-2 text-sky-400 hover:bg-sky-500/10">接続テスト</button>
  ```
- **修正案**：レイアウトに関わる最低限（アイコンのサイズ、接続テストボタンの枠）は、`style` 属性か、スクリプトで注入する小さな `<style>`（`#gm-jd-bar …` のように範囲を絞る）で指定する。色などは GoFile のクラスのままでよい。
- **効果の理由**：見た目だけの問題で、送信の機能には影響しない。
- **動作確認方法**：DevTools で接続テストボタンとアイコンを調べ、上のクラスが実際に効いているかを確かめる。

#### F-3 lint・formatter の設定がない

- **内容**：ESLint や Prettier などの設定がない。コードのスタイル自体は揃っている（2 スペースのインデント、シングルクォート、末尾カンマ）。`.gitignore`（`*.log`、`node_modules/`、OS のゴミファイル）は、外部パッケージのない今の構成では十分。
- **該当箇所**：リポジトリ直下
- **根拠コード**：なし（ファイルがないこと自体が根拠）
- **修正案**：ツールを導入するなら、`package.json` なしで `npx eslint`（flat config で `globals: { GM_getValue: 'readonly', … }` を宣言）と `npx prettier --check` を使う程度でよい。最低限なら、編集後に `node --check gofile-jd2.user.js` で構文を確かめる習慣だけでも足りる。
- **効果の理由**：1 人用の 400 行なので効果は小さい。未定義の変数や使われていない変数を機械的に見つけられる程度。
- **動作確認方法**：`npx eslint gofile-jd2.user.js` がエラーなしで終わることを確かめる。

## 4. おすすめの着手順（5 件）

1. **A-1**：唯一の効果「高」。GoFile が壊れたときに JD2 へ送る手段を残せるかどうかに関わり、README の誤りもあわせて直せる。
2. **A-2**：効果「中」・作業量「小」。自動開始がオンの初期設定では、ファイル 1 つのつもりがフォルダ全体のダウンロードになりうる。
3. **D-1**：効果「中」・作業量「小」。毎回の送信で「押せたか」が分かり、初回の許可ダイアログでの誤った再送も防げる。
4. **F-1**：効果「中」・作業量「小」。GoFile の変更でツールバーが消えたときに、原因がすぐ分かるようになる。
5. **A-3**：効果「中」・作業量「小」。設定画面の接続テストと保存を、GoFile の popup の描画タイミングに左右されないようにする。

（B-1 は効果「中」・作業量「中」で、F-1・A-4 の下準備になるが必須の前提ではないため、上の 5 件の後に回してよい。）

## 5. 対象外だが要注意

該当なし（現在のファイルと git 履歴の全体を確認し、API キー・パスワード・個人情報がコミットされていないことを確かめた。履歴にある `rpcSecret` / `accountToken` は設定値やクッキーを読み出すコードで、値そのものではない）。
