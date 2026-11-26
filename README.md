# GoFile → JD2

GoFile のページにツールバーを追加して、GoFile の URL を JDownloader 2（JD2）へ送るユーザースクリプトです。URL のコピーも、JD2 のクリップボード監視も要りません。

- URL は Click'n'Load（JD2 のローカルの受け口。初期値 `http://127.0.0.1:9666`）で渡します。初期設定ではリンクグラバーの確認を飛ばしてそのままダウンロードを開始します（設定で切り替え可）。
- フォルダの中身の取得、サブフォルダ構造の再現、パスワードの入力、重複の検出は JD2 の GoFile プラグインが行います。
- ページ上の UI は gofile-enhanced と同じ方法で作っています（GoFile 自身のメニュー・ポップアップ・トースト通知を使います）。

> v0.3 までは「GoFile → Motrix」（リポジトリ名 gofile-motrix）として、Motrix（aria2 RPC）へ送るスクリプトでした。v0.5 で Motrix 対応を外し、名前を変えています。古い「GoFile → Motrix」は自動では更新されないので、Tampermonkey で削除してから下の手順で入れ直してください。

> [!IMPORTANT]
> GoFile・JDownloader の公式ツールではありません。GoFile の利用規約を守ってお使いください。

## 必要なもの

- [JDownloader 2](https://jdownloader.org/)（JD2）。Click'n'Load は初期設定で有効です。
- Tampermonkey か Violentmonkey を入れたブラウザ

## インストール

1. JDownloader 2 を起動しておきます。
2. [gofile-jd2.user.js](https://raw.githubusercontent.com/Hoyomaru/gofile-jd2/main/gofile-jd2.user.js) を開いてインストールします。
3. GoFile のページでツールバーの ⚙ を開き、「接続テスト」を押して JD2 につながるか確認します。JD2 を別のポートや別の PC で動かしているときは、ここでアドレスを変えます。

### 更新

Tampermonkey / Violentmonkey が自動で更新します。インストール直後や更新直後は、GitHub 側のキャッシュで数分ほど古い版が入ることがあります。そのときは少し待ってから入れ直してください。

## 使い方

ツールバーの「JD2 へ送る」には、次の送り方があります。

- **選択した項目**：一覧でチェックを入れた項目を送ります。フォルダは `https://gofile.io/d/<コード>`、ファイルは `https://gofile.io/d/<フォルダ>#file=<ID>` の形で渡します。
- **このフォルダ全体**：表示中のフォルダの URL を渡します。
- **このファイル**：単一ファイルのページでは、表示中のファイルを渡します。
- **URL を指定して…**：GoFile の URL を複数まとめて貼り付けて送ります（1 行に 1 つ。ID だけでも可）。`…#file=<ID>` 付きの URL はそのファイルだけを送ります。URL として読み取れなかった行は送らずに件数を知らせます。パスワードを入れた場合は一緒に渡します。保存先と開始方法もここで選べます。URL 欄で Ctrl+Enter、パスワード欄で Enter を押しても送れます（設定画面ではアドレス欄で Enter を押すと保存します）。Tampermonkey のメニューからも呼べるので、フォルダページ以外でも使えます。
- **保存先などを選んで送る…**：送るもの（選択した項目・このフォルダ全体・このファイル）、保存先フォルダ、開始方法（すぐ開始／リンクグラバーで止める）、送れたらタブを閉じるかを、その場で選んで送ります。上の 3 つは設定の値（保存先は 1 行目）で送ります。

送信中は「送信中…」と表示し、終わるまでは次の送信を受け付けません。

### パスワード付きのフォルダ

GoFile のページでパスワードを入れて開いたフォルダは、「このフォルダ全体」などで送るときに、そのパスワードも JD2 に渡します。JD2 でもう一度入れる必要はありません。

- GoFile 自身はパスワードをハッシュでしか残さないので、パスワード入力欄から送った値をこのスクリプトが取っておきます。Tampermonkey の保存領域に平文で入り、GoFile と同じく 24 時間で消えます。
- パスワード付きのフォルダの中のサブフォルダへ移ったときは、そのタブで最後に入れたパスワードを渡します。
- 入れ間違えたまま送ると、JD2 の GoFile プラグインがパスワードを聞いてきます。

### 送れなかったとき（未送信）

JD2 に接続できなかった（起動していないなど）送信は、未送信として取っておきます。ツールバーに「未送信 N」と出るので、JD2 を起動してから押して「送り直す」を選ぶと、取っておいたときの保存先・開始方法・パスワードのまま送ります。いらなければ「すべて破棄」で消せます。Tampermonkey のメニューの「未送信の URL を送り直す」からも送れます。

JD2 が応答して断った場合と、応答が無かった場合（JD2 の許可ダイアログ待ちのことが多く、許可すれば追加されます）は取っておきません。

送ったあとは JD2 が自動でダウンロードを開始します。GoFile プラグインが中身を取得してから自動確認が働くので、開始までに少し間があります（待ち時間は JD2 の高度な設定で変えられます）。サブフォルダの分け方は JD2 側の設定に従います。

初回の送信時だけ JD2 に「外部アプリケーションがリンクを追加しようとしています」と出ます。「許可」を押すと gofile.io が記憶され、以後は出ません。このダイアログに長く答えないと「JDownloader 2 から応答がありません」と出ることがありますが、許可すればリンクは追加されます。

### 設定

ツールバーの ⚙（または Tampermonkey のメニューの「設定」）で変えられます。

- **Click'n'Load アドレス**：JD2 の受け口。初期値は `http://127.0.0.1:9666`。`http://` を省くと補って保存します。URL として読めない値は保存しません。
- **保存先フォルダ**：JD2 が動いている PC 上のフォルダを絶対パスで、1 行に 1 つ書きます（例 `D:\Downloads\GoFile`）。1 行目がふだんの保存先で、2 行目からは「保存先などを選んで送る…」で選べます。空欄なら JD2 の既定の保存先です。指定したフォルダの中に、GoFile のフォルダ名ごとのフォルダを作って保存します（JD2 のパッケージ名 `<jd:packagename>` を末尾に付けて渡します。自分で `<jd:…>` を含めて書いた場合はそのまま渡します）。JD2 のパッケージャーに保存先のルールがあると、そちらが優先されることがあります。v0.8 までの 1 つだけの保存先は、そのまま 1 行目として引き継ぎます。
- **送ったらリンクグラバーを経由せずダウンロードを開始する**：初期値はオン。オフにするとリンクグラバーで止まり、確認してから開始できます。
- **「このフォルダ全体」「このファイル」で送れたらタブを閉じる**：初期値はオフ。オンにすると、送れたあと少ししてタブを閉じます。「選択した項目」と「URL を指定して…」では閉じません。送れなかったとき（未送信に回したときも）は閉じません。ブラウザに止められて閉じられなかったときは、そう知らせます。

## 警告表示

GoFile 側の仕様変更などで動かなくなったときは、画面右下に赤い警告が出ます。次のような場合です。

- **起動できませんでした**：GoFile の内部モジュール（メニュー・ポップアップ・トースト通知）を読み込めない。ツールバーは出ません。Tampermonkey のメニューの「URL を指定して JDownloader 2 へ送る」と「設定」は、ブラウザの入力ダイアログを使う簡易版で動きます（URL はスペース区切りで入力します。パスワードは渡せません）。
- **ツールバーを表示できません**：ページのファイル管理部分を取得できない、またはツールバーを置く場所が見つからない。警告には原因（例 `#fm-toolbar が見つからない`）が出ます。Tampermonkey のメニューの「URL を指定して JDownloader 2 へ送る」は普段通り使えます。

## 開発メモ

### GoFile への依存点

GoFile の内部の仕組みを使っているので、GoFile の更新で壊れることがあります。壊れたときは次の順に調べます。FileManager と GoFile の DOM を読む処理は、`gofile-jd2.user.js` 冒頭の `gofile` オブジェクトにまとめてあるので、まずそこを直します。

| 依存しているもの | 使っている箇所 | 壊れたときの症状 |
|---|---|---|
| FileManager のコンストラクタが `this.loadSeq = 0` を代入すること（`Object.prototype.loadSeq` のセッターで捕まえる）。クラスフィールド構文（`loadSeq = 0;`）に変わるとセッターを通らない | 冒頭の捕捉部分 | 警告「ツールバーを表示できません（FileManager を捕捉できない）」 |
| FileManager の `state`（`status === 'ready'`、`selection` が Set、`folder.children` / `contents`、`items`、`fileView`、`folder.code`）、`params.contentId`、`root`、`destroyed`。一覧の項目の `id` / `type` / `code` | `gofile` オブジェクト | `status` 自体が無いと警告が出る。値や名前が変わっただけだと、ツールバーが出ない・選択が数えられないなど、警告なしで動かなくなる |
| DOM の `#fm-root`（ファイル管理部分）と `#fm-toolbar`（ツールバーの挿入先） | `gofile.barState()` など | 警告「ツールバーを表示できません（#fm-toolbar が見つからない）」。`#fm-root` が変わると警告も出ない |
| 単一ファイルのページの URL が `/d/<コード>`（＋`#file=<ID>`）の形であること | `gofile.currentFileUrl()` | 「このファイル」でエラーのトースト |
| パスワード入力欄が `form[data-fm="password"]` の `password` 欄であること。GoFile がパスワードを覚える ID が `params.contentId` と `state.gate.contentId` であること。パスワード付きのフォルダの `folder.password` が `true` であること | 冒頭のパスワードの記録、`gofile.passwordFormIds()` / `folderIds()` / `isProtected()` | 警告なしで、パスワードが JD2 に渡らなくなる（JD2 がパスワードを聞いてくる） |
| UI モジュール `/js/ui/menu.js`（`openMenu`）、`/js/ui/popup.js`（`popup.open`）、`/js/ui/toast.js`（`toast`） | `start()` | 警告「起動できませんでした」。メニューからの簡易版だけが動く |
| 上のモジュールの引数の形：`popup.open({ title, size, content, actions: [{ label, variant, onClick }] })`（`onClick` が `false` を返すと閉じない）、`toast(msg, { type })`、`openMenu({ anchor, placement, items })`（`type: 'label'` / `'separator'`）、メニューのアイコン名 `file` / `list-checks` / `folder-tree` / `link` / `folder-cog` / `rotate-cw` | `runUrls` / `openSettings` / `buildBar` | 警告なしで、ポップアップやメニューの表示が崩れたり、ボタンが効かなくなったりする |
| GoFile の CSS のクラス（`input` / `panel` / `icon-btn` / `btn-secondary` と Tailwind のクラス） | ツールバー・ポップアップの HTML | 見た目だけが崩れる |

調べ方の目安：

- DevTools の Sources で `/js/ui/menu.js` などを開き、export の名前と引数を確かめる。
- GoFile のスクリプトで `loadSeq` を検索し、FileManager のコンストラクタと `state` の中身を確かめる。
- Console で `[GoFile→JD2]` の出力を見る。

## ライセンス

[MIT](LICENSE)

次の 2 つのプロジェクト（いずれも MIT）を元にしています。元プロジェクトの著作権表示は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にあります。

- [gofile-dl](https://github.com/martadams89/gofile-dl)：URL からコンテンツ ID を取り出す処理
- [GoFile Enhanced](https://github.com/ewigl/gofile-enhanced)：GoFile のページへの UI 追加の手法
