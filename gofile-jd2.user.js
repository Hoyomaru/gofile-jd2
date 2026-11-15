// ==UserScript==
// @name         GoFile → JD2
// @namespace    gofile-jd2
// @version      0.5.0
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
  // 仕様変更などの警告バナー（GoFile 側の UI モジュールが使えなくても出せるよう素の DOM で作る）
  // ---------------------------------------------------------------------------
  function showBanner(message, detail) {
    const render = () => {
      document.getElementById(BANNER_ID)?.remove();
      const box = document.createElement('div');
      box.id = BANNER_ID;
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
      close.style.cssText = 'position:absolute;top:6px;right:10px;background:none;border:0;color:#fecaca;font-size:18px;cursor:pointer';
      close.onclick = () => box.remove();
      box.append(title, body, close);
      document.body.appendChild(box);
    };
    console.error(LOG, message, detail || '');
    document.body ? render() : document.addEventListener('DOMContentLoaded', render, { once: true });
  }

  // ---------------------------------------------------------------------------
  // 設定
  // ---------------------------------------------------------------------------
  const DEFAULT_JD_URL = 'http://127.0.0.1:9666';
  const jdUrlSetting = () => GM_getValue('cfg.jdUrl') ?? DEFAULT_JD_URL;

  // ---------------------------------------------------------------------------
  // 小物
  // ---------------------------------------------------------------------------

  // gofile-dl の parse_content_id 相当。テキストから GoFile のコンテンツ ID を取り出す。
  function parseContentIds(text) {
    const ids = [];
    for (const line of String(text).split(/\r?\n/)) {
      const urls = [...line.matchAll(/gofile\.io\/d\/([^/?#\s]+)/gi)].map((m) => m[1]);
      if (urls.length) ids.push(...urls);
      else if (/^\s*[A-Za-z0-9-]+\s*$/.test(line)) ids.push(line.trim());
    }
    return [...new Set(ids)];
  }

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const gofileUrl = (code) => `https://gofile.io/d/${code}`;

  // ---------------------------------------------------------------------------
  // JDownloader 2（Click'n'Load）との通信
  //   GoFile の URL だけを渡し、中身の取得・フォルダ構造・パスワードは JD2 の GoFile プラグインに任せる。
  //   個別のファイルは https://gofile.io/d/<フォルダ>#file=<ファイルID> の形で渡す（JD2 の GoFile プラグインの形式）。
  // ---------------------------------------------------------------------------
  function gmRequest(method, url, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
        data,
        timeout: 15000,
        onload: (r) => resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: r.responseText || '' }),
        onerror: () => reject(new Error('接続できません（JDownloader 2 は起動していますか？）')),
        ontimeout: () => reject(new Error('タイムアウト')),
      });
    });
  }

  const jdBase = (url) => String(url ?? jdUrlSetting()).trim().replace(/\/+$/, '');

  async function jdCheck(url) {
    const res = await gmRequest('GET', `${jdBase(url)}/jdcheck.js`);
    if (!res.ok || !/jdownloader\s*=\s*true/.test(res.text)) throw new Error(res.ok ? 'JDownloader 2 の応答ではありません' : `HTTP ${res.status}`);
    return res.text.match(/version\s*=\s*'([^']*)'/)?.[1] ?? '';
  }

  async function jdAdd(urls, password) {
    const body = new URLSearchParams({ urls: urls.join('\r\n'), source: location.href, referer: location.href });
    if (password) body.set('passwords', password);
    const res = await gmRequest('POST', `${jdBase()}/flash/add`, body.toString());
    if (!res.ok || !/success/i.test(res.text)) throw new Error(res.text.trim() || `HTTP ${res.status}`);
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

    // ---- 送信 ----

    async function send(urls, password) {
      try {
        await jdAdd(urls, password);
        toast(`${urls.length} 件の URL を JDownloader 2 へ送りました（リンクグラバーを確認してください）`, { type: 'success' });
      } catch (e) {
        console.error(LOG, e);
        toast(`JDownloader 2 への送信に失敗しました: ${e.message}`, { type: 'error' });
      }
    }

    // ---- 操作：表示中のフォルダから ----

    function currentChildren() {
      const folder = fm?.state?.folder;
      const c = folder?.children ?? folder?.contents ?? {};
      const list = Array.isArray(c) ? c : Object.values(c);
      return list.length ? list : fm?.state?.items ?? [];
    }

    function runCurrent(mode) {
      const st = fm?.state;
      if (!st?.folder) return toast('フォルダ情報を読み込めていません。ページを再読み込みしてください。', { type: 'error' });
      if (st.fileView) return send([location.href.split(/[?#]/)[0]]);
      const rootCode = st.folder.code ?? fm.params?.contentId;
      if (mode === 'all') return send([gofileUrl(rootCode)]);

      const ids = new Set(st.selection || []);
      const entries = currentChildren().filter((c) => ids.has(c.id));
      if (!entries.length) return toast('項目が選択されていません', { type: 'warning' });
      const urls = entries
        .map((c) => (c.type === 'folder' ? (c.code ? gofileUrl(c.code) : null) : `${gofileUrl(rootCode)}#file=${c.id}`))
        .filter(Boolean);
      if (urls.length < entries.length) toast(`URL が分からない項目 ${entries.length - urls.length} 件は送っていません`, { type: 'warning' });
      if (urls.length) return send(urls);
    }

    // ---- 操作：URL を指定して ----

    function runUrls() {
      popup.open({
        title: 'URL を指定して JDownloader 2 へ送る',
        size: '2xl',
        content: `
          <div class="space-y-4">
            <div>
              <label for="gm-urls" class="mb-1.5 block text-xs font-medium text-slate-400">GoFile の URL（1 行に 1 つ。ID だけでも可）</label>
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
              const ids = parseContentIds(document.getElementById('gm-urls')?.value ?? '');
              if (!ids.length) return toast('GoFile の URL が見つかりません', { type: 'warning' });
              const pwd = document.getElementById('gm-urls-pwd')?.value ?? '';
              h.close();
              send(ids.map(gofileUrl), pwd);
            },
          },
        ],
      });
      setTimeout(() => document.getElementById('gm-urls')?.focus(), 50);
    }

    // ---- 設定画面 ----

    function openSettings() {
      popup.open({
        title: 'GoFile → JD2 設定',
        size: 'lg',
        content: `
          <form id="${FORM_ID}" class="space-y-4" onsubmit="return false">
            <div>
              <label for="gm-jdUrl" class="mb-1.5 block text-xs font-medium text-slate-400">JDownloader 2 の Click'n'Load アドレス</label>
              <input id="gm-jdUrl" name="jdUrl" type="text" class="input" autocomplete="off"
                     value="${escapeHtml(jdUrlSetting())}" placeholder="${DEFAULT_JD_URL}">
              <p class="mt-1 text-xs text-slate-500">JD2 の初期値は ${DEFAULT_JD_URL}</p>
            </div>
            <button type="button" data-gm-act="test" class="w-full rounded-lg border border-sky-500 px-3 py-2 text-sky-400 hover:bg-sky-500/10">接続テスト</button>
          </form>`,
        actions: [
          { label: 'キャンセル', variant: 'ghost' },
          {
            label: '保存',
            variant: 'primary',
            onClick: (h) => {
              GM_setValue('cfg.jdUrl', document.forms[FORM_ID].elements.jdUrl.value.trim() || DEFAULT_JD_URL);
              toast('設定を保存しました', { type: 'success' });
              h.close();
            },
          },
        ],
      });
      queueMicrotask(() => {
        const form = document.forms[FORM_ID];
        form?.querySelector('[data-gm-act="test"]')?.addEventListener('click', async () => {
          try {
            const ver = await jdCheck(form.elements.jdUrl.value.trim() || DEFAULT_JD_URL);
            toast(`接続成功: JDownloader 2${ver ? `（ビルド ${ver}）` : ''}`, { type: 'success' });
          } catch (e) {
            toast(`接続失敗: ${e.message}`, { type: 'error' });
          }
        });
      });
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
        const sel = fm?.state?.selection?.size ?? 0;
        openMenu({
          anchor: ev.currentTarget,
          placement: 'bottom-end',
          items: () => [
            { type: 'label', label: 'JDownloader 2 へ送る' },
            ...(fileView
              ? [{ label: 'このファイル', icon: 'file', onClick: () => runCurrent('all') }]
              : [
                  { label: `選択した項目${sel ? `（${sel}）` : ''}`, icon: 'list-checks', disabled: !sel, onClick: () => runCurrent('selected') },
                  { label: 'このフォルダ全体', icon: 'folder-tree', onClick: () => runCurrent('all') },
                ]),
            { label: 'URL を指定して…', icon: 'link', onClick: runUrls },
          ],
        });
      }, true);

      row.append(title, spacer, sendButton, iconButton(ICON.gear, '設定', openSettings));
      bar.appendChild(row);
      return bar;
    }

    // FileManager を捕まえられないまま一定時間たったら警告する
    let hookTimer = null;
    let hookWarned = false;
    function watchHook() {
      if (fm || hookWarned || hookTimer || !document.querySelector('#fm-root')) return;
      hookTimer = setTimeout(() => {
        hookTimer = null;
        if (!fm && document.querySelector('#fm-root')) {
          hookWarned = true;
          showBanner(
            'ページのファイル管理部分を取得できません',
            'GoFile の仕様が変わった可能性があります。「URL を指定して送る」（Tampermonkey のメニュー）は使えます。'
          );
        }
      }, 10000);
    }

    function mountBar() {
      watchHook();
      const existing = document.getElementById(BAR_ID);
      const ready = fm && !fm.destroyed && fm.state?.status === 'ready' && fm.root?.isConnected;
      if (!ready) {
        existing?.remove();
        return;
      }
      const fileView = !!fm.state.fileView;
      if (existing && existing.dataset.view === String(fileView)) return;
      existing?.remove();
      const target = fileView ? document.querySelector('#fm-root') : document.querySelector('#fm-toolbar');
      if (!target) return;
      const bar = buildBar(fileView);
      bar.dataset.view = String(fileView);
      fileView ? target.prepend(bar) : target.insertAdjacentElement('beforebegin', bar);
    }

    // Tampermonkey のメニューからも呼べるようにする（フォルダページ以外でも使える）
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('URL を指定して JDownloader 2 へ送る', runUrls);
      GM_registerMenuCommand('設定', openSettings);
    }

    new MutationObserver(mountBar).observe(document.documentElement, { childList: true, subtree: true });
    mountBar();
  }

  const boot = () =>
    start().catch((e) =>
      showBanner('起動できませんでした', `GoFile の仕様が変わった可能性があります。詳細: ${e?.message || e}`)
    );
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
