// ==UserScript==
// @name         GoFile → JD2
// @namespace    gofile-jd2
// @version      0.8.2
// @description  GoFile のページにツールバーを追加し、GoFile の URL を Click'n'Load で JDownloader 2 へ渡す。中身の取得とフォルダ構造の再現は JD2 の GoFile プラグインに任せる。
// @author       Hoyomaru
// @license      MIT
// @homepageURL  https://github.com/Hoyomaru/gofile-jd2
// @supportURL   https://github.com/Hoyomaru/gofile-jd2/issues
// @downloadURL  https://raw.githubusercontent.com/Hoyomaru/gofile-jd2/main/gofile-jd2.user.js
// @updateURL    https://raw.githubusercontent.com/Hoyomaru/gofile-jd2/main/gofile-jd2.user.js
// @match        https://gofile.io/*
// @icon         https://gofile.io/assets/img/favicon32.png
// @run-at       document-start
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  const LOG = '[GoFile→JD2]';
  const BAR_ID = 'gm-jd-bar';
  const BANNER_ID = 'gm-jd-banner';
  const FORM_ID = 'gm-jd-settings';

  // ---------------------------------------------------------------------------
  // FileManager の捕捉（gofile-enhanced と同じ手法）
  // FileManager のコンストラクタが `this.loadSeq = 0` を代入した瞬間に拾う。
  // ページのスクリプトより先に仕掛ける必要があるので document-start で同期的に行う。
  // 表示中のフォルダと選択状態を知るためだけに使う。
  // ---------------------------------------------------------------------------
  let fm = null;
  const pageObject = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).Object;
  pageObject.defineProperty(pageObject.prototype, 'loadSeq', {
    set(val) {
      pageObject.defineProperty(this, 'loadSeq', { value: val, writable: true, configurable: true, enumerable: true });
      if (this && this.state && this.root && 'selection' in this.state) fm = this;
    },
    get() {
      return undefined;
    },
    configurable: true,
  });

  // ---------------------------------------------------------------------------
  // GoFile のページ状態の読み取り
  //   FileManager（fm）の内部プロパティと GoFile の DOM を読むのはここだけにする。
  //   GoFile の仕様変更で壊れたときは、まずここを直す。
  // ---------------------------------------------------------------------------
  const gofileUrl = (code) => `https://gofile.io/d/${code}`;

  const gofile = {
    // ツールバーを置けるかどうかと、置けないときの理由。
    //   problem は GoFile の仕様変更が疑われる理由だけ。読み込み中・パスワード入力待ちなど
    //   正常に起こりうる「まだ置けない」状態では null にして、警告を出さない。
    barState() {
      if (!fm) return { ready: false, problem: 'FileManager を捕捉できない' };
      const st = fm.state;
      if (!st || !('status' in st)) return { ready: false, problem: 'FileManager に state.status がない' };
      if (fm.destroyed || st.status !== 'ready' || !fm.root?.isConnected) return { ready: false, problem: null };
      const fileView = !!st.fileView;
      const selector = fileView ? '#fm-root' : '#fm-toolbar';
      const target = document.querySelector(selector);
      if (!target) return { ready: false, problem: `${selector} が見つからない` };
      return { ready: true, problem: null, fileView, target };
    },

    hasFileManagerRoot: () => !!document.querySelector('#fm-root'),

    isLoaded: () => !!fm?.state?.folder,

    selectionCount: () => fm?.state?.selection?.size ?? 0,

    // 表示中のフォルダ（サブフォルダのこともある）のコード。分からなければ null
    folderCode: () => fm?.state?.folder?.code ?? fm?.params?.contentId ?? null,

    // 表示中のフォルダの直下の項目
    children() {
      const folder = fm?.state?.folder;
      const c = folder?.children ?? folder?.contents ?? {};
      const list = Array.isArray(c) ? c : Object.values(c);
      return list.length ? list : fm?.state?.items ?? [];
    },

    selectedEntries() {
      const ids = new Set(fm?.state?.selection || []);
      return gofile.children().filter((c) => ids.has(c.id));
    },

    // 一覧の項目を JD2 に渡す URL にする。分からなければ null
    //   フォルダ: https://gofile.io/d/<コード>
    //   ファイル: https://gofile.io/d/<表示中のフォルダ>#file=<ID>（JD2 の GoFile プラグインの形式）
    entryUrl(entry, folderCode) {
      if (entry.type === 'folder') return entry.code ? gofileUrl(entry.code) : null;
      return folderCode && entry.id ? `${gofileUrl(folderCode)}#file=${entry.id}` : null;
    },

    // 単一ファイル表示のページの URL。ページの URL が /d/<コード> の形でなければ null
    //   ハッシュに #file=<ID> があれば残し、それ以外のクエリ・ハッシュは落とす。
    currentFileUrl() {
      const code = location.pathname.match(/^\/d\/([^/?#]+)/)?.[1];
      if (!code) return null;
      return gofileUrl(code) + (location.hash.match(/^#file=[A-Za-z0-9-]+/)?.[0] ?? '');
    },
  };

  // ---------------------------------------------------------------------------
  // 仕様変更などの警告バナー（GoFile 側の UI モジュールが使えなくても出せるよう素の DOM で作る）
  // ---------------------------------------------------------------------------
  function showBanner(message, detail) {
    const render = () => {
      document.getElementById(BANNER_ID)?.remove();
      const box = document.createElement('div');
      box.id = BANNER_ID;
      box.setAttribute('role', 'alert');
      box.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:420px;padding:12px 14px;' +
        'border-radius:12px;background:#2a1215;border:1px solid #f87171;color:#fecaca;' +
        'font:13px/1.6 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4)';
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:600;margin-bottom:4px;padding-right:20px';
      title.textContent = `GoFile → JD2: ${message}`;
      const body = document.createElement('div');
      body.style.cssText = 'color:#fca5a5;word-break:break-all';
      body.textContent = detail || '';
      const close = document.createElement('button');
      close.textContent = '×';
      close.title = '閉じる';
      close.setAttribute('aria-label', '閉じる');
      close.style.cssText = 'position:absolute;top:6px;right:10px;background:none;border:0;color:#fecaca;font-size:18px;cursor:pointer';
      close.onclick = () => box.remove();
      box.append(title, body, close);
      document.body.appendChild(box);
    };
    console.error(LOG, message, detail || '');
    document.body ? render() : document.addEventListener('DOMContentLoaded', render, { once: true });
  }

  // ---------------------------------------------------------------------------
  // GoFile の UI モジュール（start() で読み込む）
  //   読み込めなかったときは null のまま。そのときも「URL を指定して送る」と「設定」は
  //   Tampermonkey のメニューから prompt / alert の簡易版で使えるようにしておく。
  // ---------------------------------------------------------------------------
  const ui = { openMenu: null, popup: null, toast: null };

  // type: 'success' | 'warning' | 'error'。省略すると経過の知らせ（簡易版では表示しない）。
  function notify(message, type) {
    if (ui.toast) return ui.toast(message, type ? { type } : {});
    (type === 'error' || type === 'warning' ? console.warn : console.log)(LOG, message);
    if (type) alert(`GoFile → JD2: ${message}`);
  }

  // ---------------------------------------------------------------------------
  // 設定
  // ---------------------------------------------------------------------------
  const DEFAULT_JD_URL = 'http://127.0.0.1:9666';
  const jdUrlSetting = () => GM_getValue('cfg.jdUrl') ?? DEFAULT_JD_URL;
  const autoStartSetting = () => GM_getValue('cfg.autoStart') ?? true;
  const dirSetting = () => String(GM_getValue('cfg.dir') ?? '').trim();

  // Click'n'Load アドレスを整える。空なら既定値、スキームが無ければ http:// を補う。
  //   http / https の URL として読めなければ null。
  function normalizeJdUrl(value) {
    let v = String(value ?? '').trim();
    if (!v) return DEFAULT_JD_URL;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `http://${v}`;
    try {
      const u = new URL(v);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href.replace(/\/+$/, '');
    } catch {
      return null;
    }
  }
  const INVALID_JD_URL = "Click'n'Load アドレスの形が正しくありません（例: http://127.0.0.1:9666）";

  // jdUrl は normalizeJdUrl を通した値を渡す
  function saveSettings({ jdUrl, autoStart, dir }) {
    GM_setValue('cfg.jdUrl', jdUrl || DEFAULT_JD_URL);
    GM_setValue('cfg.autoStart', !!autoStart);
    GM_setValue('cfg.dir', String(dir ?? '').trim());
  }

  // ---------------------------------------------------------------------------
  // 小物
  // ---------------------------------------------------------------------------

  // gofile-dl の parse_content_id を元にしたもの。テキストから GoFile の URL を取り出す。
  //   個別ファイルの URL（…/d/<フォルダ>#file=<ID>）は #file= を残して、そのファイルだけを送る。
  //   URL を含まない行は、ID だけの行（英数字とハイフンで 5 文字以上）なら ID とみなす。
  //   どちらでもない空でない行は skipped に数える。
  function parseGofileUrls(text) {
    const urls = [];
    let skipped = 0;
    for (const line of String(text).split(/\r?\n/)) {
      if (!line.trim()) continue;
      const found = [...line.matchAll(/gofile\.io\/d\/([^/?#\s]+)[^#\s]*(#file=[A-Za-z0-9-]+)?/gi)].map(
        (m) => gofileUrl(m[1]) + (m[2] ?? ''),
      );
      if (found.length) urls.push(...found);
      else if (/^\s*[A-Za-z0-9-]{5,}\s*$/.test(line)) urls.push(gofileUrl(line.trim()));
      else skipped++;
    }
    return { urls: [...new Set(urls)], skipped };
  }

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------------------------------------------------------------------------
  // JDownloader 2（Click'n'Load）との通信
  //   GoFile の URL だけを渡し、中身の取得・フォルダ構造・パスワードは JD2 の GoFile プラグインに任せる。
  //   個別のファイルは https://gofile.io/d/<フォルダ>#file=<ファイルID> の形で渡す（JD2 の GoFile プラグインの形式）。
  // ---------------------------------------------------------------------------
  function gmRequest(method, url, data, timeout = 15000) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
        data,
        timeout,
        onload: (r) => resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: r.responseText || '' }),
        onerror: () => reject(new Error('接続できません（JDownloader 2 は起動していますか？ アドレスは正しいですか？）')),
        ontimeout: () =>
          reject(new Error('JDownloader 2 から応答がありません（JD2 に「許可」の確認が出ていないか見てください）')),
      });
    });
  }

  const jdBase = (url) => String(url ?? jdUrlSetting()).trim().replace(/\/+$/, '');

  async function jdCheck(url) {
    const res = await gmRequest('GET', `${jdBase(url)}/jdcheck.js`);
    if (!res.ok || !/jdownloader\s*=\s*true/.test(res.text)) throw new Error(res.ok ? 'JDownloader 2 の応答ではありません' : `HTTP ${res.status}`);
    return res.text.match(/version\s*=\s*'([^']*)'/)?.[1] ?? '';
  }

  // /flash/add は autostart を受け付けないので、autostart を扱える /flashgot へ送る。
  //   autostart=1 でリンクグラバーの確認を飛ばしてダウンロードを開始する（"1" 以外は無効扱い）。
  //   パスワードは URL と同じ行数で並べる（dpass: ダウンロード用、apass: 解凍用）。
  //   成功時の応答本文は JD2 のバージョンで異なる（空の 204 もある）ので、2xx なら成功とみなす。
  //   source: JD2 の許可ダイアログはここ（Referer が無いとき）からサイト名を取り、一度「許可」すれば記憶する。
  //           GM_xmlhttpRequest は Referer を送らないので、これが無いと毎回ダイアログが出る。
  //   dir: 保存先フォルダ。空なら JD2 の既定の保存先。
  //        JD2 は dir をパッケージの保存先としてそのまま上書きする（パッケージャーの後に適用され、
  //        「フォルダ構成を受継ぐ」などのサブフォルダ分けが消える）。そこで末尾に <jd:packagename> を付け、
  //        GoFile のフォルダ名（＝パッケージ名）のフォルダに入るようにする。この変数は保存先を決めるときに
  //        JD2 が展開する。<jd:subfolderbyplugin> はその時点では展開されないので使えない。
  //        利用者が自分で <jd:…> を書いたときはそのまま渡す。
  //   タイムアウト: 初回は JD2 が許可ダイアログへの応答を待ってから返すことがあるので、長めにとる。
  async function jdAdd(urls, password) {
    const body = new URLSearchParams({ urls: urls.join('\n'), referer: location.href, source: location.href });
    if (autoStartSetting()) body.set('autostart', '1');
    const dir = dirSetting();
    if (dir) body.set('dir', /<jd:/i.test(dir) ? dir : `${dir.replace(/[\\/]+$/, '')}\\<jd:packagename>`);
    if (password) {
      const lines = urls.map(() => password).join('\n');
      body.set('dpass', lines);
      body.set('apass', lines);
    }
    const res = await gmRequest('POST', `${jdBase()}/flashgot`, body.toString(), 60000);
    if (!res.ok || /^\s*failed/i.test(res.text)) throw new Error(res.text.trim() || `HTTP ${res.status}`);
  }

  // ---------------------------------------------------------------------------
  // 送信
  // ---------------------------------------------------------------------------
  let sending = false;

  async function send(urls, password) {
    if (sending) return notify('前の送信がまだ終わっていません。少し待ってください', 'warning');
    sending = true;
    notify(`${urls.length} 件の URL を JDownloader 2 へ送信中…`);
    try {
      await jdAdd(urls, password);
      notify(
        autoStartSetting()
          ? `${urls.length} 件の URL を JDownloader 2 へ送りました（自動でダウンロードを開始します）`
          : `${urls.length} 件の URL を JDownloader 2 へ送りました（リンクグラバーを確認してください）`,
        'success',
      );
    } catch (e) {
      console.error(LOG, e);
      notify(`JDownloader 2 への送信に失敗しました: ${e.message}`, 'error');
    } finally {
      sending = false;
    }
  }

  // テキストから URL を取り出して送る。送るものが無ければ false。
  function sendText(text, password) {
    const { urls, skipped } = parseGofileUrls(text);
    if (!urls.length) {
      notify('GoFile の URL が見つかりません', 'warning');
      return false;
    }
    if (skipped) notify(`URL として読み取れなかった行 ${skipped} 件は送っていません`, 'warning');
    send(urls, password);
    return true;
  }

  // ---------------------------------------------------------------------------
  // 操作：URL を指定して
  // ---------------------------------------------------------------------------
  function runUrls() {
    if (!ui.popup) {
      const text = prompt(
        'GoFile の URL を貼り付けてください（複数ならスペース区切り。ID だけでも可）\n' +
          '※ GoFile の画面部品を読み込めないため簡易版です。パスワードは渡せません。',
      );
      if (text != null) sendText(text.split(/\s+/).join('\n'), '');
      return;
    }
    ui.popup.open({
      title: 'URL を指定して JDownloader 2 へ送る',
      size: '2xl',
      content: `
        <div class="space-y-4">
          <div>
            <label for="gm-urls" class="mb-1.5 block text-xs font-medium text-slate-400">GoFile の URL（1 行に 1 つ。ID だけでも可。Ctrl+Enter で送る）</label>
            <textarea id="gm-urls" rows="8" class="input font-mono text-sm" style="height:auto"
                      placeholder="https://gofile.io/d/xxxxxx&#10;https://gofile.io/d/yyyyyy"></textarea>
          </div>
          <div>
            <label for="gm-urls-pwd" class="mb-1.5 block text-xs font-medium text-slate-400">パスワード（任意）</label>
            <input id="gm-urls-pwd" type="password" class="input" autocomplete="off" placeholder="JD2 に一緒に渡します">
          </div>
        </div>`,
      actions: [
        { label: 'キャンセル', variant: 'ghost' },
        {
          label: '送る',
          variant: 'primary',
          onClick: (h) => {
            const text = document.getElementById('gm-urls')?.value ?? '';
            const pwd = document.getElementById('gm-urls-pwd')?.value ?? '';
            if (sendText(text, pwd)) h.close();
          },
        },
      ],
    });
    setTimeout(() => document.getElementById('gm-urls')?.focus(), 50);
  }

  // ---------------------------------------------------------------------------
  // 設定画面
  // ---------------------------------------------------------------------------
  async function testConnection(value) {
    const url = normalizeJdUrl(value);
    if (!url) return { ok: false, message: `接続失敗: ${INVALID_JD_URL}` };
    try {
      const ver = await jdCheck(url);
      return { ok: true, message: `接続成功: JDownloader 2${ver ? `（ビルド ${ver}）` : ''}` };
    } catch (e) {
      return { ok: false, message: `接続失敗: ${e.message}` };
    }
  }

  // 接続テストボタン。popup の描画タイミングに左右されないよう、document で一度だけ受ける。
  document.addEventListener(
    'click',
    async (ev) => {
      const btn = ev.target?.closest?.(`#${FORM_ID} [data-gm-act="test"]`);
      if (!btn || btn.disabled) return;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = '確認中…';
      try {
        const { ok, message } = await testConnection(btn.form?.elements.jdUrl?.value.trim());
        notify(message, ok ? 'success' : 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    },
    true,
  );

  // ポップアップをキーボードで確定する。
  //   GoFile の popup の確定ボタン（actions）は onClick にしか処理を持たないので、
  //   入力欄から祖先をたどってそのボタンを探し、クリックする。
  //   設定画面: テキスト欄で Enter → 保存 / URL 指定: URL 欄で Ctrl+Enter、パスワード欄で Enter → 送る
  function clickPopupAction(fromEl, label) {
    for (let el = fromEl.parentElement; el && el !== document.body; el = el.parentElement) {
      const btn = [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
      if (btn) return btn.click();
    }
  }

  document.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key !== 'Enter' || ev.isComposing) return;
      const t = ev.target;
      let label = null;
      if (t?.closest?.(`#${FORM_ID}`) && t.tagName === 'INPUT' && t.type === 'text') label = '保存';
      else if (t?.id === 'gm-urls' && (ev.ctrlKey || ev.metaKey)) label = '送る';
      else if (t?.id === 'gm-urls-pwd') label = '送る';
      if (!label) return;
      ev.preventDefault();
      clickPopupAction(t, label);
    },
    true,
  );

  async function openSettingsFallback() {
    const input = prompt("JDownloader 2 の Click'n'Load アドレス（簡易版の設定画面です）", jdUrlSetting());
    if (input == null) return;
    const jdUrl = normalizeJdUrl(input);
    if (!jdUrl) return notify(`${INVALID_JD_URL}。保存していません`, 'error');
    const dir = prompt('保存先フォルダ（空欄なら JD2 の既定の保存先）', dirSetting());
    if (dir == null) return;
    const autoStart = confirm(
      '送ったらリンクグラバーを経由せずダウンロードを開始しますか？\n（OK = 開始する / キャンセル = リンクグラバーで止める）',
    );
    saveSettings({ jdUrl, autoStart, dir });
    const { ok, message } = await testConnection(jdUrlSetting());
    notify(`設定を保存しました。${message}`, ok ? 'success' : 'error');
  }

  function openSettings() {
    if (!ui.popup) return openSettingsFallback();
    ui.popup.open({
      title: 'GoFile → JD2 設定',
      size: 'lg',
      content: `
        <form id="${FORM_ID}" class="space-y-4" onsubmit="return false">
          <div>
            <label for="gm-jdUrl" class="mb-1.5 block text-xs font-medium text-slate-400">JDownloader 2 の Click'n'Load アドレス</label>
            <input id="gm-jdUrl" name="jdUrl" type="text" class="input" autocomplete="off"
                   value="${escapeHtml(jdUrlSetting())}" placeholder="${DEFAULT_JD_URL}">
            <p class="mt-1 text-xs text-slate-500">JD2 の初期値は ${DEFAULT_JD_URL}（http:// は省略可）</p>
          </div>
          <div>
            <label for="gm-dir" class="mb-1.5 block text-xs font-medium text-slate-400">保存先フォルダ</label>
            <input id="gm-dir" name="dir" type="text" class="input" autocomplete="off"
                   value="${escapeHtml(dirSetting())}" placeholder="例: D:\\Downloads\\GoFile">
            <p class="mt-1 text-xs text-slate-500">空欄なら JD2 の既定の保存先。JD2 が動いている PC 上のフォルダを絶対パスで指定します。中には GoFile のフォルダ名ごとにフォルダを作ります</p>
          </div>
          <label class="flex items-center gap-2 text-sm text-slate-300">
            <input name="autoStart" type="checkbox" ${autoStartSetting() ? 'checked' : ''}>
            送ったらリンクグラバーを経由せずダウンロードを開始する
          </label>
          <button type="button" data-gm-act="test" class="w-full rounded-lg border border-sky-500 px-3 py-2 text-sky-400 hover:bg-sky-500/10">接続テスト</button>
        </form>`,
      actions: [
        { label: 'キャンセル', variant: 'ghost' },
        {
          label: '保存',
          variant: 'primary',
          onClick: (h) => {
            const els = document.forms[FORM_ID]?.elements;
            if (!els) {
              notify('設定画面の入力欄を読み取れませんでした。保存していません', 'error');
              return h.close();
            }
            const jdUrl = normalizeJdUrl(els.jdUrl.value);
            if (!jdUrl) return notify(INVALID_JD_URL, 'error');
            saveSettings({ jdUrl, autoStart: els.autoStart.checked, dir: els.dir.value });
            notify('設定を保存しました', 'success');
            h.close();
          },
        },
      ],
    });
  }

  // Tampermonkey のメニューからも呼べるようにする（フォルダページ以外でも、GoFile の画面部品を読めなくても使える）
  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('URL を指定して JDownloader 2 へ送る', runUrls);
    GM_registerMenuCommand('設定', openSettings);
  }

  // ---------------------------------------------------------------------------
  // 本体（GoFile の UI モジュールを読み込んでから動く）
  // ---------------------------------------------------------------------------
  async function start() {
    const mod = (p) =>
      import(new URL(p, location.origin).href).catch((e) => {
        throw new Error(`${p} を読み込めません (${e.message})`);
      });
    const [{ openMenu }, { popup }, { toast }] = await Promise.all([mod('/js/ui/menu.js'), mod('/js/ui/popup.js'), mod('/js/ui/toast.js')]);
    const missing = Object.entries({ openMenu, toast, 'popup.open': popup?.open })
      .filter(([, f]) => typeof f !== 'function')
      .map(([k]) => k);
    if (missing.length) throw new Error(`見つからない関数: ${missing.join(', ')}`);
    Object.assign(ui, { openMenu, popup, toast });

    // ---- 操作：表示中のページから ----

    const NOT_LOADED = 'フォルダ情報を読み込めていません。ページを再読み込みしてください。';
    const NO_CODE = 'このページの GoFile のコードが分かりません。GoFile の仕様が変わった可能性があります。';

    // 単一ファイルのページ：表示中のファイル
    function sendCurrentFile() {
      if (!gofile.isLoaded()) return notify(NOT_LOADED, 'error');
      const url = gofile.currentFileUrl();
      if (!url) return notify(NO_CODE, 'error');
      send([url]);
    }

    // フォルダのページ：表示中のフォルダ全体
    function sendCurrentFolder() {
      if (!gofile.isLoaded()) return notify(NOT_LOADED, 'error');
      const code = gofile.folderCode();
      if (!code) return notify(NO_CODE, 'error');
      send([gofileUrl(code)]);
    }

    // フォルダのページ：選択した項目
    function sendSelected() {
      if (!gofile.isLoaded()) return notify(NOT_LOADED, 'error');
      const entries = gofile.selectedEntries();
      if (!entries.length) return notify('項目が選択されていません', 'warning');
      const folderCode = gofile.folderCode();
      const urls = entries.map((c) => gofile.entryUrl(c, folderCode)).filter(Boolean);
      if (urls.length < entries.length) notify(`URL が分からない項目 ${entries.length - urls.length} 件は送っていません`, 'warning');
      if (urls.length) send(urls);
    }

    // ---- ツールバー ----

    const ICON = {
      send: '<svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17V3"/><path d="m6 11 6 6 6-6"/><path d="M19 21H5"/></svg>',
      gear: '<svg xmlns="http://www.w3.org/2000/svg" class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><circle cx="12" cy="12" r="4"/></svg>',
    };

    function iconButton(icon, label, onClick, withText) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = withText ? 'btn-secondary flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm' : 'icon-btn';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.innerHTML = withText ? `${icon}<span>${escapeHtml(label)}</span>` : icon;
      b.addEventListener('click', onClick);
      return b;
    }

    function buildBar(fileView) {
      const bar = document.createElement('div');
      bar.id = BAR_ID;
      bar.className = 'panel mb-3 px-2 py-1.5 shadow-lg shadow-black/20';
      if (fileView) bar.classList.add('mx-auto', 'max-w-3xl');
      const row = document.createElement('div');
      row.className = 'flex items-center gap-1.5';

      const title = document.createElement('span');
      title.className = 'px-1 text-sm text-slate-400';
      title.textContent = 'GoFile → JD2';
      const spacer = document.createElement('span');
      spacer.className = 'flex-1';

      const sendButton = iconButton(ICON.send, 'JD2 へ送る', (ev) => {
        const sel = gofile.selectionCount();
        ui.openMenu({
          anchor: ev.currentTarget,
          placement: 'bottom-end',
          items: () => [
            { type: 'label', label: 'JDownloader 2 へ送る' },
            ...(fileView
              ? [{ label: 'このファイル', icon: 'file', onClick: sendCurrentFile }]
              : [
                  { label: `選択した項目${sel ? `（${sel}）` : ''}`, icon: 'list-checks', disabled: !sel, onClick: sendSelected },
                  { label: 'このフォルダ全体', icon: 'folder-tree', onClick: sendCurrentFolder },
                ]),
            { label: 'URL を指定して…', icon: 'link', onClick: runUrls },
          ],
        });
      }, true);

      row.append(title, spacer, sendButton, iconButton(ICON.gear, '設定', openSettings));
      bar.appendChild(row);
      return bar;
    }

    // GoFile のファイル管理部分があるのに、一定時間たってもツールバーを置けず、
    // その理由が仕様変更らしいときに警告する
    let hookTimer = null;
    let hookWarned = false;
    function watchHook() {
      if (hookWarned || hookTimer || document.getElementById(BAR_ID) || !gofile.hasFileManagerRoot()) return;
      hookTimer = setTimeout(() => {
        hookTimer = null;
        if (document.getElementById(BAR_ID) || !gofile.hasFileManagerRoot()) return;
        const { problem } = gofile.barState();
        if (!problem) return;
        hookWarned = true;
        showBanner(
          'ツールバーを表示できません',
          `GoFile の仕様が変わった可能性があります（${problem}）。Tampermonkey のメニューの「URL を指定して JDownloader 2 へ送る」は使えます。`,
        );
      }, 10000);
    }

    function mountBar() {
      watchHook();
      const existing = document.getElementById(BAR_ID);
      const s = gofile.barState();
      if (!s.ready) {
        existing?.remove();
        return;
      }
      if (existing && existing.dataset.view === String(s.fileView)) return;
      existing?.remove();
      const bar = buildBar(s.fileView);
      bar.dataset.view = String(s.fileView);
      s.fileView ? s.target.prepend(bar) : s.target.insertAdjacentElement('beforebegin', bar);
    }

    new MutationObserver(mountBar).observe(document.documentElement, { childList: true, subtree: true });
    mountBar();
  }

  const boot = () =>
    start().catch((e) =>
      showBanner(
        '起動できませんでした',
        `GoFile の仕様が変わった可能性があります。Tampermonkey のメニューから簡易版の「URL を指定して JDownloader 2 へ送る」と「設定」は使えます。詳細: ${e?.message || e}`,
      ),
    );
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
