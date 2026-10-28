/*
 * Language switcher: Chinese (default) <-> English.
 *
 * - Bilingual inline text uses
 *     <span class="i18n-zh">中文</span><span class="i18n-en">English</span>
 *   and CSS in _includes/head/custom.html shows the active language
 *   (html.lang-en toggles; Chinese shows by default without JS).
 * - Front-matter page titles (h1.page__title and <title>) stay in plain
 *   English (they also feed SEO/feeds) and are translated here via
 *   PAGE_TITLES. The original <title> is remembered so switching back
 *   to English restores it exactly.
 * - Preference is persisted in localStorage as "site-lang"; default: zh.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'site-lang';

  // Front-matter titles -> per-language display strings.
  var PAGE_TITLES = {
    'About Me':      { zh: '关于我',          en: 'About Me' },
    'Projects':      { zh: '项目',            en: 'Projects' },
    'Mini-Projects': { zh: '小型项目',        en: 'Mini-Projects' },
    'Blog posts':    { zh: '博客文章',        en: 'Blog Posts' },
    'My RPI':        { zh: '我的树莓派',      en: 'My RPI' },
    'Study Notes':   { zh: '学习笔记',        en: 'Study Notes' },
    'vLLM':          { zh: 'vLLM 学习笔记',   en: 'vLLM Study Notes' },
    'SGLang':        { zh: 'SGLang 学习笔记', en: 'SGLang Study Notes' },
    'KV Connector':  { zh: 'KV Connector 机制剖析', en: 'KV Connector Internals' },
    'PP Interleaving': { zh: 'PP 流水线交错执行',   en: 'PP Pipeline Interleaving' }
  };

  function currentLang() {
    return document.documentElement.classList.contains('lang-en') ? 'en' : 'zh';
  }

  function applyTitles(lang) {
    // h1 on archive/single layouts
    var h1 = document.querySelector('h1.page__title');
    var entry = null;
    if (h1) {
      // remember the original (English) front-matter title for lookups
      if (!h1.getAttribute('data-en-title')) {
        h1.setAttribute('data-en-title', h1.textContent.trim());
      }
      var raw = h1.getAttribute('data-en-title');
      entry = PAGE_TITLES[raw] || PAGE_TITLES[raw.replace(/\s+/g, ' ')];
      if (entry) h1.textContent = entry[lang];
    }
    // Browser tab title
    var html = document.documentElement;
    if (!html.getAttribute('data-en-title')) {
      html.setAttribute('data-en-title', document.title);
    }
    var base = html.getAttribute('data-en-title');
    if (entry) {
      if (lang === 'zh') {
        var idx = base.lastIndexOf(' - ');
        document.title = entry.zh + (idx >= 0 ? ' - ' + base.slice(idx + 3) : '');
      } else {
        document.title = base;
      }
    }
  }

  function updateToggle(lang) {
    var el = document.getElementById('lang-label');
    if (el) el.textContent = (lang === 'zh') ? 'EN' : '中文';
    var li = document.getElementById('lang-toggle');
    if (li) {
      li.title = (lang === 'zh') ? 'Switch to English' : '切换到中文';
      li.setAttribute('aria-label', li.title);
    }
    document.documentElement.setAttribute('lang', (lang === 'zh') ? 'zh-CN' : 'en');
  }

  function apply(lang) {
    document.documentElement.classList.toggle('lang-en', lang === 'en');
    updateToggle(lang);
    applyTitles(lang);
  }

  function toggle() {
    var next = (currentLang() === 'zh') ? 'en' : 'zh';
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    apply(next);
  }

  function init() {
    var lang = 'zh';
    try { lang = localStorage.getItem(STORAGE_KEY) || 'zh'; } catch (e) {}
    apply(lang);
    var li = document.getElementById('lang-toggle');
    if (li) {
      li.addEventListener('click', function (e) {
        e.preventDefault();
        toggle();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
