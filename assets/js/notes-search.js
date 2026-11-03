/* Notes search — mkdocs-material style overlay for /notes/* pages.
 * Client-side over /search-index.json (Liquid-built). No dependencies.
 * Chinese: substring matching; Latin: prefix matching. Title/url boosted.
 */
(function () {
  'use strict';
  if (!/^\/notes(\/|$)/.test(location.pathname)) return;

  var CSS = [
    '.ns-btn{position:fixed;right:18px;bottom:18px;z-index:9998;display:flex;align-items:center;gap:8px;',
      'padding:10px 16px;border:1px solid #ccc;border-radius:999px;background:#fff;color:#333;cursor:pointer;',
      'box-shadow:0 2px 10px rgba(0,0,0,.15);font-size:.9rem}',
    '.ns-btn kbd{margin-left:2px}',
    'html[data-theme="dark"] .ns-btn{background:#26282c;color:#ddd;border-color:#444}',
    '.ns-scrim{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:none}',
    '.ns-panel{position:fixed;left:50%;top:10vh;transform:translateX(-50%);width:min(760px,94vw);',
      'background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);z-index:9999;display:none;overflow:hidden}',
    'html[data-theme="dark"] .ns-panel{background:#26282c;color:#ddd}',
    'html[data-theme="dark"] .ns-panel .ns-input{color:#ddd}',
    '.ns-head{display:flex;align-items:center;gap:10px;padding:6px 16px;border-bottom:1px solid #e3e3e3}',
    'html[data-theme="dark"] .ns-head{border-color:#444}',
    '.ns-head .ns-ico{color:#999;font-size:15px}',
    '.ns-input{flex:1;border:none;outline:none;padding:12px 0;font-size:16px;background:transparent;color:#333;font-family:inherit}',
    '.ns-close{border:none;background:none;cursor:pointer;color:#999;font-size:18px;padding:4px 6px;border-radius:6px}',
    '.ns-results{max-height:56vh;overflow:auto}',
    '.ns-result{display:block;padding:10px 16px;border-bottom:1px solid #eee;text-decoration:none}',
    'html[data-theme="dark"] .ns-result{border-color:#3a3d44}',
    '.ns-result.active{background:#f4f7fd}',
    'html[data-theme="dark"] .ns-result.active{background:#232b3e}',
    '.ns-crumb{font-size:.74rem;color:#8a8f99;margin-bottom:2px}',
    '.ns-title{font-weight:600;font-size:.95rem}',
    '.ns-snip{font-size:.83rem;color:#666;margin-top:2px;line-height:1.45}',
    'html[data-theme="dark"] .ns-snip{color:#aaa}',
    '.ns-empty{padding:22px 16px;color:#888;font-size:.9rem;text-align:center}',
    '.ns-foot{display:flex;gap:16px;align-items:center;padding:8px 16px;font-size:.74rem;color:#8a8f99;',
      'border-top:1px solid #e3e3e3}',
    'html[data-theme="dark"] .ns-foot{border-color:#444}',
    '.ns-foot kbd,.ns-btn kbd{border:1px solid #bbb;border-bottom-width:2px;border-radius:4px;padding:0 5px;',
      'font-size:.72rem;font-family:inherit}',
    'html[data-theme="dark"] .ns-foot kbd,html[data-theme="dark"] .ns-btn kbd{border-color:#555}',
    '.ns-foot .ns-right{margin-left:auto}',
    '.ns-bar{max-width:860px;margin:0 auto 18px;}',
    '.ns-barin{display:flex;align-items:center;gap:10px;border:1px solid #ccc;border-radius:999px;padding:10px 18px;',
      'cursor:text;background:#fff;font-size:.95rem;color:#8a8f99}',
    'html[data-theme="dark"] .ns-barin{background:#26282c;color:#9a9fa8;border-color:#444}',
    '.ns-barin .ns-hint{margin-left:auto;white-space:nowrap}',
    '.ns-m{background:#ffe9a8;color:inherit;padding:0 2px;border-radius:3px}',
    'html[data-theme="dark"] .ns-m{background:#5c4a1e;color:#ffe9a8}'
  ].join('');

  function t(zh, en) {
    return '<span class="i18n-zh">' + zh + '</span><span class="i18n-en">' + en + '</span>';
  }

  function injectUI() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    var btn = document.createElement('button');
    btn.className = 'ns-btn';
    btn.innerHTML = '🔍 ' + t('搜索笔记', 'Search notes') + ' <kbd>Ctrl K</kbd>';
    btn.addEventListener('click', openSearch);
    document.body.appendChild(btn);

    var scrim = document.createElement('div');
    scrim.className = 'ns-scrim';
    scrim.addEventListener('click', closeSearch);
    document.body.appendChild(scrim);

    var panel = document.createElement('div');
    panel.className = 'ns-panel';
    panel.innerHTML =
      '<div class="ns-head"><span class="ns-ico">🔍</span>' +
      '<input class="ns-input" type="text" spellcheck="false">' +
      '<button class="ns-close" title="Esc">✕</button></div>' +
      '<div class="ns-results"><div class="ns-empty">' +
      t('输入关键词，支持中文与英文（如：decode_stagger、流水线、Markov）', 'Type keywords — Chinese and English both work (e.g. decode_stagger, pipeline, Markov)') +
      '</div></div>' +
      '<div class="ns-foot"><span>' + t('↑ ↓ 选择', '↑ ↓ select') + '</span>' +
      '<span>Enter ' + t('打开', 'open') + '</span><span>Esc ' + t('关闭', 'close') + '</span>' +
      '<span class="ns-right">' + t('共 <span class="ns-count">0</span> 页笔记', '<span class="ns-count">0</span> pages') + '</span></div>';
    document.body.appendChild(panel);

    panel.querySelector('.ns-close').addEventListener('click', closeSearch);
    var input = panel.querySelector('.ns-input');
    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { render(input.value); }, 120);
    });
    input.addEventListener('keydown', onKeydown);

    // catalog inline launcher
    if (location.pathname.replace(/\/$/, '') === '/notes') {
      var h1 = document.querySelector('h1.page__title');
      if (h1) {
        var bar = document.createElement('div');
        bar.className = 'ns-bar';
        bar.innerHTML = '<div class="ns-barin">🔍 ' + t('搜索学习笔记…', 'Search the notes…') +
          '<span class="ns-hint"><kbd>Ctrl</kbd> <kbd>K</kbd></span></div>';
        bar.addEventListener('click', openSearch);
        h1.insertAdjacentElement('afterend', bar);
      }
    }
  }

  var IDX = null;
  function ensureIndex() {
    if (IDX) return Promise.resolve(IDX);
    return fetch('/search-index.json').then(function (r) { return r.json(); }).then(function (j) {
      j.forEach(function (p) {
        p.textLower = p.text.toLowerCase();
        p.titleLower = p.title.toLowerCase();
      });
      IDX = j;
      var c = document.querySelector('.ns-count');
      if (c) c.textContent = String(j.length);
      return j;
    });
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function tokenize(q) {
    var toks = [], m, re = /[A-Za-z0-9_@.\-]+|[\u4e00-\u9fff\u3400-\u4dbf]+|[^\sA-Za-z0-9_@.\-\u4e00-\u9fff\u3400-\u4dbf]+/g;
    while ((m = re.exec(q)) !== null) {
      var tok = m[0];
      if (/^[\u4e00-\u9fff\u3400-\u4dbf]+$/.test(tok)) {
        // CJK: also push 2-grams for short strings robustness
        if (tok.length > 2) toks.push(tok);
        for (var i = 0; i + 2 <= tok.length; i++) toks.push(tok.substr(i, 2));
      } else if (/[A-Za-z0-9]/.test(tok)) {
        toks.push(tok.toLowerCase());
      }
    }
    return toks;
  }

  function countOf(hay, needle) {
    var n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
    return n;
  }

  function groupFor(url) {
    var map = [
      ['/notes/vllm-pp', 'vLLM · PP', 'vLLM · PP'],
      ['/notes/vllm-kv-connector', 'vLLM · KV Connector', 'vLLM · KV Connector'],
      ['/notes/vllm-chunked-prefill', 'vLLM · Chunked Prefill', 'vLLM · Chunked Prefill'],
      ['/notes/vllm-dspark-dflash', 'vLLM · DSpark/DFlash', 'vLLM · DSpark/DFlash'],
      ['/notes/vllm', 'vLLM · ' + (function(){return ''})() + '', 'vLLM · Weekly'],
      ['/notes/sglang', 'SGLang', 'SGLang'],
      ['/notes/spec-decoding', '投机解码', 'Speculative Decoding']
    ];
    for (var i = 0; i < map.length; i++) {
      if (url.indexOf(map[i][0]) === 0) return map[i][1];
    }
    if (url.replace(/\/$/, '') === '/notes') return t('目录', 'Catalog');
    return t('学习笔记', 'Notes');
  }

  function snippet(text, textLower, toks) {
    var best = -1;
    toks.forEach(function (tk) {
      var i = textLower.indexOf(tk);
      if (i !== -1 && (best === -1 || i < best)) best = i;
    });
    if (best === -1) best = 0;
    var start = Math.max(0, best - 55);
    var end = Math.min(text.length, best + 170);
    var cut = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    var cutLower = cut.toLowerCase();
    var html = escapeHtml(cut);
    toks.forEach(function (tk) {
      if (/[&<>"]/.test(tk)) return;
      var re = new RegExp(tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      html = html.replace(re, function (m0) { return '<mark class="ns-m">' + m0 + '</mark>'; });
    });
    return html;
  }

  function titleHtml(title, toks) {
    var html = escapeHtml(title);
    toks.forEach(function (tk) {
      if (/[&<>"]/.test(tk)) return;
      var re = new RegExp(tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      html = html.replace(re, function (m0) { return '<mark class="ns-m">' + m0 + '</mark>'; });
    });
    return html;
  }

  function search(q) {
    var toks = tokenize(q);
    if (!toks.length) return { toks: [], results: [] };
    var out = [];
    IDX.forEach(function (p) {
      var score = 0, ok = true;
      toks.forEach(function (tk) {
        var inTitle = p.titleLower.indexOf(tk);
        var c = countOf(p.textLower, tk);
        if (inTitle === -1 && c === 0) { ok = false; return; }
        if (inTitle !== -1) score += 80;
        score += Math.min(c, 12) * 4;
        if (p.url.toLowerCase().indexOf(tk) !== -1) score += 15;
      });
      if (ok) out.push({ p: p, score: score });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return { toks: toks, results: out.slice(0, 8).map(function (x) { return x.p; }) };
  }

  var sel = -1;

  function render(q) {
    var box = document.querySelector('.ns-results');
    if (!IDX || !q.trim()) {
      box.innerHTML = '<div class="ns-empty">' +
        t('输入关键词，支持中文与英文（如：decode_stagger、流水线、Markov）', 'Type keywords — Chinese and English both work (e.g. decode_stagger, pipeline, Markov)') + '</div>';
      sel = -1;
      return;
    }
    var r = search(q);
    if (!r.results.length) {
      box.innerHTML = '<div class="ns-empty">' + t('没有匹配的笔记页。', 'No matching notes page.') + '</div>';
      sel = -1;
      return;
    }
    var html = '';
    r.results.forEach(function (p, i) {
      html += '<a class="ns-result" data-url="' + escapeHtml(p.url) + '" href="' + escapeHtml(p.url) + '">' +
        '<div class="ns-crumb">' + t('学习笔记', 'Notes') + ' › ' + groupFor(p.url) + '</div>' +
        '<div class="ns-title">' + titleHtml(p.title, r.toks) + '</div>' +
        '<div class="ns-snip">' + snippet(p.text, p.textLower, r.toks) + '</div></a>';
    });
    box.innerHTML = html;
    sel = -1;
    box.querySelectorAll('.ns-result').forEach(function (a) {
      a.addEventListener('click', function () { closeSearch(); });
    });
  }

  function setActive(idx) {
    var items = document.querySelectorAll('.ns-result');
    if (!items.length) return;
    sel = Math.max(0, Math.min(idx, items.length - 1));
    items.forEach(function (a, i) { a.classList.toggle('active', i === sel); });
    items[sel].scrollIntoView({ block: 'nearest' });
  }

  function onKeydown(e) {
    var items = document.querySelectorAll('.ns-result');
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(sel + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(sel - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      var target = (sel >= 0 && items[sel]) ? items[sel] : items[0];
      if (target) { closeSearch(); location.href = target.getAttribute('data-url'); }
    }
  }

  function openSearch() {
    document.querySelector('.ns-scrim').style.display = 'block';
    document.querySelector('.ns-panel').style.display = 'block';
    var input = document.querySelector('.ns-input');
    input.placeholder = document.documentElement.classList.contains('lang-en')
      ? 'Search the notes…'
      : '搜索学习笔记…';
    ensureIndex();
    input.focus();
    input.select();
  }

  function closeSearch() {
    document.querySelector('.ns-scrim').style.display = 'none';
    document.querySelector('.ns-panel').style.display = 'none';
  }

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    injectUI();
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        var panel = document.querySelector('.ns-panel');
        if (panel.style.display === 'block') closeSearch(); else openSearch();
      } else if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
        e.preventDefault();
        openSearch();
      } else if (e.key === 'Escape') {
        closeSearch();
      }
    });
  });
})();
