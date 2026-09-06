/* ============================================================================
 * Цикл и беременность ꒰১ ໒꒱ — расширение для SillyTavern
 *   Ядро (фазы/рендер/промпты/календарь) — общее с Tavo-версией (src/panel.js).
 *   Этот заголовок — тонкий «клей»: подменяет платформенный слой tavo.* поверх
 *   SillyTavern.getContext() и пробрасывает события таверны в ядро.
 *   Собирается скриптом build_st.py — НЕ редактировать вручную ниже разделителя.
 * ========================================================================== */
import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced, setExtensionPrompt, extension_prompt_types } from '../../../../script.js';

const PB = 'pusya_bio';
function CTX() { return SillyTavern.getContext(); }
function gstore() { extension_settings[PB] = extension_settings[PB] || {}; return extension_settings[PB]; }
function mstore() { const m = CTX().chatMetadata; if (!m) return null; m[PB] = m[PB] || {}; return m[PB]; }

// tavo-шим: тот же интерфейс, что даёт хост Tavo, но поверх API таверны
const tavo = {
  async get(key, scope) {
    if (scope === 'global') return gstore()[key] != null ? gstore()[key] : null;
    const m = mstore(); return m && m[key] != null ? m[key] : null;
  },
  async set(key, val, scope) {
    if (scope === 'global') { gstore()[key] = val; try { saveSettingsDebounced(); } catch (e) {} }
    else { const m = mstore(); if (m) { m[key] = val; try { saveMetadataDebounced(); } catch (e) {} } }
  },
  file: {
    // «файлы»-мост храним в метаданных чата; инжект-влияние отправляем в промпт таверны
    save(name, val) {
      const m = mstore(); if (m) { m['file:' + name] = val; try { saveMetadataDebounced(); } catch (e) {} }
      if (name === 'pusya_bio_inject') {
        try { setExtensionPrompt('PUSYA_BIO', val || '', extension_prompt_types.IN_CHAT, 1, false, 'system'); } catch (e) {}
      }
    },
    async load(name) { const m = mstore(); return m && m['file:' + name] != null ? m['file:' + name] : null; }
  },
  message: {
    async count() { return (CTX().chat || []).length; },
    async find(range) {
      const chat = CTX().chat || [];
      const start = (Array.isArray(range) && range.length) ? range[0] : 0;
      return chat.slice(start).filter(function (mm) { return !mm.is_system; }).map(function (mm) {
        return { role: mm.is_user ? 'user' : 'assistant', content: mm.mes || '', characterId: mm.name };
      });
    }
  },
  chat: {
    async current() {
      const c = CTX();
      const ch = (c.characters && c.characterId != null) ? c.characters[c.characterId] : null;
      let personaDesc = '';
      try { personaDesc = (c.powerUserSettings && c.powerUserSettings.persona_description) || ''; } catch (e) {}
      return {
        characters: ch ? [{ id: ch.name, name: ch.name, description: ch.description, scenario: ch.scenario }] : [],
        persona: { name: c.name1, description: personaDesc }
      };
    }
  },
  memory: { async current() { return null; } },
  utils: { toast: function (m) { try { if (window.toastr) window.toastr.info(m, '', { timeOut: 1800 }); } catch (e) {} } },
  plugin: { on: function () {}, onInputAction: function () {}, onSidebarAction: function () {} }
};

// события таверны → оконные события, которые слушает ядро плашки
function pbMsg() { try { window.dispatchEvent(new CustomEvent('pusya-bio-msg')); } catch (e) {} }
function pbChat() { try { window.dispatchEvent(new CustomEvent('pusya-bio-chat')); } catch (e) {} }
try {
  ['MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_UPDATED']
    .forEach(function (k) { if (event_types[k]) eventSource.on(event_types[k], pbMsg); });
  // смена/загрузка чата — отдельным событием: ядро сбросит месяц календаря и перерисует
  if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, pbChat);
} catch (e) {}

/* ===================== НИЖЕ — ЯДРО ИЗ src/panel.js (авто) ===================== */

(async function () {
  'use strict';

  // ── ВШИТЫЙ прокси (production-домен проекта pusya-bio-proxy на Vercel) ──
  // Если у прокси другой домен — поменяй тут и пересобери (build.py).
  var PROXY_URL = 'https://pusya-bio-proxy.spletnik-meme-worker.workers.dev';
  var PB_VER = '1.8.0'; // подставляет сборщик (build.py / build_st.py)
  var CSS = "/* ── палитра тем: тёмная (по умолчанию), светлая, прозрачная ──\n   Нейтральные тона вынесены в переменные, потому что виджеты рисуются инлайн-стилями,\n   а var() в инлайн-стилях работает. Акцентные цвета фаз намеренно не темизируются. */\n#pb-root{\n  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\n  --pb-t1:#fbeef7; --pb-t2:#e6d4ec; --pb-t3:#cbb0d4; --pb-t4:#a890b0;\n  --pb-card:linear-gradient(150deg,rgba(40,28,42,0.34),rgba(28,20,32,0.22));\n  --pb-pop-bg:rgba(18,12,16,0.98);\n  --pb-pop-br:rgba(240,168,196,0.3);\n  --pb-input-bg:rgba(255,255,255,0.05);\n  --pb-fab-bg:rgba(30,20,26,0.6);\n  --pb-fab-fg:#f0a8c4; --pb-accent:#f0a8c4;\n  --pb-shadow:0 14px 44px rgba(0,0,0,0.6),0 0 18px rgba(240,168,196,0.12);\n  --pb-blur:blur(22px) saturate(160%);\n  --pb-c-blue:#8ab4e0; --pb-c-calm:#96aad6; --pb-c-amber:#f0c078; --pb-c-amber2:#f0b070; --pb-c-amber3:#f4c496; --pb-c-green:#86dca6; --pb-c-green2:#96d6b6; --pb-c-pink:#ee7e96; --pb-c-hot:#f25c84; --pb-c-heat:#e85a82; --pb-c-mens:#f08c92; --pb-c-rut:#c85050; --pb-c-ovu:#d68ce0; --pb-c-after:#c696d2; --pb-c-fade:#aa96c8; --pb-c-tri3:#f4b0c8; --pb-c-pp:#e0607a; --pb-c-due:#e85a6e;\n}\n#pb-root.pb-theme-light{\n  --pb-t1:#3d2b36; --pb-t2:#543d4b; --pb-t3:#7b6473; --pb-t4:#9d8794;\n  --pb-card:linear-gradient(150deg,rgba(255,255,255,0.78),rgba(255,244,249,0.55));\n  --pb-pop-bg:rgba(253,246,249,0.985);\n  --pb-pop-br:rgba(198,138,166,0.38);\n  --pb-input-bg:rgba(0,0,0,0.045);\n  --pb-fab-bg:rgba(255,250,252,0.88);\n  --pb-fab-fg:#c2557f; --pb-accent:#c2557f;\n  --pb-shadow:0 14px 44px rgba(120,80,100,0.22),0 0 18px rgba(198,138,166,0.16);\n  --pb-c-blue:#3f74ad; --pb-c-calm:#4a6aa8; --pb-c-amber:#9a6407; --pb-c-amber2:#99630a; --pb-c-amber3:#98651f; --pb-c-green:#2c8551; --pb-c-green2:#2f8560; --pb-c-pink:#c04a67; --pb-c-hot:#cf2f5e; --pb-c-heat:#c33a63; --pb-c-mens:#bf4650; --pb-c-rut:#a83535; --pb-c-ovu:#9a4fa8; --pb-c-after:#8e56a0; --pb-c-fade:#6d5a92; --pb-c-tri3:#b8577f; --pb-c-pp:#b83b57; --pb-c-due:#c3384c;\n}\n#pb-root.pb-theme-glass{\n  --pb-t1:#fff8fc; --pb-t2:#f2e6ee; --pb-t3:#ddcad8; --pb-t4:#bfaaba;\n  --pb-card:linear-gradient(150deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04));\n  --pb-pop-bg:rgba(28,20,26,0.42);\n  --pb-pop-br:rgba(255,255,255,0.24);\n  --pb-input-bg:rgba(255,255,255,0.12);\n  --pb-fab-bg:rgba(40,28,36,0.34);\n  --pb-fab-fg:#ffd9e8; --pb-accent:#ffd9e8;\n  --pb-shadow:0 14px 44px rgba(0,0,0,0.4);\n  --pb-blur:blur(26px) saturate(150%);\n}\n\n/* плавающий полупрозрачный кружок 🌸 (fixed, в родительском документе) */\n#pb-root .pb-fab{position:fixed;right:14px;bottom:92px;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:23px;line-height:1;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;border:1px solid rgba(240,168,196,0.4);background:var(--pb-fab-bg);color:var(--pb-fab-fg);opacity:.62;z-index:2147483000;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 4px 16px rgba(0,0,0,0.45);transition:opacity .2s,background .2s,box-shadow .2s;}\n#pb-root .pb-fab:hover{opacity:1;background:rgba(240,168,196,0.24);box-shadow:0 0 16px rgba(240,168,196,0.45);}\n#pb-root .pb-fab:active{cursor:grabbing;}\n#pb-root.open .pb-fab{opacity:1;background:rgba(240,168,196,0.28);}\n\n/* всплывающая плашка (fixed, над кружком) */\n#pb-root .pb-pop{position:fixed;right:12px;left:auto;bottom:124px;width:min(420px,calc(100vw - 24px));box-sizing:border-box;max-height:70vh;overflow:auto;z-index:2147483000;display:none;padding:11px 12px;border-radius:16px;border:1px solid var(--pb-pop-br);background:var(--pb-pop-bg);-webkit-backdrop-filter:var(--pb-blur);backdrop-filter:var(--pb-blur);box-shadow:var(--pb-shadow);animation:pb-pop-in .18s ease;}\n#pb-root.open .pb-pop{display:block;}\n@keyframes pb-pop-in{from{opacity:0;transform:translateY(8px) scale(.98);}to{opacity:1;transform:none;}}\n\n#pb-root .pb-pop-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px;}\n#pb-root .pb-tabs{display:flex;gap:3px;}\n#pb-root .pb-tab{background:none;border:none;color:var(--pb-t3);font-size:15px;cursor:pointer;padding:2px 7px;border-radius:9px;opacity:.5;transition:opacity .15s,background .15s;}\n#pb-root .pb-tab:hover{opacity:.85;}\n#pb-root .pb-tab.on{opacity:1;background:rgba(240,168,196,0.18);}\n#pb-root .pb-cal-day:hover{filter:brightness(1.25);}\n#pb-root.pb-theme-light .pb-cal-day:hover{filter:brightness(0.94);}\n#pb-root .pb-cal-act{font:inherit;font-size:10px;color:var(--pb-t2);background:rgba(240,168,196,0.14);border:1px solid rgba(240,168,196,0.28);border-radius:9px;padding:5px 9px;cursor:pointer;}\n#pb-root .pb-cal-act:hover{background:rgba(240,168,196,0.24);}\n#pb-root .pb-more-btn{text-align:center;font-size:10px;color:var(--pb-t2);opacity:.85;cursor:pointer;padding:7px 4px 3px;letter-spacing:.02em;user-select:none;-webkit-user-select:none;}\n#pb-root .pb-more-btn:hover{opacity:1;}\n#pb-root .pb-title{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--pb-t1);opacity:.9;}\n#pb-root .pb-tools{display:flex;align-items:center;gap:2px;}\n#pb-root .pb-tools button{background:none;border:none;color:var(--pb-t2);font-size:13px;cursor:pointer;opacity:.6;padding:2px 5px;border-radius:8px;transition:opacity .15s,transform .2s,background .15s;}\n#pb-root .pb-tools button:hover{opacity:1;background:rgba(240,168,196,0.14);}\n#pb-root .pb-refresh.spin{animation:pb-spin .9s linear infinite;opacity:1;}\n@keyframes pb-spin{to{transform:rotate(360deg);}}\n\n#pb-root .pb-cap{font-size:12px;color:var(--pb-t2);opacity:.8;padding:6px 2px;animation:pb-pulse 1.3s ease-in-out infinite;}\n#pb-root .pb-err{font-size:12px;color:#f0a0b4;padding:6px 2px;line-height:1.4;}\n#pb-root.pb-theme-light .pb-err{color:#c0405e;}\n@keyframes pb-pulse{0%,100%{opacity:.5;}50%{opacity:1;}}\n\n#pb-root .pb-widget{max-width:420px;margin:0 auto;}\n#pb-root .pb-widget details[open] .pb-arrow{transform:rotate(180deg);}\n#pb-root .pb-widget summary::-webkit-details-marker{display:none;}\n@keyframes pb-mpulse{0%,100%{box-shadow:0 0 8px currentColor;}50%{box-shadow:0 0 18px currentColor;}}\n\n/* форма настроек */\n#pb-root .pb-form{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--pb-t2);}\n#pb-root .pb-form label{opacity:.75;margin-top:6px;}\n#pb-root .pb-i{width:100%;box-sizing:border-box;background:var(--pb-input-bg);border:1px solid rgba(240,168,196,0.22);border-radius:8px;padding:7px 9px;color:var(--pb-t1);font:inherit;font-size:12px;outline:none;}\n#pb-root .pb-i:focus{border-color:rgba(240,168,196,0.5);}\n#pb-root .pb-form-btns{display:flex;gap:8px;margin-top:11px;}\n#pb-root .pb-save,#pb-root .pb-cancel{border:1px solid rgba(240,168,196,0.28);background:rgba(240,168,196,0.12);color:var(--pb-t1);font:inherit;font-size:12px;font-weight:600;padding:7px 13px;border-radius:10px;cursor:pointer;}\n#pb-root .pb-save:hover,#pb-root .pb-cancel:hover{background:rgba(240,168,196,0.2);}\n#pb-root .pb-hint{font-size:10px;color:var(--pb-t3);opacity:.7;line-height:1.35;margin-top:9px;}\n\n/* переключатель темы (сегментированный) */\n#pb-root .pb-themes{display:flex;gap:5px;margin-top:4px;}\n#pb-root .pb-th{flex:1;display:flex;align-items:center;justify-content:center;gap:4px;font:inherit;font-size:11px;color:var(--pb-t2);background:var(--pb-input-bg);border:1px solid rgba(240,168,196,0.22);border-radius:10px;padding:7px 6px;cursor:pointer;transition:background .15s,border-color .15s;}\n#pb-root .pb-th:hover{background:rgba(240,168,196,0.14);}\n#pb-root .pb-th.on{background:rgba(240,168,196,0.2);border-color:rgba(240,168,196,0.55);color:var(--pb-t1);font-weight:600;}"; // стили инжектятся в родительский документ (build.py подставит)
  var MARKUP =
    '<button class="pb-fab" type="button" title="цикл и беременность">🌸</button>' +
    '<div class="pb-pop">' +
    '<div class="pb-pop-head"><span class="pb-tabs">' +
    '<button class="pb-tab" data-v="panel" type="button" title="состояние">🌸</button>' +
    '<button class="pb-tab" data-v="cal" type="button" title="календарь">📅</button></span>' +
    '<span class="pb-tools">' +
    '<button class="pb-refresh" type="button" title="пересчитать">⟳</button>' +
    '<button class="pb-gear" type="button" title="настройки">⚙</button>' +
    '<button class="pb-close" type="button" title="закрыть">✕</button></span></div>' +
    '<div class="pb-out"></div></div>';

  // ── plugin-фрагмент как diary: рисуем UI в РОДИТЕЛЬСКИЙ документ (fixed-оверлей) ──
  var pdoc = document, pwin = window;
  try { var _fe = window.frameElement; if (_fe && _fe.ownerDocument) { pdoc = _fe.ownerDocument; pwin = pdoc.defaultView || window; } } catch (e) {}
  var ROOT_ID = 'pb-root', CSS_ID = 'pb-css';
  var GEN = ((pwin.__PB_GEN || 0) + 1); try { pwin.__PB_GEN = GEN; } catch (e) {}
  function alive() { try { return pwin.__PB_GEN === GEN; } catch (e) { return true; } }
  (function () { var o = pdoc.getElementById(ROOT_ID); if (o && o.parentNode) o.parentNode.removeChild(o); var c = pdoc.getElementById(CSS_ID); if (c && c.parentNode) c.parentNode.removeChild(c); })();
  var styleEl = pdoc.createElement('style'); styleEl.id = CSS_ID; styleEl.textContent = CSS; (pdoc.head || pdoc.documentElement).appendChild(styleEl);
  var root = pdoc.createElement('div'); root.id = ROOT_ID; root.innerHTML = MARKUP; pdoc.body.appendChild(root);

  var CFG_KEY = 'pusya_bio_cfg';   // global: {providerUrl, apiKey, model, everyN}
  var ST_KEY = 'pusya_bio_state';  // chat:   {fields, count}

  var fab = root.querySelector('.pb-fab');
  var pop = root.querySelector('.pb-pop');
  var out = root.querySelector('.pb-out');
  var refBtn = root.querySelector('.pb-refresh');
  var gearBtn = root.querySelector('.pb-gear');
  var closeBtn = root.querySelector('.pb-close');
  // критичные стили кружка инлайном + !important — чтобы был виден даже если внешний CSS не подхватился/перекрыт (мобильные)
  try {
    fab.style.cssText += ';right:14px;bottom:92px;width:44px;height:44px;border-radius:50%;align-items:center;justify-content:center;font-size:23px;line-height:1;background:var(--pb-fab-bg,rgba(30,20,26,0.82));color:var(--pb-fab-fg,#f0a8c4);border:1px solid rgba(240,168,196,0.5);cursor:grab;touch-action:none;';
    fab.style.setProperty('position', 'fixed', 'important');
    fab.style.setProperty('display', 'flex', 'important');
    fab.style.setProperty('visibility', 'visible', 'important');
    fab.style.setProperty('opacity', '1', 'important');
    fab.style.setProperty('z-index', '2147483000', 'important');
  } catch (e) {}

  var INJECT_FILE = 'pusya_bio_inject'; // мост к плагину: он дописывает это в промпт модели
  var cfg = (await tavo.get(CFG_KEY, 'global')) || {};
  function everyN() { var n = parseInt(cfg.everyN, 10); return (n >= 1 ? n : 3); }
  function configured() { return !!(cfg.providerUrl && cfg.apiKey && cfg.model); }
  function mode() { return cfg.mode === 'omega' ? 'omega' : 'classic'; }
  function dyn() { return (cfg.dynamic === 'alpha' || cfg.dynamic === 'beta') ? cfg.dynamic : 'omega'; }
  function theme() { return (cfg.theme === 'light' || cfg.theme === 'glass') ? cfg.theme : 'dark'; }
  function applyTheme() {
    try {
      root.classList.remove('pb-theme-light', 'pb-theme-glass');
      var t = theme(); if (t !== 'dark') root.classList.add('pb-theme-' + t);
    } catch (e) {}
  }
  applyTheme();

  /* ── журнал диагностики: последние события/ошибки, чтобы юзер мог прислать отчёт ── */
  var DIAG_KEY = 'pusya_bio_diag';
  var diag = (await tavo.get(DIAG_KEY, 'global')) || [];
  if (!Array.isArray(diag)) diag = [];
  function redact(s) { // ключ в отчёт попасть не должен
    s = String(s == null ? '' : s);
    try { var k = cfg.apiKey; if (k && String(k).length > 6) s = s.split(String(k)).join('«КЛЮЧ»'); } catch (e) {}
    return s.replace(/sk-[A-Za-z0-9_\-]{6,}/g, 'sk-«скрыт»').replace(/Bearer\s+[A-Za-z0-9_\-.]{6,}/gi, 'Bearer «скрыт»');
  }
  function diagPush(kind, msg) {
    try {
      var t = new Date(); function p2(n) { return (n < 10 ? '0' : '') + n; }
      diag.push({ t: p2(t.getHours()) + ':' + p2(t.getMinutes()) + ':' + p2(t.getSeconds()), kind: kind, msg: redact(msg).slice(0, 600) });
      if (diag.length > 12) diag = diag.slice(-12);
      tavo.set(DIAG_KEY, diag, 'global');
    } catch (e) {}
  }
  function diagReport() {
    var host = '—'; try { host = String(cfg.providerUrl || '').replace(/^https?:\/\//, '').split('/')[0] || '—'; } catch (e) {}
    var plat = 'Tavo'; try { if (typeof SillyTavern !== 'undefined') plat = 'SillyTavern'; } catch (e) {}
    var L = [
      '=== ОТЧЁТ · Цикл и беременность ===',
      'версия: ' + PB_VER + '  |  платформа: ' + plat,
      'провайдер: ' + host + '  |  модель: ' + (cfg.model || '—'),
      'ключ задан: ' + (cfg.apiKey ? 'да' : 'НЕТ') + '  |  режим: ' + mode() + (mode() === 'omega' ? ' / ' + dyn() : ''),
      'пересчёт раз в: ' + everyN() + '  |  влияние на РП: ' + (cfg.injectRP === false ? 'выкл' : 'вкл'),
      'экран: ' + (pwin.innerWidth || '?') + 'x' + (pwin.innerHeight || '?'),
      '',
      '--- последние события (новые снизу) ---'
    ];
    if (!diag.length) L.push('(пусто — ещё ничего не считалось)');
    diag.forEach(function (d) { L.push('[' + d.t + '] ' + d.kind + ': ' + d.msg); });
    return L.join('\n');
  }
  async function copyText(t) {
    try { if (pwin.navigator && pwin.navigator.clipboard) { await pwin.navigator.clipboard.writeText(t); return true; } } catch (e) {}
    try {
      var ta = pdoc.createElement('textarea'); ta.value = t;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      pdoc.body.appendChild(ta); ta.focus(); ta.select();
      var ok = pdoc.execCommand('copy'); ta.parentNode.removeChild(ta); return !!ok;
    } catch (e) { return false; }
  }

  var charName = '';
  try { var _cc = await tavo.chat.current(); charName = (_cc && _cc.characters && _cc.characters[0] && _cc.characters[0].name) || ''; } catch (e) {}

  function toast(m) { try { if (tavo.utils && tavo.utils.toast) tavo.utils.toast(m); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function num(v, d) { var n = parseInt(v, 10); return isNaN(n) ? d : n; }

  function energyColorOf(e) { return e === 'Низкая' ? 'var(--pb-c-blue)' : e === 'Умеренная' ? 'var(--pb-c-amber)' : e === 'Высокая' ? 'var(--pb-c-pink)' : 'var(--pb-c-hot)'; }
  function softRow(icon, color, text) { return text ? '<div style="margin-bottom:7px;font-size:8.5px;color:var(--pb-t3);line-height:1.4;"><span style="color:' + color + ';">' + icon + '</span> ' + esc(text) + '</div>' : ''; }
  function careTipRow(text) { return text ? '<div style="margin-bottom:7px;"><div style="background:rgba(var(--ac),0.09);border-radius:10px;padding:8px 10px;border:1px solid rgba(var(--ac),0.16);"><div style="font-size:9px;color:var(--pb-t2);line-height:1.4;"><span style="color:var(--pb-accent,#f0a8c4);">🤍 рядом:</span> ' + esc(text) + '</div></div></div>' : ''; }
  var moreOpen = false; // детали свёрнуты по умолчанию
  function moreBlock(inner) {
    if (!inner || !inner.replace(/\s/g, '')) return '';
    return '<div class="pb-more-btn">' + (moreOpen ? '− свернуть' : '＋ подробнее') + '</div><div class="pb-more" style="' + (moreOpen ? '' : 'display:none;') + '">' + inner + '</div>';
  }
  function colorLevel(pct) { var n = num(pct, 0); return n >= 80 ? 'var(--pb-c-hot)' : n >= 55 ? 'var(--pb-c-pink)' : n >= 30 ? 'var(--pb-c-amber)' : 'var(--pb-c-blue)'; }
  function insightRow(t) { return t ? '<div style="margin-bottom:7px;"><div style="background:rgba(var(--ac),0.07);border-radius:10px;padding:8px 10px;border:1px solid rgba(var(--ac),0.14);"><div style="font-size:9px;color:var(--pb-t2);line-height:1.45;font-style:italic;">🧠 ' + esc(t) + '</div></div></div>' : ''; }
  function footRow(mood) { if (!mood) return ''; return '<div style="display:flex;align-items:center;gap:8px;padding-top:7px;margin-top:7px;border-top:1px solid rgba(var(--ac),0.12);"><span style="font-size:7.5px;color:var(--pb-t4);">влияние:</span><span style="background:rgba(var(--ac),0.12);padding:3px 8px;border-radius:11px;font-size:9px;color:var(--pb-t2);">' + esc(String(mood).replace(/[\[\]]/g, '')) + '</span></div>'; }

  // общий рендер фазовой плашки (для течки/гона)
  function phaseWidget(o) {
    var p = o.PH[o.phase] || o.PH[Object.keys(o.PH)[0]];
    var th = '', lb = '';
    o.segs.forEach(function (s) {
      var w = Math.max(0, (s[2] - s[1]) * 100), pc = o.PH[s[0]], on = (s[0] === o.phase);
      th += '<div style="width:' + w + '%;height:100%;background:rgba(' + pc[0] + ',' + (on ? 0.95 : 0.4) + ');box-shadow:' + (on ? '0 0 10px rgba(' + pc[0] + ',0.9)' : 'none') + ';"></div>';
      lb += '<span style="width:' + w + '%;text-align:center;color:' + (on ? pc[2] : 'var(--pb-t4)') + ';opacity:' + (on ? 1 : 0.6) + ';">' + pc[3] + '</span>';
    });
    var pos = Math.max(0, Math.min(100, o.markerFrac * 100));
    var cells = o.cells.map(function (c) { return '<div style="flex:1;min-width:0;background:rgba(var(--ac),0.08);border-radius:10px;padding:7px 3px;text-align:center;border:1px solid rgba(var(--ac),0.14);"><div style="font-size:6.5px;color:var(--pb-t3);margin-bottom:2px;">' + c[0] + ' ' + c[1] + '</div><div style="font-size:8px;font-weight:700;color:' + c[3] + ';line-height:1.15;">' + esc(c[2]) + '</div></div>'; }).join('');
    return '<div class="pb-widget" style="--ac:' + p[0] + ';--hex:' + p[2] + ';--soft:' + p[1] + ';">' +
      '<details open class="pbc" style="border-radius:22px;overflow:hidden;position:relative;background:var(--pb-card);border:1px solid rgba(var(--ac),0.28);box-shadow:0 8px 32px rgba(0,0,0,0.4),0 0 22px rgba(var(--ac),0.14),inset 0 1px 0 rgba(255,255,255,0.09);">' +
      '<div style="position:absolute;inset:0;pointer-events:none;z-index:1;background:radial-gradient(130% 100% at 100% 0%, rgba(var(--ac),0.32), transparent 60%);"></div>' +
      '<summary style="cursor:pointer;list-style:none;outline:none;position:relative;z-index:4;"><div style="padding:12px 15px;display:flex;align-items:center;gap:11px;border-bottom:1px solid rgba(var(--ac),0.14);">' +
      '<div style="width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 32% 28%,rgba(var(--ac),0.5),rgba(var(--ac),0.12));display:flex;align-items:center;justify-content:center;font-size:16px;border:1px solid rgba(var(--ac),0.45);box-shadow:0 0 16px rgba(var(--ac),0.45);flex-shrink:0;">' + p[3] + '</div>' +
      '<div style="flex:1;min-width:0;"><div style="font-size:10px;font-weight:700;color:var(--pb-t1);">' + o.title + '</div><div style="display:flex;align-items:center;gap:6px;margin-top:2px;"><span style="font-size:8px;font-weight:700;color:' + p[2] + ';">' + esc(o.phase) + '</span><span style="font-size:8px;color:var(--pb-t3);">' + o.sub + '</span></div></div>' +
      '<span class="pb-arrow" style="font-size:10px;color:' + p[2] + ';transition:transform .3s;flex-shrink:0;">▼</span></div></summary>' +
      '<div style="padding:14px 16px 11px;position:relative;z-index:4;">' +
      '<div style="position:relative;height:30px;margin-bottom:5px;"><div style="position:absolute;left:0;right:0;top:11px;height:6px;border-radius:6px;overflow:hidden;display:flex;box-shadow:0 0 12px rgba(var(--ac),0.3);">' + th + '</div>' +
      '<div style="position:absolute;top:6px;width:16px;height:16px;border-radius:50%;transform:translateX(-50%);border:2px solid rgba(255,255,255,0.75);animation:pb-mpulse 2.8s ease-in-out infinite;z-index:2;left:' + pos + '%;background:radial-gradient(circle,' + p[2] + ',rgba(0,0,0,0.15));color:' + p[2] + ';"></div></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:6.5px;margin-bottom:11px;">' + lb + '</div>' +
      '<div style="display:flex;gap:5px;margin-bottom:9px;">' + cells + '</div>' +
      moreBlock(o.rows.join('') + (o.foot || '')) + '</div></details></div>';
  }

  function resetPhaseFields(f, keys) { for (var i = 0; i < keys.length; i++) { f[keys[i]] = null; } }
  function deriveHeat(f) {
    var length = num(f.length, 28); if (length < 8 || length > 400) length = 28; f.length = length;
    var day = num(f.day, 1); if (day < 1) day = 1; if (day > length) day = length; f.day = day;
    var fr = day / length;
    var canon = fr < 0.6 ? 'Покой' : fr < 0.72 ? 'Предтечка' : fr < 0.88 ? 'Течка' : 'Послетечка';
    if (f.phase && f.phase !== canon) resetPhaseFields(f, ['slick', 'slick_pct', 'fertility', 'fertility_pct', 'pheromones', 'pheromones_pct', 'need_alpha', 'need_alpha_pct', 'symptoms', 'insight', 'care_tip', 'fact', 'moodlet', 'avoid', 'selfcare']);
    f.phase = canon;
    if (f.days_until_next == null) f.days_until_next = Math.max(0, length - day);
    var heat = f.phase === 'Течка', pre = f.phase === 'Предтечка';
    if (!f.slick) f.slick = heat ? 'Обильная' : pre ? 'Умеренная' : 'Нет';
    if (f.slick_pct == null) f.slick_pct = heat ? 90 : pre ? 55 : 8;
    if (!f.fertility) f.fertility = heat ? 'Пик' : pre ? 'Высокая' : 'Низкая';
    if (f.fertility_pct == null) f.fertility_pct = heat ? 95 : pre ? 70 : 12;
    if (!f.pheromones) f.pheromones = heat ? 'Пик' : pre ? 'Сильные' : 'Слабые';
    if (f.pheromones_pct == null) f.pheromones_pct = heat ? 95 : pre ? 70 : 20;
    if (!f.need_alpha) f.need_alpha = heat ? 'Пик' : pre ? 'Высокая' : 'Низкая';
    if (f.need_alpha_pct == null) f.need_alpha_pct = heat ? 96 : pre ? 68 : 15;
    if (f.bond == null) f.bond = ''; // не выдумываем «Без пары»: пусто → строка не показывается
    if (!f.symptoms) f.symptoms = { 'Покой': 'спокойствие, ровный запах', 'Предтечка': 'жар, беспокойство, запах усиливается', 'Течка': 'сильный жар, обильная слизь, острая нужда', 'Послетечка': 'усталость, нежность, спад' }[f.phase] || '';
    if (!f.insight) f.insight = { 'Покой': 'Тело спокойно, запах ровный — передышка.', 'Предтечка': 'Жар нарастает, всё сильнее тянет к альфе.', 'Течка': 'Пик течки: тело зовёт, нужен альфа рядом.', 'Послетечка': 'Спад и нежность, хочется тепла и покоя.' }[f.phase] || '';
    if (!f.care_tip) f.care_tip = { 'Покой': 'Просто будьте рядом.', 'Предтечка': 'Рядом успокаивают присутствие и запах партнёра.', 'Течка': 'Нужен партнёр рядом: тепло, близость, надёжность.', 'Послетечка': 'Обнять и дать отдохнуть — тело измотано.' }[f.phase] || '';
    if (!f.fact) f.fact = { 'Покой': 'Запах омеги сейчас почти незаметный.', 'Предтечка': 'За пару дней до течки запах усиливается — альфа чует первым.', 'Течка': 'В пик течки феромоны действуют на альф сильнее всего.', 'Послетечка': 'После течки телу нужно восстановление и близость.' }[f.phase] || '';
    if (!f.moodlet) f.moodlet = { 'Покой': '[ровно]', 'Предтечка': '[томление]', 'Течка': '[жар]', 'Послетечка': '[нежность]' }[f.phase] || '';
    if (!f.avoid) f.avoid = { 'Покой': '', 'Предтечка': 'людные места без альфы, стресс', 'Течка': 'оставаться в одиночестве, чужих альф', 'Послетечка': 'перегруз, холод' }[f.phase] || '';
    if (!f.selfcare) f.selfcare = { 'Покой': 'обычный режим', 'Предтечка': 'супрессанты по плану, близость альфы', 'Течка': 'вода, прохлада, альфа рядом, гнездо', 'Послетечка': 'сон, тепло, забота' }[f.phase] || '';
    return f;
  }
  function deriveRut(f) {
    var length = num(f.length, 28); if (length < 8 || length > 400) length = 28; f.length = length;
    var day = num(f.day, 1); if (day < 1) day = 1; if (day > length) day = length; f.day = day;
    var fr = day / length;
    var canon = fr < 0.6 ? 'Покой' : fr < 0.72 ? 'Предгон' : fr < 0.88 ? 'Гон' : 'Спад';
    if (f.phase && f.phase !== canon) resetPhaseFields(f, ['dominance', 'dominance_pct', 'knot', 'knot_pct', 'pheromones', 'pheromones_pct', 'symptoms', 'insight', 'care_tip', 'fact', 'moodlet', 'avoid', 'selfcare']);
    f.phase = canon;
    if (f.days_until_next == null) f.days_until_next = Math.max(0, length - day);
    var g = f.phase === 'Гон', pre = f.phase === 'Предгон';
    if (!f.dominance) f.dominance = g ? 'Пик' : pre ? 'Высокая' : 'Средняя';
    if (f.dominance_pct == null) f.dominance_pct = g ? 95 : pre ? 70 : 40;
    if (!f.knot) f.knot = g ? 'Готов' : pre ? 'Набухает' : 'Не готов';
    if (f.knot_pct == null) f.knot_pct = g ? 92 : pre ? 55 : 10;
    if (!f.pheromones) f.pheromones = g ? 'Пик' : pre ? 'Сильные' : 'Умеренные';
    if (f.pheromones_pct == null) f.pheromones_pct = g ? 95 : pre ? 70 : 35;
    if (!f.trigger) f.trigger = 'Нет';
    if (f.bond == null) f.bond = ''; // не выдумываем «Без пары»: пусто → строка не показывается
    if (!f.symptoms) f.symptoms = { 'Покой': 'ровное состояние', 'Предгон': 'раздражительность, растёт напряжение', 'Гон': 'агрессия, гиперфокус, сильный запах', 'Спад': 'утомление, расслабление' }[f.phase] || '';
    if (!f.insight) f.insight = { 'Покой': 'Спокоен и собран, гон далеко.', 'Предгон': 'Напряжение растёт, тянет доминировать.', 'Гон': 'Пик гона: тело требует, инстинкты на максимуме.', 'Спад': 'Гон отпускает, приходит усталость.' }[f.phase] || '';
    if (!f.care_tip) f.care_tip = { 'Покой': 'Всё ровно — просто будьте рядом.', 'Предгон': 'Дай пространство и опору.', 'Гон': 'Нужна разрядка и близость — будь рядом или дай остыть.', 'Спад': 'Тепло и тишина помогут восстановиться.' }[f.phase] || '';
    if (!f.fact) f.fact = { 'Покой': 'Запах альфы сейчас ровный.', 'Предгон': 'Близкая течка омеги может спровоцировать гон раньше.', 'Гон': 'В гоне узел набухает сильнее и держится дольше.', 'Спад': 'После гона телу нужен отдых.' }[f.phase] || '';
    if (!f.moodlet) f.moodlet = { 'Покой': '[ровно]', 'Предгон': '[напряжение]', 'Гон': '[ярость]', 'Спад': '[усталость]' }[f.phase] || '';
    if (!f.avoid) f.avoid = { 'Покой': '', 'Предгон': 'провокации, чужих альф', 'Гон': 'толпу, конфликты, оставаться без разрядки', 'Спад': 'перегруз' }[f.phase] || '';
    if (!f.selfcare) f.selfcare = { 'Покой': 'обычный режим', 'Предгон': 'спорт, разрядка напряжения', 'Гон': 'близость, физнагрузка, омега рядом', 'Спад': 'сон, тишина, еда' }[f.phase] || '';
    return f;
  }

  function heatHtml(f) {
    deriveHeat(f);
    var PH = { 'Покой': ['150,170,214', '188,200,234', 'var(--pb-c-calm)', '🌙'], 'Предтечка': ['236,176,108', '248,206,158', 'var(--pb-c-amber2)', '🌡'], 'Течка': ['232,90,130', '244,150,180', 'var(--pb-c-heat)', '🔥'], 'Послетечка': ['198,150,210', '230,190,230', 'var(--pb-c-after)', '💗'] };
    var rows = [];
    if (f.nesting && f.nesting !== '—') rows.push(softRow('🪺 гнездо:', 'var(--pb-c-heat)', f.nesting));
    if (f.symptoms) rows.push(softRow('●', 'var(--pb-c-heat)', f.symptoms));
    if (f.bond) rows.push(softRow('🔗 связь:', 'var(--pb-c-heat)', f.bond + (f.suppressants === 'Да' ? ' · на супрессантах' : '')));
    if (f.cravings) rows.push(softRow('🍫 хочется:', 'var(--pb-c-heat)', f.cravings));
    if (f.fact) rows.push(softRow('✨', 'var(--pb-c-heat)', f.fact));
    if (f.avoid) rows.push(softRow('⚠️ избегать:', 'var(--pb-c-heat)', f.avoid));
    if (f.selfcare) rows.push(softRow('🛁 поможет:', 'var(--pb-c-heat)', f.selfcare));
    if (f.care_tip) rows.push(careTipRow(f.care_tip));
    if (f.insight) rows.push(insightRow(f.insight));
    return phaseWidget({
      title: 'Цикл течки · День ' + esc(f.day), sub: '· ' + esc(f.days_until_next) + ' дн до след.', PH: PH, phase: f.phase,
      segs: [['Покой', 0, 0.6], ['Предтечка', 0.6, 0.72], ['Течка', 0.72, 0.88], ['Послетечка', 0.88, 1]],
      markerFrac: f.day / f.length,
      cells: [['💧', 'Слизь', f.slick, colorLevel(f.slick_pct)], ['🌡', 'Фертильн.', f.fertility, colorLevel(f.fertility_pct)], ['🩸', 'Феромоны', f.pheromones, colorLevel(f.pheromones_pct)], ['🔥', 'Тяга', f.need_alpha, colorLevel(f.need_alpha_pct)]],
      rows: rows, foot: footRow(f.moodlet)
    });
  }
  function rutHtml(f) {
    deriveRut(f);
    var PH = { 'Покой': ['150,170,214', '188,200,234', 'var(--pb-c-calm)', '🌙'], 'Предгон': ['236,176,108', '248,206,158', 'var(--pb-c-amber2)', '⚡'], 'Гон': ['200,80,80', '236,140,140', 'var(--pb-c-rut)', '🐺'], 'Спад': ['170,150,200', '210,190,230', 'var(--pb-c-fade)', '🌫'] };
    var rows = [];
    if (f.symptoms) rows.push(softRow('●', 'var(--pb-c-rut)', f.symptoms));
    if (f.bond) rows.push(softRow('🔗 связь:', 'var(--pb-c-rut)', f.bond + (f.suppressants === 'Да' ? ' · на супрессантах' : '')));
    if (f.fact) rows.push(softRow('✨', 'var(--pb-c-rut)', f.fact));
    if (f.avoid) rows.push(softRow('⚠️ избегать:', 'var(--pb-c-rut)', f.avoid));
    if (f.selfcare) rows.push(softRow('🛁 поможет:', 'var(--pb-c-rut)', f.selfcare));
    if (f.care_tip) rows.push(careTipRow(f.care_tip));
    if (f.insight) rows.push(insightRow(f.insight));
    var trigC = f.trigger === 'Сильный' ? 'var(--pb-c-hot)' : f.trigger === 'Слабый' ? 'var(--pb-c-amber)' : 'var(--pb-c-blue)';
    return phaseWidget({
      title: 'Цикл гона · День ' + esc(f.day), sub: '· ' + esc(f.days_until_next) + ' дн до след.', PH: PH, phase: f.phase,
      segs: [['Покой', 0, 0.6], ['Предгон', 0.6, 0.72], ['Гон', 0.72, 0.88], ['Спад', 0.88, 1]],
      markerFrac: f.day / f.length,
      cells: [['💪', 'Домин.', f.dominance, colorLevel(f.dominance_pct)], ['🍑', 'Узел', f.knot, colorLevel(f.knot_pct)], ['🩸', 'Феромоны', f.pheromones, colorLevel(f.pheromones_pct)], ['⚡', 'Триггер', f.trigger, trigC]],
      rows: rows, foot: footRow(f.moodlet)
    });
  }

  /* ====================================================================== */
  var SYSTEM_CLASSIC = [
    'You are a silent biological-state tracker for a roleplay character (a woman). You never roleplay, never address the user, never write story prose. You only read the scene and output a compact status block.',
    '',
    'Decide the female lead\'s current reproductive state from the material given:',
    '  - "pregnancy" — if she is pregnant in the story (any trimester);',
    '  - "postpartum" — if she has GIVEN BIRTH recently and is in the recovery/bleeding (lochia) period (roughly the first 6 weeks after birth);',
    '  - "cycle" — if she is not pregnant and not postpartum: track her menstrual cycle;',
    '  - "none" — only if there is genuinely no basis. When unsure between cycle and none, prefer "cycle" with a plausible day.',
    'Transitions: when the baby is born, switch pregnancy → postpartum (pp_day 1). When the postpartum recovery is over (bleeding stopped, ~6 weeks), switch postpartum → cycle.',
    '',
    'Advance the state realistically over time. The "Last known state" is authoritative for what was already established; move it FORWARD by whatever time passed in the recent messages (explicit timeskips like "прошло 2 дня", "спустя неделю", "на следующее утро", or an obvious pregnancy progressing). Do NOT reset or contradict an established pregnancy or cycle day unless the story explicitly does so.',
    '',
    'Output ONLY key: value lines, one per line, no preamble, no markdown, no code fences. First line MUST be the state.',
    'Also ALWAYS include one line "date: YYYY-MM-DD" — the current in-story date inferred from the story (keep the story\'s own year).',
    '',
    'If state = none, output exactly one line: "state: none".',
    '',
    'If state = cycle, output these keys (numbers only, no units):',
    '  state: cycle',
    '  day: <1..length>',
    '  length: <cycle length, usually 26-32>',
    '  phase: <Менструальная|Фолликулярная|Овуляция|Лютеиновая>',
    '  days_until_next: <int>',
    '  days_until_ovulation: <int>',
    '  fertility: <Низкая|Средняя|Высокая>',
    '  fertility_pct: <0..100>',
    '  pregnancy_risk: <Низкий|Средний|Высокий|Критический>',
    '  libido: <Низкое|Умеренное|Высокое|Пик>',
    '  libido_pct: <0..100>',
    '  symptoms: <short phrase of current bodily symptoms>',
    '  moodlet: <one short mood tag in [square brackets]>',
    '  insight: <one warm intimate sentence about her state right now>',
    '  chemistry_boost: <like +12% or -5%>',
    '  energy: <Низкая|Умеренная|Высокая|Пик>',
    '  energy_pct: <0..100>',
    '  cravings: <what she craves now: a food, closeness, solitude — short>',
    '  care_tip: <one short line to her partner on how best to be with her right now, warm>',
    '  fact: <one short cute or informative fact about this cycle phase>',
    '  avoid: <what to avoid right now, short>',
    '  selfcare: <what would help her feel better now, short>',
    '',
    'If state = pregnancy, output these keys:',
    '  state: pregnancy',
    '  week: <1..40>',
    '  day: <0..6, day within the current week>',
    '  trimester: <1|2|3>',
    '  due: <due date text if known, else ETA like "через 18 нед">',
    '  days_left: <int days to due>',
    '  baby_size: <fruit/object comparison, e.g. "манго">',
    '  baby_weight: <e.g. "~300 г">',
    '  activity: <what the baby is doing, short>',
    '  symptoms: <short phrase of current symptoms>',
    '  weight_gain: <e.g. "+6 кг">',
    '  milestone: <next milestone, short>',
    '  milestone_days: <int days to that milestone, or 0 if today>',
    '  insight: <one warm intimate sentence about her pregnancy right now>',
    '  moodlet: <one short mood tag in [square brackets]>',
    '  attachment_boost: <like +10%>',
    '  energy: <Низкая|Умеренная|Высокая|Пик>',
    '  energy_pct: <0..100>',
    '  cravings: <what she craves now, short>',
    '  care_tip: <one short line to her partner on how best to be with her right now, warm>',
    '  fact: <one short cute fact about this pregnancy week>',
    '  avoid: <what to avoid right now, short>',
    '  selfcare: <what would help her feel better now, short>',
    'For pregnancy, make symptoms/activity SPECIFIC to the actual week (e.g. morning sickness & fatigue early; quickening ~18-20 нед; heartburn, swelling, Braxton-Hicks late), not generic.',
    '',
    'If state = postpartum, output these keys:',
    '  state: postpartum',
    '  pp_day: <int, days since birth, starting at 1>',
    '  pp_total: <int, expected total days of lochia/recovery, ~42>',
    '  lochia: <Обильные|Умеренные|Мажущие|Прошли>  (postpartum bleeding intensity)',
    '  bleeding_pct: <0..100>',
    '  lactation: <Молозиво|Приходит молоко|Налаженная лактация|Нет>',
    '  recovery: <short phrase for the recovery stage>',
    '  symptoms: <short phrase of current postpartum bodily symptoms>',
    '  moodlet: <one short mood tag in [square brackets]>',
    '  insight: <one warm intimate sentence about her recovery right now>',
    '  energy: <Низкая|Умеренная|Высокая|Пик>',
    '  energy_pct: <0..100>',
    '  cravings: <what she needs/craves now, short>',
    '  care_tip: <one short warm line to her partner on how to support her now>',
    '  fact: <one short informative fact about this postpartum stage>',
    '  avoid: <what to avoid right now, short>',
    '  selfcare: <what would help her recover now, short>',
    '',
    'All free-text values MUST be in the SAME language as the transcript (Russian if the transcript is Russian). Keep them short. Be medically plausible and consistent with the numbers.'
  ].join('\n');

  var SYSTEM_OMEGA = [
    'You are a silent biological-state tracker for a roleplay character in an OMEGAVERSE (A/B/O) setting. The character is an OMEGA. You never roleplay, never address the user, never write prose. Output only a compact status block.',
    '',
    'Decide state: "pregnancy" if the omega is pregnant; "postpartum" if the omega recently GAVE BIRTH and is in the recovery/bleeding (lochia) period (~first 6 weeks); otherwise "heat" (track the heat cycle). Transitions: birth → postpartum (pp_day 1); recovery over (~6 weeks) → heat. Advance realistically over time, carry the Last known state forward, respect timeskips.',
    'Output ONLY key: value lines, first line = state, no markdown, no code fences. ALWAYS also include a line "date: YYYY-MM-DD" — the current in-story date (keep the story\'s own year).',
    '',
    'If state = heat, output (numbers only, no units):',
    '  state: heat',
    '  day: <1..length>',
    '  length: <heat-cycle length in days; if unclear use ~28>',
    '  phase: <Покой|Предтечка|Течка|Послетечка>',
    '  days_until_next: <int>',
    '  days_until_peak: <int>',
    '  slick: <Нет|Лёгкая|Умеренная|Обильная>',
    '  slick_pct: <0..100>',
    '  fertility: <Низкая|Средняя|Высокая|Пик>',
    '  fertility_pct: <0..100>',
    '  pheromones: <Слабые|Умеренные|Сильные|Пик>',
    '  pheromones_pct: <0..100>',
    '  need_alpha: <Низкая|Средняя|Высокая|Пик>',
    '  need_alpha_pct: <0..100>',
    '  nesting: <short phrase on nesting urge/behaviour, or —>',
    '  bond: <Без пары|Помечена|True mate>  — infer from the character card/story: if the character is married, mated, or has an established partner/spouse, output "Помечена" (or "True mate" for a soul-bonded/destined pair). Use "Без пары" ONLY if the character is clearly single. If truly unknown, omit this line.',
    '  suppressants: <Да|Нет>',
    '  symptoms: <short>',
    '  moodlet: <one short mood tag in [brackets]>',
    '  insight: <one warm intimate sentence>',
    '  care_tip: <one short line to her alpha/partner>',
    '  fact: <one short omegaverse fact about this phase>',
    '  avoid: <what to avoid right now, short>',
    '  selfcare: <what would help right now, short>',
    '',
    'If state = pregnancy, output the pregnancy keys (use OMEGAVERSE terms in free text — pup(s), knotting/knot conception, nest). Make symptoms/activity SPECIFIC to the actual week, not generic:',
    '  state: pregnancy | week | day | trimester | due | days_left | baby_size | baby_weight | activity | symptoms | weight_gain | milestone | milestone_days | insight | moodlet | attachment_boost | energy | energy_pct | cravings | care_tip | fact | avoid | selfcare',
    '',
    'If state = postpartum, output these keys (omegaverse terms ok — pup, nest):',
    '  state: postpartum | pp_day (days since birth, from 1) | pp_total (~42) | lochia <Обильные|Умеренные|Мажущие|Прошли> | bleeding_pct | lactation <Молозиво|Приходит молоко|Налаженная лактация|Нет> | recovery | symptoms | moodlet | insight | energy | energy_pct | cravings | care_tip | fact | avoid | selfcare',
    '',
    'All free-text in the transcript language (Russian). Keep short and consistent with the numbers.'
  ].join('\n');

  var SYSTEM_ALPHA = [
    'You are a silent biological-state tracker for a roleplay character in an OMEGAVERSE (A/B/O) setting. The character is an ALPHA. You never roleplay or address the user. Output only a compact status block. Alphas do NOT get pregnant — never output pregnancy.',
    '',
    'Track the RUT cycle. Advance realistically, carry Last known state forward, respect timeskips. Output ONLY key: value lines, first line = state. ALWAYS also include a line "date: YYYY-MM-DD" — the current in-story date (keep the story\'s own year).',
    '',
    '  state: rut',
    '  day: <1..length>',
    '  length: <rut-cycle length in days; if unclear use ~28>',
    '  phase: <Покой|Предгон|Гон|Спад>',
    '  days_until_next: <int>',
    '  days_until_peak: <int>',
    '  dominance: <Низкая|Средняя|Высокая|Пик>',
    '  dominance_pct: <0..100>',
    '  knot: <Не готов|Набухает|Готов|Пик>',
    '  knot_pct: <0..100>',
    '  pheromones: <Слабые|Умеренные|Сильные|Пик>',
    '  pheromones_pct: <0..100>',
    '  trigger: <Нет|Слабый|Сильный>',
    '  bond: <Без пары|Помечен|True mate>  — infer from the character card/story: if he is married, mated, or has an established partner/spouse, output "Помечен" (or "True mate" for a soul-bonded pair). Use "Без пары" ONLY if he is clearly single. If truly unknown, omit this line.',
    '  suppressants: <Да|Нет>',
    '  symptoms: <short>',
    '  moodlet: <one short mood tag in [brackets]>',
    '  insight: <one warm intimate sentence>',
    '  care_tip: <one short line to his omega/partner>',
    '  fact: <one short omegaverse fact about this phase>',
    '  avoid: <what to avoid right now, short>',
    '  selfcare: <what would help right now, short>',
    '',
    'All free-text in the transcript language (Russian). Keep short and consistent with the numbers.'
  ].join('\n');

  // Бета = базовая биология → обычный менструальный цикл/беременность.
  function buildSystem() {
    if (mode() !== 'omega') return SYSTEM_CLASSIC;
    var d = dyn();
    if (d === 'alpha') return SYSTEM_ALPHA;
    if (d === 'beta') return SYSTEM_CLASSIC;
    return SYSTEM_OMEGA;
  }

  async function buildContext() {
    var total = await tavo.message.count();
    var start = Math.max(0, (total || 0) - 7); // меньше сообщений → меньше токенов
    var msgs = await tavo.message.find([start], { hidden: false });
    if (!msgs || !msgs.length) msgs = await tavo.message.find([], { hidden: false }) || [];
    var chat = await tavo.chat.current();
    var uname = (chat && chat.persona && chat.persona.name) || 'User';
    var names = {}, bg = [];
    if (chat && chat.characters) {
      chat.characters.forEach(function (c) {
        names[c.id] = c.name;
        if (c.name) bg.push('Character: ' + c.name);
        if (c.description) bg.push('Description: ' + String(c.description).slice(0, 350));
        if (c.scenario) bg.push('Scenario: ' + String(c.scenario).slice(0, 200));
      });
    }
    if (chat && chat.persona && chat.persona.description) bg.push('Player persona: ' + String(chat.persona.description).slice(0, 200));
    try { var mem = await tavo.memory.current(); var mc = mem && (mem.content || (typeof mem === 'string' ? mem : '')); if (mc) bg.push('Memory: ' + String(mc).slice(0, 300)); } catch (e) {}
    var transcript = msgs.map(function (m) {
      var who = m.role === 'user' ? uname : (names[m.characterId] || 'Character');
      var c = String(m.content || ''); if (c.length > 320) c = c.slice(0, 320) + '…'; // обрезаем длинные посты
      return who + ': ' + c;
    }).join('\n');
    return { bg: bg.join('\n'), transcript: transcript };
  }

  function stateToLines(f) { if (!f) return '(нет)'; return Object.keys(f).map(function (k) { return k + ': ' + f[k]; }).join('\n'); }
  function buildUserPrompt(cx, last, lock, dateHint) {
    var parts = [];
    parts.push('=== Mode ===\n' + (mode() === 'omega' ? ('OMEGAVERSE, dynamic: ' + dyn()) : 'classic'));
    if (dateHint) parts.push('=== In-story date ===\nCurrent in-story date is ' + dateHint + '. Output EXACTLY "date: ' + dateHint + '" UNCHANGED — unless the recent messages EXPLICITLY move time to a different day (a stated date, or a clear cue like "на следующее утро", "три дня спустя", "неделю спустя"). Never guess, never drift, never use the real-world/today date. If unsure, keep ' + dateHint + '.');
    else parts.push('=== In-story date ===\nOutput "date:" ONLY if the story contains an explicit date or a clear date/time cue (use the story\'s own year). If there is NO date information in the story, output exactly "date: none" — do NOT invent or guess a date.');
    if (lock && lock.kind === 'pregnancy') parts.push('=== FIXED BY CALENDAR ===\nIf still pregnant, it is at week ' + lock.week + ' (days_left ' + lock.days_left + ') — use exactly these, do NOT change them. If the baby was born in the story, switch to state=postpartum with pp_day 1. IMPORTANT: still fill ALL other fields FULLY (activity, symptoms, cravings, energy, milestone, insight, care_tip, fact, moodlet) — never omit the flavor.');
    else if (lock && lock.kind === 'postpartum') parts.push('=== FIXED BY CALENDAR ===\nThis is the POSTPARTUM period: pp_day is FIXED at ' + lock.pp_day + ' of about ' + lock.pp_total + ' days of lochia (postpartum bleeding). Output EXACTLY "pp_day: ' + lock.pp_day + '" and "pp_total: ' + lock.pp_total + '" — never change them. Only once pp_day clearly passes ' + lock.pp_total + ' AND the body has recovered may you switch to the normal cycle/heat state. IMPORTANT: still fill ALL other fields FULLY (lochia, lactation, symptoms, cravings, energy, insight, care_tip, fact, moodlet) — never omit the flavor.');
    else if (lock) parts.push('=== FIXED BY CALENDAR ===\nThe cycle day is FIXED at day ' + lock.day + ' of a ' + lock.length + '-day cycle. Output EXACTLY "day: ' + lock.day + '" and "length: ' + lock.length + '" — never change them. IMPORTANT: still fill ALL other fields FULLY (phase, and every flavor field: symptoms, cravings, energy, insight, care_tip, fact, moodlet, and the rest) — never omit the flavor.');
    if (cx.bg) parts.push('=== Character background ===\n' + cx.bg);
    parts.push('=== Last known state (carry forward) ===\n' + (last ? stateToLines(last) : '(none yet — infer from the scene)'));
    parts.push('=== Recent scene transcript ===\n' + cx.transcript);
    parts.push('Now output the CURRENT status block for the tracked character, advanced to this moment in the story.');
    return parts.join('\n\n');
  }

  async function callModel(messages) {
    var r;
    try {
      r = await fetch(PROXY_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerUrl: cfg.providerUrl, key: cfg.apiKey, model: cfg.model, messages: messages, max_tokens: 1500, temperature: 0.7 })
      });
    } catch (e) { diagPush('сеть', 'не достучались до прокси: ' + ((e && e.message) || e)); throw new Error('нет связи с прокси: ' + ((e && e.message) || e)); }
    var t = await r.text(); var data; try { data = JSON.parse(t); } catch (e) { data = { content: t }; }
    if (!r.ok) {
      var em = (data && data.error ? data.error : ('прокси ' + r.status)) + (data && data.detail ? ': ' + data.detail : '');
      diagPush('HTTP ' + r.status, em);
      throw new Error(em);
    }
    return (data && data.content) || '';
  }

  /* ── парсинг + подстраховки ── */
  function parseBlock(raw) {
    var f = {};
    String(raw || '').replace(/```[a-z]*|```/gi, '').split(/\r?\n/).forEach(function (line) {
      line = line.trim(); if (!line) return;
      line.split('|').forEach(function (part) {
        part = part.trim(); var c = part.indexOf(':'); if (c === -1) return;
        var k = part.slice(0, c).trim().toLowerCase().replace(/[^a-z_]/g, '');
        var v = part.slice(c + 1).trim();
        if (k && v && !(k in f)) f[k] = v;
      });
    });
    return f;
  }
  function deriveCycle(f) {
    var length = num(f.length, 28); if (length < 20 || length > 45) length = 28;
    var day = num(f.day, 1); if (day < 1) day = 1; if (day > length) day = length;
    var ovDay = length - 14; f.length = length; f.day = day;
    var canon = day <= 5 ? 'Менструальная' : day < ovDay - 1 ? 'Фолликулярная' : day <= ovDay + 1 ? 'Овуляция' : 'Лютеиновая';
    if (f.phase && f.phase !== canon) resetPhaseFields(f, ['libido', 'libido_pct', 'energy', 'energy_pct', 'symptoms', 'insight', 'care_tip', 'fact', 'moodlet', 'avoid', 'selfcare']);
    f.phase = canon;
    if (f.days_until_next == null) f.days_until_next = Math.max(0, length - day + 1);
    if (f.days_until_ovulation == null) { var d = ovDay - day; if (d < 0) d += length; f.days_until_ovulation = d; }
    var toOv = Math.abs(num(f.days_until_ovulation, 99));
    if (!f.fertility) f.fertility = toOv <= 1 ? 'Высокая' : toOv <= 3 ? 'Средняя' : 'Низкая';
    if (f.fertility_pct == null) f.fertility_pct = toOv <= 1 ? 92 : toOv <= 3 ? 55 : 12;
    if (!f.pregnancy_risk) f.pregnancy_risk = toOv === 0 ? 'Критический' : toOv <= 1 ? 'Высокий' : toOv <= 3 ? 'Средний' : 'Низкий';
    if (!f.libido) f.libido = f.phase === 'Овуляция' ? 'Пик' : f.phase === 'Фолликулярная' ? 'Высокое' : f.phase === 'Менструальная' ? 'Низкое' : 'Умеренное';
    if (f.libido_pct == null) f.libido_pct = f.libido === 'Пик' ? 95 : f.libido === 'Высокое' ? 72 : f.libido === 'Умеренное' ? 45 : 20;
    if (!f.energy) f.energy = f.phase === 'Фолликулярная' ? 'Высокая' : f.phase === 'Овуляция' ? 'Пик' : f.phase === 'Менструальная' ? 'Низкая' : 'Умеренная';
    if (f.energy_pct == null) f.energy_pct = f.energy === 'Пик' ? 92 : f.energy === 'Высокая' ? 74 : f.energy === 'Умеренная' ? 48 : 22;
    if (!f.symptoms) f.symptoms = { 'Менструальная': 'спазмы, усталость, чувствительность', 'Фолликулярная': 'прилив энергии, ясность', 'Овуляция': 'повышенное либидо, лёгкость', 'Лютеиновая': 'ПМС, раздражительность, тяга к сладкому' }[f.phase] || '';
    if (!f.insight) f.insight = { 'Менструальная': 'Тело обновляется — дай себе отдых и тепло.', 'Фолликулярная': 'Эстроген растёт: энергия, ясность, тянет к новому.', 'Овуляция': 'Пик влечения и обаяния — тело зовёт к близости.', 'Лютеиновая': 'Прогестерон берёт своё: нужнее покой и уют.' }[f.phase] || '';
    if (!f.care_tip) f.care_tip = { 'Менструальная': 'Ей нужны нежность, тепло и меньше требований.', 'Фолликулярная': 'Поймай её волну — она открыта и лёгкая.', 'Овуляция': 'Она особенно тянется к тебе — ответь вниманием.', 'Лютеиновая': 'Терпение и забота: чувствительность повышена.' }[f.phase] || '';
    if (!f.fact) f.fact = { 'Менструальная': 'В эти дни болевой порог ниже — объятия правда помогают.', 'Фолликулярная': 'Кожа сияет ярче — растёт эстроген.', 'Овуляция': 'Голос и запах сейчас привлекательнее всего.', 'Лютеиновая': 'Тяга к сладкому — тело просит быстрых калорий.' }[f.phase] || '';
    if (!f.moodlet) f.moodlet = { 'Менструальная': '[чувствительность]', 'Фолликулярная': '[подъём]', 'Овуляция': '[притяжение]', 'Лютеиновая': '[уязвимость]' }[f.phase] || '';
    if (!f.avoid) f.avoid = { 'Менструальная': 'переохлаждение, жёсткие диеты, перегруз', 'Фолликулярная': '', 'Овуляция': 'незащищённую близость, если не планируете ребёнка', 'Лютеиновая': 'соль, кофеин, недосып' }[f.phase] || '';
    if (!f.selfcare) f.selfcare = { 'Менструальная': 'грелка, тепло, магний, отдых', 'Фолликулярная': 'спорт и новые дела — есть силы', 'Овуляция': 'больше близости и общения', 'Лютеиновая': 'сон, сладкое в меру, спокойствие' }[f.phase] || '';
    return f;
  }
  function pregSize(w) {
    var t = [[4, 'маковое зёрнышко', '<1 г'], [5, 'кунжут', '<1 г'], [6, 'чечевица', '<1 г'], [7, 'черника', '~1 г'], [8, 'малина', '~2 г'], [9, 'виноградина', '~3 г'], [10, 'клубника', '~5 г'], [11, 'инжир', '~8 г'], [12, 'лайм', '~14 г'], [13, 'стручок гороха', '~23 г'], [14, 'лимон', '~43 г'], [16, 'авокадо', '~100 г'], [18, 'болг. перец', '~190 г'], [20, 'банан', '~300 г'], [22, 'кукуруза', '~430 г'], [24, 'початок', '~600 г'], [26, 'цукини', '~760 г'], [28, 'баклажан', '~1 кг'], [30, 'капуста', '~1.3 кг'], [32, 'кабачок', '~1.7 кг'], [34, 'дыня', '~2.1 кг'], [36, 'папайя', '~2.6 кг'], [38, 'тыква', '~3 кг'], [40, 'арбуз', '~3.4 кг']];
    var best = t[0]; for (var i = 0; i < t.length; i++) { if (w >= t[i][0]) best = t[i]; } return best;
  }
  function derivePreg(f) {
    var week = num(f.week, 8); if (week < 1) week = 1; if (week > 42) week = 42; f.week = week;
    if (f.day == null) f.day = 0;
    if (!f.trimester) f.trimester = week <= 12 ? '1' : week <= 27 ? '2' : '3';
    if (f.days_left == null) f.days_left = Math.max(0, (40 - week) * 7 - num(f.day, 0));
    if (!f.due) f.due = 'через ' + Math.max(0, 40 - week) + ' нед';
    if (!f.baby_size || f.baby_size === '?') { var s = pregSize(week); f.baby_size = s[1]; if (!f.baby_weight) f.baby_weight = s[2]; }
    var tri = f.trimester;
    if (!f.activity) f.activity = { '1': 'формируются органы, бьётся сердечко', '2': 'активно шевелится, слышит голоса', '3': 'набирает вес, готовится к встрече' }[tri] || '';
    if (!f.symptoms) f.symptoms = { '1': 'токсикоз, сонливость, чувствительность к запахам', '2': 'прилив сил, растёт живот', '3': 'тяжесть, частые позывы, тренировочные схватки' }[tri] || '';
    if (!f.insight) f.insight = { '1': 'Тело перестраивается под новую жизнь — гормоны штормят, будь к себе бережнее.', '2': 'Золотая пора: силы возвращаются, малыш уже слышит твой голос.', '3': 'Финишная прямая — тело тяжелеет и готовится, больше отдыха.' }[tri] || '';
    if (!f.care_tip) f.care_tip = { '1': 'Нужны покой, тепло и терпение к перепадам настроения.', '2': 'Раздели радость и внимание — вы ждёте малыша вместе.', '3': 'Больше заботы и опоры: последние недели даются нелегко.' }[tri] || '';
    if (!f.fact) f.fact = { '1': 'Сердечко малыша бьётся почти вдвое быстрее твоего.', '2': 'Малыш уже различает твой голос и вкус околоплодных вод.', '3': 'Малыш реагирует на свет и прикосновения к животу.' }[tri] || '';
    if (!f.moodlet) f.moodlet = { '1': '[хрупкость]', '2': '[тепло]', '3': '[ожидание]' }[tri] || '';
    if (!f.milestone) f.milestone = { '1': 'Первое УЗИ и сердцебиение', '2': 'Скрининг и первые шевеления', '3': 'Подготовка к родам' }[tri] || '';
    if (!f.avoid) f.avoid = { '1': 'алкоголь, сырое, сильные запахи, стресс', '2': 'тяжёлое, перегрев, долго лежать на спине', '3': 'долго стоять, соль, дальние поездки' }[tri] || '';
    if (!f.selfcare) f.selfcare = { '1': 'дробное питание, вода, отдых, свежий воздух', '2': 'лёгкая гимнастика, крем от растяжек, прогулки', '3': 'сон на боку с подушкой, отдых, дыхание' }[tri] || '';
    if (!f.energy) f.energy = f.trimester === '2' ? 'Высокая' : f.trimester === '1' ? 'Низкая' : 'Умеренная';
    if (f.energy_pct == null) f.energy_pct = f.energy === 'Пик' ? 92 : f.energy === 'Высокая' ? 74 : f.energy === 'Умеренная' ? 48 : 24;
    return f;
  }
  var LOCHIA_LEN = 42; // базовый срок послеродового кровотечения (лохий), дней
  function derivePostpartum(f) {
    var total = num(f.pp_total, LOCHIA_LEN); if (total < 14 || total > 90) total = LOCHIA_LEN; f.pp_total = total;
    var pp = num(f.pp_day, 1); if (pp < 1) pp = 1; if (pp > 120) pp = 120; f.pp_day = pp;
    // корзина восстановления: 0 — ранний (обильные), 1 — до 2 нед, 2 — до конца лохий (мажущие), 3 — лохии прошли
    var b = pp <= 4 ? 0 : pp <= 14 ? 1 : pp <= total ? 2 : 3;
    if (!f.lochia) f.lochia = ['Обильные', 'Умеренные', 'Мажущие', 'Прошли'][b];
    if (f.bleeding_pct == null) f.bleeding_pct = [90, 58, 26, 4][b];
    if (!f.recovery) f.recovery = ['Ранний период', 'Активное восстановление', 'Восстановление', 'Почти восстановилась'][b];
    if (!f.lactation) f.lactation = ['Молозиво', 'Приходит молоко', 'Налаженная лактация', 'Налаженная лактация'][b];
    if (!f.symptoms) f.symptoms = [
      'обильные кровяные выделения, слабость, сокращения матки',
      'кровотечение слабеет, болит шов/промежность, нагрубание груди',
      'мажущие выделения, усталость, гормональные качели, потливость',
      'выделения почти прошли, тело восстанавливается, силы возвращаются'
    ][b];
    if (!f.insight) f.insight = [
      'Тело только что прошло роды — кровит, матка сокращается. Максимум покоя и близких рядом.',
      'Первые недели: тело заживает, молоко прибывает, гормоны штормят. Нужна помощь по дому и сон.',
      'Кровотечение сходит на нет, но силы ещё не те. Нежность и терпение важнее всего.',
      'Лохии почти закончились, тело окрепло. Скоро вернётся привычный ритм.'
    ][b];
    if (!f.care_tip) f.care_tip = [
      'Взять на себя всё: сон урывками, тепло, еда, ноль требований.',
      'Помогать с малышом и бытом, давать высыпаться, обнимать без ожиданий.',
      'Поддержка и терпение: гормоны ещё качают, близость — по её готовности.',
      'Быть рядом и хвалить — она прошла огромный путь.'
    ][b];
    if (!f.fact) f.fact = [
      'Первые дни выделения (лохии) обильные и алые — это нормально.',
      'Матка возвращается к прежнему размеру около 6 недель.',
      'Лохии за недели меняют цвет: от алого к бурому и светлому.',
      'Полное восстановление тканей занимает около 6–8 недель.'
    ][b];
    if (!f.moodlet) f.moodlet = ['[измотанность]', '[хрупкость]', '[качели]', '[нежность]'][b];
    if (!f.avoid) f.avoid = [
      'нагрузки, поднятие тяжестей, близость, ванну/бассейн',
      'тяжёлое, переутомление, купание в воде, ранняя близость',
      'перегруз, недосып, стресс',
      'резкие нагрузки без разрешения врача'
    ][b];
    if (!f.selfcare) f.selfcare = [
      'лежать, пить воду, гигиена, обезболивание по назначению',
      'сон когда спит малыш, питьё, лёгкая еда, поддержка груди',
      'отдых, прогулки на воздухе, тепло, забота о себе',
      'мягкая активность, режим сна, восстановление сил'
    ][b];
    if (!f.cravings) f.cravings = ['покой и тишину', 'сон и объятия', 'тепло и поддержку', 'вернуться к себе'][b];
    if (!f.energy) f.energy = ['Низкая', 'Низкая', 'Умеренная', 'Умеренная'][b];
    if (f.energy_pct == null) f.energy_pct = [18, 30, 48, 60][b];
    if (f.days_since_birth == null) f.days_since_birth = pp - 1;
    return f;
  }

  /* ── рендер виджетов (дизайн из pusya_cycle / pusya_pregnancy) ── */
  function cycleHtml(f) {
    deriveCycle(f);
    var PH = {
      'Менструальная': ['232,108,116', '244,150,156', 'var(--pb-c-mens)', '🩸'],
      'Фолликулярная': ['120,200,156', '170,228,190', 'var(--pb-c-green)', '🌱'],
      'Овуляция': ['198,124,210', '236,176,236', 'var(--pb-c-ovu)', '💜'],
      'Лютеиновая': ['236,176,108', '248,206,158', 'var(--pb-c-amber2)', '🌙']
    };
    var phase = f.phase, p = PH[phase] || PH['Овуляция'];
    var day = f.day, length = f.length, ovDay = length - 14, next = f.days_until_next, ovu = f.days_until_ovulation;
    var fert = f.fertility, lib = f.libido, risk = f.pregnancy_risk;
    var segs = [['Менструальная', 0, 5], ['Фолликулярная', 5, ovDay - 1], ['Овуляция', ovDay - 1, ovDay + 1], ['Лютеиновая', ovDay + 1, length]];
    var th = '', lb = '';
    segs.forEach(function (s) {
      var w = Math.max(0, (s[2] - s[1]) / length * 100), c = PH[s[0]][0], on = (s[0] === phase);
      th += '<div style="width:' + w + '%;height:100%;background:rgba(' + c + ',' + (on ? 0.95 : 0.4) + ');box-shadow:' + (on ? '0 0 10px rgba(' + c + ',0.9)' : 'none') + ';"></div>';
      lb += '<span style="width:' + w + '%;text-align:center;color:' + (on ? PH[s[0]][2] : 'var(--pb-t4)') + ';opacity:' + (on ? 1 : 0.6) + ';">' + PH[s[0]][3] + '</span>';
    });
    var pos = Math.max(0, Math.min(100, (day / length) * 100));
    var fertColor = fert === 'Низкая' ? 'var(--pb-c-blue)' : fert === 'Средняя' ? 'var(--pb-c-amber)' : 'var(--pb-c-pink)';
    var libColor = lib === 'Низкое' ? 'var(--pb-c-blue)' : lib === 'Умеренное' ? 'var(--pb-c-amber)' : lib === 'Высокое' ? 'var(--pb-c-pink)' : 'var(--pb-c-hot)';
    var riskColor = risk === 'Низкий' ? 'var(--pb-c-green)' : risk === 'Средний' ? 'var(--pb-c-amber)' : risk === 'Высокий' ? 'var(--pb-c-pink)' : 'var(--pb-c-hot)';
    function cell(ic, label, val, col) { return '<div style="flex:1;min-width:0;background:rgba(var(--ac),0.08);border-radius:10px;padding:7px 3px;text-align:center;border:1px solid rgba(var(--ac),0.14);"><div style="font-size:6.5px;color:var(--pb-t3);margin-bottom:2px;">' + ic + ' ' + label + '</div><div style="font-size:8px;font-weight:700;color:' + col + ';line-height:1.15;">' + esc(val) + '</div></div>'; }
    var symp = f.symptoms, ins = f.insight, mood = f.moodlet, chem = f.chemistry_boost;
    var sympH = symp ? '<div style="margin-bottom:7px;font-size:8.5px;color:var(--pb-t3);line-height:1.4;"><span style="color:' + p[2] + ';">●</span> ' + esc(symp) + '</div>' : '';
    var cravH = softRow('🍫 хочется:', p[2], f.cravings);
    var factH = softRow('✨', p[2], f.fact);
    var careH = careTipRow(f.care_tip);
    var insH = ins ? '<div style="margin-bottom:7px;"><div style="background:rgba(var(--ac),0.07);border-radius:10px;padding:8px 10px;border:1px solid rgba(var(--ac),0.14);"><div style="font-size:9px;color:var(--pb-t2);line-height:1.45;font-style:italic;">🧠 ' + esc(ins) + '</div></div></div>' : '';
    var foot = (mood || chem) ? '<div style="display:flex;align-items:center;gap:8px;padding-top:7px;margin-top:7px;border-top:1px solid rgba(var(--ac),0.12);"><span style="font-size:7.5px;color:var(--pb-t4);">влияние:</span>' + (mood ? '<span style="background:rgba(var(--ac),0.12);padding:3px 8px;border-radius:11px;font-size:9px;color:var(--pb-t2);">' + esc(String(mood).replace(/[\[\]]/g, '')) + '</span>' : '') + (chem ? '<span style="font-size:8px;color:var(--pb-c-green);">химия ' + esc(chem) + '</span>' : '') + '</div>' : '';
    return '<div class="pb-widget" style="--ac:' + p[0] + ';--hex:' + p[2] + ';--soft:' + p[1] + ';">' +
      '<details open class="pbc" style="border-radius:22px;overflow:hidden;position:relative;background:var(--pb-card);border:1px solid rgba(var(--ac),0.28);box-shadow:0 8px 32px rgba(0,0,0,0.4),0 0 22px rgba(var(--ac),0.14),inset 0 1px 0 rgba(255,255,255,0.09);">' +
      '<div style="position:absolute;inset:0;pointer-events:none;z-index:1;background:radial-gradient(130% 100% at 100% 0%, rgba(var(--ac),0.32), transparent 60%);"></div>' +
      '<summary style="cursor:pointer;list-style:none;outline:none;position:relative;z-index:4;"><div style="padding:12px 15px;display:flex;align-items:center;gap:11px;border-bottom:1px solid rgba(var(--ac),0.14);">' +
      '<div style="width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 32% 28%,rgba(var(--ac),0.5),rgba(var(--ac),0.12));display:flex;align-items:center;justify-content:center;font-size:16px;border:1px solid rgba(var(--ac),0.45);box-shadow:0 0 16px rgba(var(--ac),0.45);flex-shrink:0;">' + p[3] + '</div>' +
      '<div style="flex:1;min-width:0;"><div style="font-size:10px;font-weight:700;color:var(--pb-t1);">Цикл · День ' + esc(day) + '</div><div style="display:flex;align-items:center;gap:6px;margin-top:2px;"><span style="font-size:8px;font-weight:700;color:' + p[2] + ';">' + esc(phase) + '</span><span style="font-size:8px;color:var(--pb-t3);">· ' + esc(next) + ' дн. до след.</span></div></div>' +
      '<span class="pb-arrow" style="font-size:10px;color:' + p[2] + ';transition:transform .3s;flex-shrink:0;">▼</span></div></summary>' +
      '<div style="padding:14px 16px 11px;position:relative;z-index:4;">' +
      '<div style="position:relative;height:30px;margin-bottom:5px;"><div style="position:absolute;left:0;right:0;top:11px;height:6px;border-radius:6px;overflow:hidden;display:flex;box-shadow:0 0 12px rgba(var(--ac),0.3);">' + th + '</div>' +
      '<div style="position:absolute;top:6px;width:16px;height:16px;border-radius:50%;transform:translateX(-50%);border:2px solid rgba(255,255,255,0.75);animation:pb-mpulse 2.8s ease-in-out infinite;z-index:2;left:' + pos + '%;background:radial-gradient(circle,' + p[2] + ',rgba(0,0,0,0.15));color:' + p[2] + ';"></div></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:6.5px;margin-bottom:11px;">' + lb + '</div>' +
      '<div style="display:flex;gap:5px;margin-bottom:9px;">' + cell('🌱', 'Фертильн.', fert, fertColor) + cell('🔥', 'Либидо', lib, libColor) + cell('⚡', 'Энергия', f.energy, energyColorOf(f.energy)) + cell('🤰', 'Риск', risk, riskColor) + cell('💜', 'Овул.', ovu + 'д', p[2]) + '</div>' +
      moreBlock(sympH + cravH + factH + softRow('⚠️ избегать:', p[2], f.avoid) + softRow('🛁 поможет:', p[2], f.selfcare) + careH + insH + foot) + '</div></details></div>';
  }

  function pregHtml(f) {
    derivePreg(f);
    var week = f.week, day = f.day, trim = f.trimester, due = f.due, days = f.days_left;
    var TR = week <= 12 ? ['150,214,182', '188,234,210', 'var(--pb-c-green2)', '🌱'] : week <= 27 ? ['244,196,150', '250,218,184', 'var(--pb-c-amber3)', '🍑'] : ['244,176,200', '250,208,222', 'var(--pb-c-tri3)', '🌸'];
    var TRC = [[150, 214, 182], [244, 196, 150], [244, 176, 200]], segs = [[0, 12], [12, 27], [27, 40]];
    var curTri = week <= 12 ? 0 : week <= 27 ? 1 : 2, icons = ['🌱', '🍑', '🌸'], hexes = ['96d6b6', 'f4c496', 'f4b0c8'];
    var th = '', lb = '';
    segs.forEach(function (s, i) {
      var w = (s[1] - s[0]) / 40 * 100, c = TRC[i].join(','), on = (i === curTri);
      th += '<div style="width:' + w + '%;height:100%;background:rgba(' + c + ',' + (on ? 0.95 : 0.4) + ');box-shadow:' + (on ? '0 0 10px rgba(' + c + ',0.9)' : 'none') + ';"></div>';
      lb += '<span style="width:' + w + '%;text-align:center;color:' + (on ? '#' + hexes[i] : 'var(--pb-t4)') + ';opacity:' + (on ? 1 : 0.6) + ';">' + icons[i] + '</span>';
    });
    var pos = Math.max(0, Math.min(100, (week / 40) * 100));
    function cell(ic, label, val, sub) { return '<div style="flex:1;min-width:0;background:rgba(var(--ac),0.08);border-radius:10px;padding:7px 3px;text-align:center;border:1px solid rgba(var(--ac),0.14);"><div style="font-size:6.5px;color:var(--pb-t3);margin-bottom:2px;">' + ic + ' ' + label + '</div><div style="font-size:9px;font-weight:700;color:var(--hex);line-height:1.15;">' + esc(val) + '</div>' + (sub ? '<div style="font-size:6.5px;color:var(--pb-t4);margin-top:1px;">' + esc(sub) + '</div>' : '') + '</div>'; }
    var act = f.activity, symp = f.symptoms, gain = f.weight_gain, size = f.baby_size || '?', bweight = f.baby_weight || '';
    var mile = f.milestone, mdays = f.milestone_days, ins = f.insight, mood = f.moodlet, boost = f.attachment_boost;
    var actH = act ? '<div style="margin-bottom:7px;font-size:8.5px;color:var(--pb-t3);line-height:1.4;"><span style="color:' + TR[2] + ';">🦵</span> ' + esc(act) + '</div>' : '';
    var sympH = symp ? '<div style="margin-bottom:7px;font-size:8.5px;color:var(--pb-t3);line-height:1.4;"><span style="color:' + TR[2] + ';">●</span> ' + esc(symp) + '</div>' : '';
    var cravH = softRow('🍓 хочется:', TR[2], f.cravings);
    var factH = softRow('✨', TR[2], f.fact);
    var careH = careTipRow(f.care_tip);
    var mileH = '';
    if (mile) { var mt = /^\d+$/.test(String(mdays)) ? (String(mdays) === '0' ? 'сегодня' : 'через ' + esc(mdays) + ' дн') : ''; mileH = '<div style="margin-bottom:7px;"><div style="background:rgba(var(--ac),0.08);border-radius:10px;padding:8px 10px;border-left:2px solid var(--hex);display:flex;justify-content:space-between;align-items:center;gap:8px;"><span style="font-size:9px;font-weight:600;color:var(--pb-t2);">📍 ' + esc(mile) + '</span>' + (mt ? '<span style="font-size:8px;color:var(--pb-t4);white-space:nowrap;">' + mt + '</span>' : '') + '</div></div>'; }
    var insH = ins ? '<div style="margin-bottom:7px;"><div style="background:rgba(var(--ac),0.07);border-radius:10px;padding:8px 10px;border:1px solid rgba(var(--ac),0.14);"><div style="font-size:9px;color:var(--pb-t2);line-height:1.45;font-style:italic;">🧠 ' + esc(ins) + '</div></div></div>' : '';
    var foot = (mood || boost) ? '<div style="display:flex;align-items:center;gap:8px;padding-top:7px;margin-top:7px;border-top:1px solid rgba(var(--ac),0.12);"><span style="font-size:7.5px;color:var(--pb-t4);">влияние:</span>' + (mood ? '<span style="background:rgba(var(--ac),0.12);padding:3px 8px;border-radius:11px;font-size:9px;color:var(--pb-t2);">' + esc(String(mood).replace(/[\[\]]/g, '')) + '</span>' : '') + (boost ? '<span style="font-size:8px;color:var(--pb-c-green2);">привязанность ' + esc(boost) + '</span>' : '') + '</div>' : '';
    return '<div class="pb-widget" style="--ac:' + TR[0] + ';--hex:' + TR[2] + ';--soft:' + TR[1] + ';">' +
      '<details open class="pbc" style="border-radius:22px;overflow:hidden;position:relative;background:var(--pb-card);border:1px solid rgba(var(--ac),0.28);box-shadow:0 8px 32px rgba(0,0,0,0.4),0 0 22px rgba(var(--ac),0.14),inset 0 1px 0 rgba(255,255,255,0.09);">' +
      '<div style="position:absolute;inset:0;pointer-events:none;z-index:1;background:radial-gradient(130% 100% at 100% 0%, rgba(var(--ac),0.3), transparent 60%);"></div>' +
      '<summary style="cursor:pointer;list-style:none;outline:none;position:relative;z-index:4;"><div style="padding:12px 15px;display:flex;align-items:center;gap:11px;border-bottom:1px solid rgba(var(--ac),0.14);">' +
      '<div style="width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 32% 28%,rgba(var(--ac),0.5),rgba(var(--ac),0.12));display:flex;align-items:center;justify-content:center;font-size:16px;border:1px solid rgba(var(--ac),0.45);box-shadow:0 0 16px rgba(var(--ac),0.45);flex-shrink:0;">' + TR[3] + '</div>' +
      '<div style="flex:1;min-width:0;"><div style="font-size:10px;font-weight:700;color:var(--pb-t1);">Беременность · ' + esc(week) + ' нед' + (num(day, 0) > 0 ? ' · ' + num(day, 0) + ' дн' : '') + '</div><div style="display:flex;align-items:center;gap:6px;margin-top:2px;"><span style="font-size:8px;font-weight:700;color:' + TR[2] + ';">' + (trim ? esc(trim) + ' триместр' : '') + '</span><span style="font-size:8px;color:var(--pb-t3);">· ПДР ' + esc(due) + '</span></div></div>' +
      '<span class="pb-arrow" style="font-size:10px;color:' + TR[2] + ';transition:transform .3s;flex-shrink:0;">▼</span></div></summary>' +
      '<div style="padding:14px 16px 11px;position:relative;z-index:4;">' +
      '<div style="position:relative;height:30px;margin-bottom:5px;"><div style="position:absolute;left:0;right:0;top:11px;height:6px;border-radius:6px;overflow:hidden;display:flex;box-shadow:0 0 12px rgba(var(--ac),0.3);">' + th + '</div>' +
      '<div style="position:absolute;top:6px;width:16px;height:16px;border-radius:50%;transform:translateX(-50%);border:2px solid rgba(255,255,255,0.75);animation:pb-mpulse 2.8s ease-in-out infinite;z-index:2;left:' + pos + '%;background:radial-gradient(circle,' + TR[2] + ',rgba(0,0,0,0.15));color:' + TR[2] + ';"></div></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:6.5px;margin-bottom:11px;">' + lb + '</div>' +
      '<div style="display:flex;gap:5px;margin-bottom:9px;">' + cell('⏳', 'До родов', days, 'дней') + cell('🍼', 'Размер', size, bweight) + cell('⚡', 'Энергия', f.energy, '') + cell('⚖️', 'Прибавка', gain || '—', '') + '</div>' +
      moreBlock(actH + sympH + cravH + factH + softRow('⚠️ избегать:', TR[2], f.avoid) + softRow('🛁 поможет:', TR[2], f.selfcare) + mileH + careH + insH + foot) + '</div></details></div>';
  }

  function postpartumHtml(f) {
    derivePostpartum(f);
    var pp = f.pp_day, total = f.pp_total;
    var b = pp <= 4 ? 0 : pp <= 14 ? 1 : pp <= total ? 2 : 3;
    var AC = '224,96,120', SOFT = '244,168,186', HEX = 'var(--pb-c-pp)', ICON = '🤱';
    // шкала спада кровотечения: обильные (0..4) / умеренные (4..14) / мажущие (14..total)
    var segs = [['Обильные', 0, 4, '224,84,104'], ['Умеренные', 4, 14, '224,120,140'], ['Мажущие', 14, total, '212,160,176']];
    var th = '', lb = '';
    segs.forEach(function (s) {
      var w = Math.max(0, (s[2] - s[1]) / total * 100), on = (pp > s[1] && pp <= s[2]) || (s[1] === 0 && pp <= s[2]);
      th += '<div style="width:' + w + '%;height:100%;background:rgba(' + s[3] + ',' + (on ? 0.95 : 0.38) + ');box-shadow:' + (on ? '0 0 10px rgba(' + s[3] + ',0.9)' : 'none') + ';"></div>';
      lb += '<span style="width:' + w + '%;text-align:center;color:' + (on ? HEX : 'var(--pb-t4)') + ';opacity:' + (on ? 1 : 0.6) + ';">' + s[0] + '</span>';
    });
    var pos = Math.max(0, Math.min(100, (pp / total) * 100));
    function cell(ic, label, val, col) { return '<div style="flex:1;min-width:0;background:rgba(var(--ac),0.08);border-radius:10px;padding:7px 3px;text-align:center;border:1px solid rgba(var(--ac),0.14);"><div style="font-size:6.5px;color:var(--pb-t3);margin-bottom:2px;">' + ic + ' ' + label + '</div><div style="font-size:8px;font-weight:700;color:' + (col || 'var(--hex)') + ';line-height:1.15;">' + esc(val) + '</div></div>'; }
    var bleedColor = colorLevel(f.bleeding_pct);
    var rows = softRow('●', HEX, f.symptoms) + softRow('🍼 лактация:', HEX, f.lactation) + softRow('🍫 хочется:', HEX, f.cravings) + softRow('✨', HEX, f.fact) + softRow('⚠️ избегать:', HEX, f.avoid) + softRow('🛁 поможет:', HEX, f.selfcare) + careTipRow(f.care_tip) + insightRow(f.insight) + footRow(f.moodlet);
    return '<div class="pb-widget" style="--ac:' + AC + ';--hex:' + HEX + ';--soft:' + SOFT + ';">' +
      '<details open class="pbc" style="border-radius:22px;overflow:hidden;position:relative;background:var(--pb-card);border:1px solid rgba(var(--ac),0.28);box-shadow:0 8px 32px rgba(0,0,0,0.4),0 0 22px rgba(var(--ac),0.14),inset 0 1px 0 rgba(255,255,255,0.09);">' +
      '<div style="position:absolute;inset:0;pointer-events:none;z-index:1;background:radial-gradient(130% 100% at 100% 0%, rgba(var(--ac),0.3), transparent 60%);"></div>' +
      '<summary style="cursor:pointer;list-style:none;outline:none;position:relative;z-index:4;"><div style="padding:12px 15px;display:flex;align-items:center;gap:11px;border-bottom:1px solid rgba(var(--ac),0.14);">' +
      '<div style="width:34px;height:34px;border-radius:50%;background:radial-gradient(circle at 32% 28%,rgba(var(--ac),0.5),rgba(var(--ac),0.12));display:flex;align-items:center;justify-content:center;font-size:16px;border:1px solid rgba(var(--ac),0.45);box-shadow:0 0 16px rgba(var(--ac),0.45);flex-shrink:0;">' + ICON + '</div>' +
      '<div style="flex:1;min-width:0;"><div style="font-size:10px;font-weight:700;color:var(--pb-t1);">После родов · день ' + esc(pp) + '</div><div style="display:flex;align-items:center;gap:6px;margin-top:2px;"><span style="font-size:8px;font-weight:700;color:' + HEX + ';">' + esc(f.recovery) + '</span><span style="font-size:8px;color:var(--pb-t3);">· ' + (b < 3 ? 'лохии ещё ' + Math.max(0, total - pp) + ' дн' : 'лохии прошли') + '</span></div></div>' +
      '<span class="pb-arrow" style="font-size:10px;color:' + HEX + ';transition:transform .3s;flex-shrink:0;">▼</span></div></summary>' +
      '<div style="padding:14px 16px 11px;position:relative;z-index:4;">' +
      '<div style="position:relative;height:30px;margin-bottom:5px;"><div style="position:absolute;left:0;right:0;top:11px;height:6px;border-radius:6px;overflow:hidden;display:flex;box-shadow:0 0 12px rgba(var(--ac),0.3);">' + th + '</div>' +
      '<div style="position:absolute;top:6px;width:16px;height:16px;border-radius:50%;transform:translateX(-50%);border:2px solid rgba(255,255,255,0.75);animation:pb-mpulse 2.8s ease-in-out infinite;z-index:2;left:' + pos + '%;background:radial-gradient(circle,' + HEX + ',rgba(0,0,0,0.15));"></div></div>' +
      '<div style="display:flex;justify-content:space-between;font-size:6.5px;margin-bottom:11px;">' + lb + '</div>' +
      '<div style="display:flex;gap:5px;margin-bottom:9px;">' + cell('🩸', 'Выделения', f.lochia, bleedColor) + cell('🌿', 'Восстан.', f.recovery, HEX) + cell('⚡', 'Энергия', f.energy, energyColorOf(f.energy)) + cell('🍼', 'Лактация', f.lactation, HEX) + '</div>' +
      moreBlock(rows) + '</div></details></div>';
  }

  function widgetHtml(f) {
    if (!f || !f.state || f.state === 'none') return '';
    if (f.state === 'heat' || f.slick != null) return heatHtml(f);
    if (f.state === 'rut' || f.knot != null) return rutHtml(f);
    if (f.state === 'postpartum' || f.pp_day != null) return postpartumHtml(f);
    if (f.state === 'pregnancy' || f.week != null) return pregHtml(f);
    return cycleHtml(f);
  }
  function renderState(f) {
    var html = widgetHtml(f);
    out.innerHTML = html || '<div class="pb-cap">по сюжету сейчас нечего показывать</div>';
    var mb = out.querySelector('.pb-more-btn'), mm = out.querySelector('.pb-more');
    if (mb && mm) mb.addEventListener('click', function (e) { e.stopPropagation(); moreOpen = !moreOpen; mm.style.display = moreOpen ? 'block' : 'none'; mb.textContent = moreOpen ? '− свернуть' : '＋ подробнее'; if (root.classList.contains('open')) placePop(); });
    if (root.classList.contains('open')) placePop();
  }

  /* ── ИГРОВАЯ ДАТА + КАЛЕНДАРЬ ── */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseISO(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function parseUserDate(s) {
    s = String(s || '').trim(); var m;
    m = /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})$/.exec(s); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/.exec(s); if (m) { var y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[2] - 1, +m[1]); }
    return null;
  }
  function dayFloor(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function diffDays(a, b) { return Math.round((dayFloor(a).getTime() - dayFloor(b).getTime()) / 86400000); }
  var GAMEDATE_FILE = 'pusya_bio_gamedate';
  async function loadGameDate() { try { var d = parseISO(await tavo.file.load(GAMEDATE_FILE)); if (d) return d; } catch (e) {} return dayFloor(new Date()); }
  async function loadGameDateISO() { try { var s = await tavo.file.load(GAMEDATE_FILE); return parseISO(s) ? s : null; } catch (e) { return null; } } // null если ещё не установлена
  async function saveGameDate(d) { try { await tavo.file.save(GAMEDATE_FILE, toISO(dayFloor(d))); } catch (e) {} }

  var MON_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var MON_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  var WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  // фон/пометка дня по текущему состоянию (проекция цикла от игровой даты)
  function dayInfo(f, date, gd) {
    var st = f.state;
    if (st === 'postpartum' || f.pp_day != null) {
      var pp0 = num(f.pp_day, 1), tot = num(f.pp_total, LOCHIA_LEN);
      var birth = addDays(gd, -(pp0 - 1));
      var dd = diffDays(date, birth); // 0 = день родов, дальше — дни после
      if (dd === 0) return { bg: 'rgba(232,90,110,0.34)', mark: '👶' };
      if (dd > 0 && dd < tot) { var a = dd < 4 ? 0.36 : dd < 10 ? 0.26 : 0.15; return { bg: 'rgba(224,80,104,' + a + ')', mark: dd < 4 ? '🩸' : '' }; }
      return {};
    }
    if (st === 'pregnancy' || f.week != null) {
      var dl = num(f.days_left, null);
      if (dl == null) return {};
      var due = addDays(gd, dl), toDue = diffDays(due, date); // >0 до родов
      if (toDue === 0) return { bg: 'rgba(232,90,110,0.30)', ring: 'var(--pb-c-due)', mark: '👶' };
      if (toDue > 0 && toDue <= 280) {
        var wkAt = 40 - Math.ceil(toDue / 7);
        var triC = wkAt <= 12 ? '150,214,182' : wkAt <= 27 ? '244,196,150' : '244,176,200';
        return { bg: 'rgba(' + triC + ',0.20)' };
      }
      return {};
    }
    var len = num(f.length, 28); if (len < 4) len = 28;
    var cd = num(f.day, 1);
    var anchor = addDays(gd, -(cd - 1));
    var n = diffDays(date, anchor); var day = (((n % len) + len) % len) + 1;
    if (st === 'heat' || f.slick != null) {
      var fr = day / len, ph = fr < 0.6 ? 'Покой' : fr < 0.72 ? 'Предтечка' : fr < 0.88 ? 'Течка' : 'Послетечка';
      var C = { 'Покой': '150,170,214', 'Предтечка': '236,176,108', 'Течка': '232,90,130', 'Послетечка': '198,150,210' }[ph];
      return { bg: 'rgba(' + C + ',0.28)', mark: ph === 'Течка' ? '🔥' : '' };
    }
    if (st === 'rut' || f.knot != null) {
      var fr2 = day / len, ph2 = fr2 < 0.6 ? 'Покой' : fr2 < 0.72 ? 'Предгон' : fr2 < 0.88 ? 'Гон' : 'Спад';
      var C2 = { 'Покой': '150,170,214', 'Предгон': '236,176,108', 'Гон': '200,80,80', 'Спад': '170,150,200' }[ph2];
      return { bg: 'rgba(' + C2 + ',0.28)', mark: ph2 === 'Гон' ? '🐺' : '' };
    }
    var ov = len - 14, ph3 = day <= 5 ? 'Менструальная' : day < ov - 1 ? 'Фолликулярная' : day <= ov + 1 ? 'Овуляция' : 'Лютеиновая';
    var C3 = { 'Менструальная': '232,108,116', 'Фолликулярная': '120,200,156', 'Овуляция': '198,124,210', 'Лютеиновая': '236,176,108' }[ph3];
    var mark = day <= 5 ? '🩸' : (day >= ov - 1 && day <= ov + 1 ? '💜' : '');
    return { bg: 'rgba(' + C3 + ',0.26)', mark: mark };
  }

  function legendItem(rgb, label) { return '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;border-radius:3px;background:rgba(' + rgb + ',0.55);display:inline-block;"></span>' + label + '</span>'; }
  function calLegend(f) {
    if (f.state === 'heat' || f.slick != null) return legendItem('232,90,130', '🔥 течка') + legendItem('236,176,108', 'предтечка') + legendItem('198,150,210', 'послетечка') + legendItem('150,170,214', 'покой');
    if (f.state === 'rut' || f.knot != null) return legendItem('200,80,80', '🐺 гон') + legendItem('236,176,108', 'предгон') + legendItem('170,150,200', 'спад') + legendItem('150,170,214', 'покой');
    if (f.state === 'postpartum' || f.pp_day != null) return '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;border-radius:50%;background:rgba(232,90,110,0.7);display:inline-block;"></span>👶 роды</span>' + legendItem('224,80,104', '🩸 лохии') + '<span style="color:var(--pb-t4);">(спадают к ' + num(f.pp_total, LOCHIA_LEN) + ' дню)</span>';
    if (f.state === 'pregnancy' || f.week != null) return '<span style="display:inline-flex;align-items:center;gap:3px;"><span style="width:9px;height:9px;border-radius:50%;border:2px solid var(--pb-c-due);box-sizing:border-box;display:inline-block;"></span>👶 ПДР</span>' + legendItem('150,214,182', '1 трим.') + legendItem('244,196,150', '2 трим.') + legendItem('244,176,200', '3 трим.');
    return legendItem('232,108,116', '🩸 месячные') + legendItem('198,124,210', '💜 овуляция') + legendItem('120,200,156', 'фолл.') + legendItem('236,176,108', 'лют.');
  }

  function calBar(f, selISO) {
    if (!selISO) return '<div style="font-size:9px;color:var(--pb-t3);margin-top:8px;line-height:1.4;">тапни день, чтобы отметить цикл или сделать его «сегодня»</div>';
    var sd = parseISO(selISO), lbl = sd.getDate() + ' ' + MON_RU[sd.getMonth()];
    var b = '';
    if (f.state === 'heat' || f.slick != null) b += '<button class="pb-cal-act" data-act="heat" type="button">🔥 началась течка</button>';
    else if (f.state === 'rut' || f.knot != null) b += '<button class="pb-cal-act" data-act="rut" type="button">🐺 начался гон</button>';
    else if (f.state === 'postpartum' || f.pp_day != null) b += '<button class="pb-cal-act" data-act="birth" type="button">👶 роды сюда</button>';
    else if (f.state === 'pregnancy' || f.week != null) b += '<button class="pb-cal-act" data-act="due" type="button">🍼 сюда ПДР</button>';
    else b += '<button class="pb-cal-act" data-act="period" type="button">🩸 месячные</button><button class="pb-cal-act" data-act="ovu" type="button">💜 овуляция</button>';
    b += '<button class="pb-cal-act" data-act="today" type="button">📅 сделать сегодня</button><button class="pb-cal-act" data-act="cancel" type="button">✕</button>';
    return '<div style="margin-top:8px;padding:8px;border-radius:10px;background:rgba(240,168,196,0.08);border:1px solid rgba(240,168,196,0.18);"><div style="font-size:9px;color:var(--pb-t1);margin-bottom:6px;">' + lbl + ':</div><div style="display:flex;flex-wrap:wrap;gap:5px;">' + b + '</div></div>';
  }

  function calendarHtml(f, gd, vm, selISO) {
    var y = vm.getFullYear(), mo = vm.getMonth();
    var startWd = (new Date(y, mo, 1).getDay() + 6) % 7;
    var dim = new Date(y, mo + 1, 0).getDate();
    var head = WD.map(function (w) { return '<div style="text-align:center;font-size:8px;color:var(--pb-t3);padding:2px 0;">' + w + '</div>'; }).join('');
    var todayISO = toISO(gd), cells = '';
    for (var i = 0; i < startWd; i++) cells += '<div></div>';
    for (var dn = 1; dn <= dim; dn++) {
      var date = new Date(y, mo, dn), info = dayInfo(f, date, gd), isT = toISO(date) === todayISO;
      cells += '<div class="pb-cal-day" data-iso="' + toISO(date) + '" style="position:relative;aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:8px;background:' + (info.bg || 'transparent') + ';' + (isT ? 'box-shadow:0 0 0 2px var(--pb-accent,#f0a8c4);' : '') + 'cursor:pointer;font-size:10px;color:var(--pb-t2);">' + (info.ring ? '<span style="position:absolute;inset:2px;border:2px solid ' + info.ring + ';border-radius:50%;pointer-events:none;box-shadow:0 0 6px ' + info.ring + ';"></span>' : '') + dn + (info.mark ? '<span style="position:absolute;bottom:-1px;right:1px;font-size:8px;">' + info.mark + '</span>' : '') + '</div>';
    }
    return '<div class="pb-cal">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;">' +
      '<button class="pb-cal-prev" type="button" style="background:none;border:none;color:var(--pb-t2);font-size:15px;cursor:pointer;padding:2px 10px;">‹</button>' +
      '<div style="font-size:12px;font-weight:600;color:var(--pb-t1);">' + MON_NOM[mo] + ' ' + y + '</div>' +
      '<button class="pb-cal-next" type="button" style="background:none;border:none;color:var(--pb-t2);font-size:15px;cursor:pointer;padding:2px 10px;">›</button></div>' +
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">' + head + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-top:2px;">' + cells + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 10px;margin-top:9px;font-size:8px;color:var(--pb-t3);">' + calLegend(f) + '</div>' +
      '<div style="font-size:9px;color:var(--pb-t3);margin-top:8px;line-height:1.4;">📅 сегодня в игре: <b style="color:var(--pb-t1);">' + gd.getDate() + ' ' + MON_RU[gd.getMonth()] + ' ' + gd.getFullYear() + '</b></div>' +
      '<div style="display:flex;gap:5px;align-items:center;margin-top:6px;"><input class="pb-date-in" type="text" placeholder="ДД.ММ.ГГГГ" style="flex:1;min-width:0;box-sizing:border-box;background:var(--pb-input-bg);border:1px solid rgba(240,168,196,0.22);border-radius:8px;padding:6px 8px;color:var(--pb-t1);font:inherit;font-size:11px;outline:none;"><button class="pb-date-set" type="button" style="border:1px solid rgba(240,168,196,0.28);background:rgba(240,168,196,0.14);color:var(--pb-t2);font:inherit;font-size:11px;padding:6px 11px;border-radius:8px;cursor:pointer;white-space:nowrap;">задать</button></div>' +
      calBar(f, selISO) + '</div>';
  }

  var viewMonth = null, selDay = null;
  async function markDay(date, type) {
    var st = await tavo.get(ST_KEY, 'chat'); var f = (st && st.fields) || {}; var len = num(f.length, 28); if (len < 4) len = 28;
    if (type === 'due') { await tavo.set(ANCHOR_KEY, { kind: 'pregnancy', due: toISO(date) }, 'chat'); }
    else if (type === 'birth') { await tavo.set(ANCHOR_KEY, { kind: 'postpartum', birth: toISO(date), total: num(f.pp_total, LOCHIA_LEN) }, 'chat'); }
    else {
      var start = type === 'period' ? date : type === 'ovu' ? addDays(date, -((len - 14) - 1)) : addDays(date, -Math.floor(len * 0.72));
      await tavo.set(ANCHOR_KEY, { kind: cycleKind(), start: toISO(start), length: len }, 'chat');
    }
    toast('цикл отмечен ✓');
    if (configured()) { genBio(); }
    else { var gd = await loadGameDate(); if (f.state) { f = await applyAnchor(f, gd); await tavo.set(ST_KEY, { fields: f, count: (st && st.count) || 0 }, 'chat'); } renderCalendar(); }
  }
  async function renderCalendar() {
    var st = await tavo.get(ST_KEY, 'chat'); var f = st && st.fields;
    if (!f || !f.state || f.state === 'none') { out.innerHTML = '<div class="pb-cap">сначала посчитай состояние на вкладке 🌸</div>'; if (root.classList.contains('open')) placePop(); return; }
    var gd = await loadGameDate();
    if (!viewMonth) viewMonth = new Date(gd.getFullYear(), gd.getMonth(), 1);
    out.innerHTML = calendarHtml(f, gd, viewMonth, selDay);
    out.querySelector('.pb-cal-prev').addEventListener('click', function (e) { e.stopPropagation(); selDay = null; viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderCalendar(); });
    out.querySelector('.pb-cal-next').addEventListener('click', function (e) { e.stopPropagation(); selDay = null; viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderCalendar(); });
    out.querySelectorAll('.pb-cal-day').forEach(function (c) { c.addEventListener('click', function (e) { e.stopPropagation(); selDay = c.getAttribute('data-iso'); renderCalendar(); }); });
    out.querySelectorAll('.pb-cal-act').forEach(function (b) {
      b.addEventListener('click', async function (e) {
        e.stopPropagation(); var act = b.getAttribute('data-act'), d = parseISO(selDay); selDay = null;
        if (!d || act === 'cancel') { renderCalendar(); return; }
        if (act === 'today') { await saveGameDate(d); await syncDayToDate(d); toast('📅 сегодня: ' + d.getDate() + ' ' + MON_RU[d.getMonth()]); renderCalendar(); return; }
        await markDay(d, act);
      });
    });
    var di = out.querySelector('.pb-date-in'), ds = out.querySelector('.pb-date-set');
    async function setTyped() {
      var d = parseUserDate(di && di.value);
      if (!d || isNaN(d.getTime())) { toast('дата: ДД.ММ.ГГГГ или ГГГГ-ММ-ДД'); return; }
      selDay = null; viewMonth = new Date(d.getFullYear(), d.getMonth(), 1);
      await saveGameDate(d); await syncDayToDate(d); toast('📅 дата: ' + d.getDate() + ' ' + MON_RU[d.getMonth()] + ' ' + d.getFullYear()); renderCalendar();
    }
    if (ds) ds.addEventListener('click', function (e) { e.stopPropagation(); setTyped(); });
    if (di) di.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.stopPropagation(); setTyped(); } });
    if (root.classList.contains('open')) placePop();
  }

  var view = 'panel';
  function setTabs() { root.querySelectorAll('.pb-tab').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === view); }); }
  async function showView(v) {
    view = v; setTabs(); selDay = null;
    if (v === 'cal') { renderCalendar(); return; }
    var st = await tavo.get(ST_KEY, 'chat');
    if (st && st.fields) renderState(st.fields); else if (configured()) genBio(); else openForm();
  }

  /* ── ЯКОРЬ ЦИКЛА: день привязан к игровой дате, не «плывёт» от сообщений ── */
  var ANCHOR_KEY = 'pusya_bio_anchor';
  function cycleKind() { if (mode() === 'omega') { if (dyn() === 'alpha') return 'rut'; if (dyn() === 'beta') return 'cycle'; return 'heat'; } return 'cycle'; }
  async function computeLock(gd) {
    var a = await tavo.get(ANCHOR_KEY, 'chat');
    if (a && a.kind === 'pregnancy' && a.due) { var left = Math.max(0, diffDays(parseISO(a.due), gd)); return { kind: 'pregnancy', week: Math.max(1, Math.min(42, 40 - Math.ceil(left / 7))), days_left: left }; }
    if (a && a.kind === 'postpartum' && a.birth) { var since = diffDays(gd, parseISO(a.birth)); return { kind: 'postpartum', pp_day: Math.max(1, since + 1), pp_total: num(a.total, LOCHIA_LEN) }; }
    var kind = cycleKind();
    if (a && a.kind === kind && a.start) { var len = num(a.length, 28); var n = diffDays(gd, parseISO(a.start)); return { kind: kind, day: ((n % len) + len) % len + 1, length: len }; }
    return null;
  }
  async function applyAnchor(f, gd) {
    if (f.state === 'pregnancy' || f.week != null) {
      var a = await tavo.get(ANCHOR_KEY, 'chat');
      if (!a || a.kind !== 'pregnancy' || !a.due) {
        var dl = num(f.days_left, null); if (dl == null) dl = Math.max(0, (40 - num(f.week, 8)) * 7 - num(f.day, 0));
        a = { kind: 'pregnancy', due: toISO(addDays(gd, dl)) };
        await tavo.set(ANCHOR_KEY, a, 'chat');
      }
      var left = Math.max(0, diffDays(parseISO(a.due), gd));
      f.days_left = left; f.week = Math.max(1, Math.min(42, 40 - Math.ceil(left / 7)));
      return f;
    }
    if (f.state === 'postpartum' || f.pp_day != null) {
      var ap = await tavo.get(ANCHOR_KEY, 'chat');
      var tot = num(f.pp_total, LOCHIA_LEN); if (tot < 14 || tot > 90) tot = LOCHIA_LEN;
      if (!ap || ap.kind !== 'postpartum' || !ap.birth) {
        var pd = num(f.pp_day, 1); if (pd < 1) pd = 1;
        ap = { kind: 'postpartum', birth: toISO(addDays(gd, -(pd - 1))), total: tot };
        await tavo.set(ANCHOR_KEY, ap, 'chat');
      }
      var since = diffDays(gd, parseISO(ap.birth));
      f.pp_day = Math.max(1, since + 1); f.pp_total = num(ap.total, tot);
      return f;
    }
    var kind = cycleKind();
    var an = await tavo.get(ANCHOR_KEY, 'chat');
    if (an && an.kind === kind && an.start) {
      var len = num(an.length, 28); var n = diffDays(gd, parseISO(an.start));
      f.day = ((n % len) + len) % len + 1; f.length = len;
    } else {
      var L = num(f.length, 28); if (L < 4) L = 28; var D = num(f.day, 1); if (D < 1) D = 1;
      await tavo.set(ANCHOR_KEY, { kind: kind, start: toISO(addDays(gd, -(D - 1))), length: L }, 'chat');
      f.day = D; f.length = L;
    }
    return f;
  }
  async function resetAnchor() { try { await tavo.set(ANCHOR_KEY, null, 'chat'); } catch (e) {} }
  // дата поменялась вручную (без пересчёта моделью): подтянуть день из якоря,
  // чтобы цикл стоял на месте, а не «ехал» вместе с датой
  async function syncDayToDate(gd) {
    var st = await tavo.get(ST_KEY, 'chat');
    if (!st || !st.fields || !st.fields.state || st.fields.state === 'none') return;
    var an = await tavo.get(ANCHOR_KEY, 'chat');
    if (!an || (!an.start && !an.due && !an.birth)) return; // нет якоря — не пиннимся к новой дате, ждём пересчёта
    var f = await applyAnchor(st.fields, gd);
    await tavo.set(ST_KEY, { fields: f, count: (st.count) || 0 }, 'chat');
    writeInject(f);
  }

  // строка, которую плагин допишет в промпт основной модели (влияние на отыгрыш)
  function injectText(f) {
    if (!f || !f.state || f.state === 'none') return '';
    var who = charName || 'персонаж';
    var g = cfg.gender === 'm' ? ' Пол персонажа — МУЖСКОЙ: используй мужской род и местоимения он/его, даже если это омега в течке.' : cfg.gender === 'f' ? ' Пол персонажа — ЖЕНСКИЙ: используй женский род и местоимения она/её.' : ' Сохраняй тот пол и род персонажа, что заданы в сюжете; не меняй их из-за течки/цикла.';
    var b = [];
    function W(facts) {
      return '[Фон для отыгрыша ' + who + ', НЕ для показа читателю: ' + facts + '.' + g + ' Это только скрытый фон — НЕ описывай его отдельным предложением/абзацем, НЕ упоминай цикл/фазы/числа/термины прямо. Пусть лишь ЕДВА окрашивает тело, настроение и инициативу. В большинстве реплик это НИКАК не проявляется словами; заметно отражай только в пиковые моменты (сильные симптомы, овуляция, пик течки/гона).]';
    }
    if (f.state === 'heat' || f.slick != null) {
      deriveHeat(f);
      b.push('омега, фаза ' + f.phase + ' (течка)');
      if (f.slick) b.push('слизь: ' + f.slick);
      if (f.fertility) b.push('фертильность: ' + f.fertility);
      if (f.pheromones) b.push('феромоны: ' + f.pheromones);
      if (f.need_alpha) b.push('тяга к альфе: ' + f.need_alpha);
      if (f.moodlet) b.push('настроение: ' + String(f.moodlet).replace(/[\[\]]/g, ''));
      if (f.symptoms) b.push('самочувствие: ' + f.symptoms);
      return W(b.join('; '));
    }
    if (f.state === 'rut' || f.knot != null) {
      deriveRut(f);
      b.push('альфа, фаза ' + f.phase + ' (гон)');
      if (f.dominance) b.push('доминантность: ' + f.dominance);
      if (f.knot) b.push('узел: ' + f.knot);
      if (f.pheromones) b.push('феромоны: ' + f.pheromones);
      if (f.trigger && f.trigger !== 'Нет') b.push('триггер: ' + f.trigger);
      if (f.moodlet) b.push('настроение: ' + String(f.moodlet).replace(/[\[\]]/g, ''));
      if (f.symptoms) b.push('самочувствие: ' + f.symptoms);
      return W(b.join('; '));
    }
    if (f.state === 'postpartum' || f.pp_day != null) {
      derivePostpartum(f);
      b.push('после родов, день ' + f.pp_day + ' (' + f.recovery + ')');
      if (f.lochia) b.push('послеродовые выделения (лохии): ' + f.lochia);
      if (f.lactation) b.push('лактация: ' + f.lactation);
      if (f.symptoms) b.push('самочувствие: ' + f.symptoms);
      if (f.energy) b.push('энергия: ' + f.energy);
      if (f.moodlet) b.push('настроение: ' + String(f.moodlet).replace(/[\[\]]/g, ''));
      return W(b.join('; '));
    }
    if (f.state === 'pregnancy' || f.week != null) {
      derivePreg(f);
      b.push('беременность ' + f.week + ' нед (' + f.trimester + ' триместр)');
      if (f.symptoms) b.push('самочувствие: ' + f.symptoms);
      if (f.energy) b.push('энергия: ' + f.energy);
      if (f.moodlet) b.push('настроение: ' + String(f.moodlet).replace(/[\[\]]/g, ''));
      if (f.cravings) b.push('тянет: ' + f.cravings);
      return W(b.join('; '));
    }
    deriveCycle(f);
    b.push('цикл, день ' + f.day + ' (' + f.phase + ')');
    if (f.libido) b.push('либидо: ' + f.libido);
    if (f.fertility) b.push('фертильность: ' + f.fertility);
    if (f.energy) b.push('энергия: ' + f.energy);
    if (f.moodlet) b.push('настроение: ' + String(f.moodlet).replace(/[\[\]]/g, ''));
    if (f.symptoms) b.push('симптомы: ' + f.symptoms);
    if (f.cravings) b.push('тянет: ' + f.cravings);
    return W(b.join('; '));
  }
  function writeInject(f) {
    try { tavo.file.save(INJECT_FILE, (cfg.injectRP === false) ? '' : injectText(f)); } catch (e) {}
  }

  /* ── форма настроек прямо в диалоге (прокси вшит, не спрашиваем) ── */
  /* ── экран отчёта: текст можно скопировать кнопкой или выделить вручную ── */
  function openDiag() {
    var rep = diagReport();
    out.innerHTML = '<div class="pb-form">' +
      '<label>Отчёт для разработчика (API-ключ сюда НЕ попадает)</label>' +
      '<textarea class="pb-diag-ta" readonly style="width:100%;box-sizing:border-box;height:220px;background:var(--pb-input-bg);border:1px solid rgba(240,168,196,0.22);border-radius:8px;padding:7px 9px;color:var(--pb-t1);font:inherit;font-size:10px;line-height:1.35;outline:none;white-space:pre;overflow:auto;"></textarea>' +
      '<div class="pb-form-btns"><button class="pb-diag-copy" type="button">📋 скопировать</button><button class="pb-diag-back" type="button">назад</button></div>' +
      '<button class="pb-diag-clear" type="button" style="margin-top:9px;width:100%;border:1px solid rgba(240,168,196,0.22);background:rgba(240,168,196,0.06);color:var(--pb-t2);font:inherit;font-size:11px;padding:7px 10px;border-radius:10px;cursor:pointer;">🧹 очистить журнал</button>' +
      '<div class="pb-hint">Если кнопка «скопировать» не сработала (бывает в мобильных браузерах) — выдели текст в поле пальцем и скопируй вручную.</div></div>';
    var ta = out.querySelector('.pb-diag-ta'); if (ta) ta.value = rep;
    var cp = out.querySelector('.pb-diag-copy');
    if (cp) cp.addEventListener('click', async function (e) {
      e.stopPropagation();
      var ok = await copyText(rep);
      if (ok) { cp.textContent = '✓ скопировано'; toast('отчёт скопирован'); setTimeout(function () { cp.textContent = '📋 скопировать'; }, 1800); }
      else { try { ta.focus(); ta.select(); } catch (e2) {} toast('выдели и скопируй вручную'); }
    });
    var bk = out.querySelector('.pb-diag-back');
    if (bk) bk.addEventListener('click', function (e) { e.stopPropagation(); openForm(); });
    var cl = out.querySelector('.pb-diag-clear');
    if (cl) cl.addEventListener('click', async function (e) { e.stopPropagation(); diag = []; try { await tavo.set(DIAG_KEY, [], 'global'); } catch (e2) {} openDiag(); });
    if (root.classList.contains('open')) placePop();
  }

  function openForm() {
    out.innerHTML =
      '<div class="pb-form">' +
      '<label>Адрес провайдера (base URL)</label><input class="pb-i" data-k="providerUrl" placeholder="https://api.linkapi.ai/v1">' +
      '<label>API-ключ провайдера</label><input class="pb-i" data-k="apiKey" type="password" placeholder="sk-…">' +
      '<label>Модель-считалка</label><input class="pb-i" data-k="model" placeholder="напр. gemini-2.5-flash">' +
      '<label>Пересчитывать раз в N ответов</label><input class="pb-i" data-k="everyN" type="number" min="1" max="50" placeholder="3">' +
      '<label>Режим плашки</label><select class="pb-i" data-k="mode"><option value="classic">Обычный</option><option value="omega">Омегаверс</option></select>' +
      '<label>Динамика (для омегаверса)</label><select class="pb-i" data-k="dynamic"><option value="omega">Омега (течка)</option><option value="alpha">Альфа (гон)</option><option value="beta">Бета (обычный цикл)</option></select>' +
      '<label>Пол персонажа (для местоимений в промпте)</label><select class="pb-i" data-k="gender"><option value="">— не указывать —</option><option value="m">Мужской (он/его)</option><option value="f">Женский (она/её)</option></select>' +
      '<label>Тема оформления</label><div class="pb-themes">' + '<button class="pb-th" data-th="light" type="button">☀️ Светлая</button>' + '<button class="pb-th" data-th="dark" type="button">🌙 Тёмная</button>' + '<button class="pb-th" data-th="glass" type="button">✨ Прозрачная</button></div>' +
      '<label style="display:flex;align-items:center;gap:7px;margin-top:10px;cursor:pointer;"><input type="checkbox" class="pb-inject"> влиять на ролеплей (передавать состояние модели)</label>' +
      '<label style="display:flex;align-items:center;gap:7px;margin-top:8px;cursor:pointer;"><input type="checkbox" class="pb-calauto"> 📅 отслеживать игровую дату (метка в ответе, для календаря)</label>' +
      '<div class="pb-form-btns"><button class="pb-save" type="button">💾 сохранить</button><button class="pb-cancel" type="button">закрыть</button></div>' +
      '<button class="pb-reset" type="button" style="margin-top:9px;width:100%;border:1px solid rgba(240,168,196,0.22);background:rgba(240,168,196,0.06);color:var(--pb-t2);font:inherit;font-size:11px;padding:7px 10px;border-radius:10px;cursor:pointer;">🔄 сбросить цикл (перечитать день из сюжета)</button>' +
      '<button class="pb-diag" type="button" style="margin-top:7px;width:100%;border:1px solid rgba(240,168,196,0.22);background:rgba(240,168,196,0.06);color:var(--pb-t2);font:inherit;font-size:11px;padding:7px 10px;border-radius:10px;cursor:pointer;">📋 отчёт об ошибке</button>' +
      '<div class="pb-hint">Прокси вшит. Ключ хранится в Tavo и уходит только на него. «Влиять на ролеплей» — состояние тихо дописывается в промпт. «Отслеживать дату» — модель в конце ответа ставит скрытую дату (её никто не видит), календарь по ней двигает день; тратит немного токенов. Сбрось цикл, если день привязался неверно.</div>' +
      '</div>';
    (function bindThemes() {
      var btns = out.querySelectorAll('.pb-th'); if (!btns.length) return;
      function sync() { btns.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-th') === theme()); }); }
      btns.forEach(function (b) {
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          cfg.theme = b.getAttribute('data-th');
          try { tavo.set(CFG_KEY, cfg, 'global'); } catch (e2) {}
          applyTheme(); sync();
        });
      });
      sync();
    })();
    var injEl = out.querySelector('.pb-inject');
    if (injEl) {
      injEl.checked = cfg.injectRP !== false;
      injEl.addEventListener('change', async function () {
        cfg.injectRP = injEl.checked;
        try { tavo.set(CFG_KEY, cfg, 'global'); } catch (e) {}
        var st = await tavo.get(ST_KEY, 'chat'); writeInject(st && st.fields);
      });
    }
    var caEl = out.querySelector('.pb-calauto');
    if (caEl) {
      caEl.checked = cfg.calAuto !== false;
      caEl.addEventListener('change', function () {
        cfg.calAuto = caEl.checked;
        try { tavo.set(CFG_KEY, cfg, 'global'); } catch (e) {}
        try { tavo.file.save('pusya_bio_calauto', caEl.checked ? '1' : '0'); } catch (e) {}
      });
    }
    var rsEl = out.querySelector('.pb-reset');
    if (rsEl) rsEl.addEventListener('click', async function (e) { e.stopPropagation(); await resetAnchor(); toast('цикл сброшен — нажми ⟳'); });
    var dgEl = out.querySelector('.pb-diag');
    if (dgEl) dgEl.addEventListener('click', function (e) { e.stopPropagation(); openDiag(); });
    // подставляем сохранённое и сохраняем КАЖДЫЙ ввод сразу (чтобы не терялось при
    // сворачивании приложения / перезагрузке webview, пока копируешь ключ)
    var saveT = null;
    function persist() { clearTimeout(saveT); saveT = setTimeout(function () { try { tavo.set(CFG_KEY, cfg, 'global'); } catch (e) {} }, 250); }
    out.querySelectorAll('.pb-i').forEach(function (inp) {
      var k = inp.getAttribute('data-k');
      if (cfg[k] != null) inp.value = cfg[k];
      function upd() {
        var v = inp.value.trim();
        cfg[k] = (k === 'everyN') ? String(num(v, 3) < 1 ? 3 : num(v, 3)) : v;
        persist();
      }
      inp.addEventListener('input', upd);
      inp.addEventListener('change', upd);
    });
    out.querySelector('.pb-save').addEventListener('click', async function () {
      out.querySelectorAll('.pb-i').forEach(function (inp) {
        var k = inp.getAttribute('data-k'), v = inp.value.trim();
        cfg[k] = (k === 'everyN') ? String(num(v, 3) < 1 ? 3 : num(v, 3)) : v;
      });
      await tavo.set(CFG_KEY, cfg, 'global');
      toast('сохранено');
      if (configured()) genBio(); else out.innerHTML = '<div class="pb-cap">заполни провайдера, ключ и модель</div>';
    });
    out.querySelector('.pb-cancel').addEventListener('click', async function () {
      var st = await tavo.get(ST_KEY, 'chat');
      if (st && st.fields) renderState(st.fields);
      else if (configured()) genBio();
      else closePop();
    });
    if (root.classList.contains('open')) placePop();
  }

  /* ── генерация ── */
  var busy = false;
  async function genBio() {
    if (busy) return;
    cfg = (await tavo.get(CFG_KEY, 'global')) || cfg;
    if (!configured()) { openForm(); return; }
    busy = true; if (refBtn) refBtn.classList.add('spin');
    if (view === 'panel') out.innerHTML = '<div class="pb-cap">✨ считаю состояние…</div>';
    try {
      var gd = await loadGameDate();
      var storedISO = await loadGameDateISO();
      var lock = await computeLock(gd);
      var cx = await buildContext();
      var last = await tavo.get(ST_KEY, 'chat');
      var messages = [{ role: 'system', content: buildSystem() }, { role: 'user', content: buildUserPrompt(cx, last && last.fields, lock, storedISO) }];
      var raw = await callModel(messages);
      // пустой ответ (частый случай у gemini: весь лимит съело «мышление» или сработали фильтры)
      if (!String(raw || '').trim()) { diagPush('пусто', 'модель вернула пустой ответ'); throw new Error('модель вернула пустой ответ. Обычно это лимит токенов (у gemini его съедает «мышление») или фильтры провайдера — попробуй другую модель-считалку.'); }
      var f = parseBlock(raw);
      if (!Object.keys(f).length) { diagPush('не разобрать', String(raw).slice(0, 300)); throw new Error('не разобрать ответ модели: ' + esc(String(raw).slice(0, 140))); }
      if (!f.state) f.state = (f.pp_day != null ? 'postpartum' : f.knot != null ? 'rut' : f.slick != null ? 'heat' : f.week != null ? 'pregnancy' : f.day != null ? ((mode() === 'omega' && dyn() === 'omega') ? 'heat' : 'cycle') : 'none');
      // НЕ затираем рабочее состояние пустышкой (иначе плашка «пропадает» после одного сбойного ответа)
      if (f.state === 'none' && last && last.fields && last.fields.state && last.fields.state !== 'none') {
        diagPush('пустышка', 'модель вернула state=none — оставили прежнее состояние');
        writeInject(last.fields);
        if (view === 'cal') renderCalendar(); else renderState(last.fields);
        return;
      }
      // дата из СЮЖЕТА (считалка читает историю) — определяет дату даже в существующем чате
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(f.date || '')) && f.date !== storedISO) { await saveGameDate(parseISO(f.date)); gd = parseISO(f.date); }
      f = await applyAnchor(f, gd);
      var total = await tavo.message.count();
      await tavo.set(ST_KEY, { fields: f, count: total }, 'chat');
      writeInject(f);
      diagPush('ок', 'state=' + f.state + (f.day != null ? ' день=' + f.day : '') + (f.week != null ? ' нед=' + f.week : '') + (f.pp_day != null ? ' пп=' + f.pp_day : '') + ' дата=' + (f.date || '—'));
      if (view === 'cal') renderCalendar(); else renderState(f);
    } catch (e) {
      diagPush('сбой', (e && e.message) || e);
      if (view === 'panel') out.innerHTML = '<div class="pb-err">⚠️ ' + esc((e && e.message) || e) + '<div style="margin-top:7px;font-size:10px;opacity:.8;">открой ⚙ → «📋 отчёт об ошибке», чтобы скопировать подробности</div></div>';
    } finally { busy = false; if (refBtn) refBtn.classList.remove('spin'); }
  }

  // на каждом монтировании (новое сообщение) держим состояние свежим и пишем мост-инжект,
  // даже если плашку не открывали — иначе модель не получит влияние
  async function ensureFresh() {
    try { tavo.file.save('pusya_bio_calauto', (cfg.calAuto === false) ? '0' : '1'); } catch (e) {}
    if (!configured()) return;
    var st = await tavo.get(ST_KEY, 'chat');
    var total = await tavo.message.count();
    var due = !st || (total - (st.count || 0)) >= everyN();
    if (due) { genBio(); }            // сам посчитает, сохранит и запишет инжект
    else {
      writeInject(st.fields);         // мост из перенесённого состояния
      // если плашка открыта — освежаем видимое (важно при смене чата: DOM не перемонтируется)
      if (root.classList.contains('open')) { if (view === 'cal') renderCalendar(); else if (st.fields) renderState(st.fields); }
    }
  }

  async function fillOnOpen() {
    if (!configured()) { openForm(); return; }
    var st = await tavo.get(ST_KEY, 'chat');
    if (st && st.fields) renderState(st.fields); else genBio();
  }
  // всплывашку ставим рядом с кружком, куда бы его ни отодвинули
  var popMoved = false; // плашку подвинули вручную — не переанкорим её к кружку
  function placePop() {
    if (!root.classList.contains('open')) return;
    if (popMoved) return;
    var r = fab.getBoundingClientRect();
    var vw = pwin.innerWidth || pdoc.documentElement.clientWidth || 360;
    var vh = pwin.innerHeight || pdoc.documentElement.clientHeight || 640;
    var W = Math.min(420, vw - 24);
    pop.style.width = W + 'px';
    var ph = pop.offsetHeight || 300;
    var left = Math.min(Math.max(12, r.left + r.width / 2 - W / 2), vw - 12 - W);
    var top;
    if (r.top - ph - 10 >= 8) top = r.top - ph - 10;
    else if (r.bottom + ph + 10 <= vh - 8) top = r.bottom + 10;
    else top = Math.max(8, vh - ph - 8);
    var o = cbOrigin(pop); // перевод в координаты контейнинг-блока (устойчиво к трансформированному родителю)
    pop.style.left = (left - o.x) + 'px'; pop.style.top = (top - o.y) + 'px';
    pop.style.right = 'auto'; pop.style.bottom = 'auto';
  }

  var opened = false;
  function openPop() { popMoved = false; root.classList.add('open'); placePop(); if (!opened) { opened = true; fillOnOpen(); } else { placePop(); } }
  function closePop() { root.classList.remove('open'); }

  // ── перетаскивание кружка (позиция сохраняется) ──
  var FABPOS_KEY = 'pusya_bio_fabpos';
  // ── координаты ВЬЮПОРТА, устойчивые к трансформированному родителю (iOS Safari + мобильные скины) ──
  // Если body/контейнер имеет transform, position:fixed считается от него, а не от экрана.
  // Меряем, где оказался origin контейнинг-блока элемента, и переводим желаемые экранные координаты в left/top.
  function cbOrigin(el) {
    var sl = el.style.left, st = el.style.top, sr = el.style.right, sb = el.style.bottom;
    el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.left = '0px'; el.style.top = '0px';
    var r = el.getBoundingClientRect();
    el.style.left = sl; el.style.top = st; el.style.right = sr; el.style.bottom = sb;
    return { x: r.left, y: r.top };
  }
  function clampVX(vx) { var w = 44; return Math.min(Math.max(2, vx), (pwin.innerWidth || 360) - w - 2); }
  function clampVY(vy) { var h = 44; return Math.min(Math.max(2, vy), (pwin.innerHeight || 640) - h - 2); }
  function placeFabViewport(vx, vy) {
    var o = cbOrigin(fab);
    fab.style.left = (clampVX(vx) - o.x) + 'px'; fab.style.top = (clampVY(vy) - o.y) + 'px';
    fab.style.right = 'auto'; fab.style.bottom = 'auto';
  }
  (function loadFabPos() {
    var vw = pwin.innerWidth || 360, vh = pwin.innerHeight || 640;
    var vx = vw - 58, vy = vh - 140; // дефолт: правый нижний угол
    try { var s = pwin.localStorage.getItem(FABPOS_KEY); if (s) { var o = JSON.parse(s); if (o && o.vx != null) { vx = o.vx; vy = o.vy; } } } catch (e) {}
    placeFabViewport(vx, vy);
  })();
  (function makeDraggable() {
    var dragging = false, moved = false, sx = 0, sy = 0, svx = 0, svy = 0, orig = { x: 0, y: 0 };
    function down(e) {
      var p = e.touches ? e.touches[0] : e; dragging = true; moved = false;
      var r = fab.getBoundingClientRect(); svx = r.left; svy = r.top; sx = p.clientX; sy = p.clientY;
      orig = cbOrigin(fab); // origin контейнинг-блока фиксируем один раз на время драга
      fab.style.transition = 'none';
      if (e.cancelable) e.preventDefault();
    }
    function move(e) {
      if (!dragging || !alive()) return;
      var p = e.touches ? e.touches[0] : e;
      var dx = p.clientX - sx, dy = p.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      var vx = clampVX(svx + dx), vy = clampVY(svy + dy);
      fab.style.left = (vx - orig.x) + 'px'; fab.style.top = (vy - orig.y) + 'px'; fab.style.right = 'auto'; fab.style.bottom = 'auto';
      if (root.classList.contains('open')) placePop();
      if (e.cancelable) e.preventDefault();
    }
    function up() {
      if (!dragging || !alive()) return; dragging = false; fab.style.transition = '';
      var r = fab.getBoundingClientRect();
      if (moved) { try { pwin.localStorage.setItem(FABPOS_KEY, JSON.stringify({ vx: r.left, vy: r.top })); } catch (e) {} }
      else { if (root.classList.contains('open')) closePop(); else openPop(); }
    }
    fab.addEventListener('mousedown', down); pwin.addEventListener('mousemove', move); pwin.addEventListener('mouseup', up);
    fab.addEventListener('touchstart', down, { passive: false }); pwin.addEventListener('touchmove', move, { passive: false }); pwin.addEventListener('touchend', up);
  })();

  // перетаскивание самой плашки за её шапку (кроме кнопок). move/up вешаем только на время драга — без утечки
  (function makePopDraggable() {
    var head = root.querySelector('.pb-pop-head'); if (!head) return;
    head.style.cursor = 'grab'; head.style.touchAction = 'none';
    var sx = 0, sy = 0, ovx = 0, ovy = 0, orig = { x: 0, y: 0 };
    function move(e) {
      if (!alive()) return;
      var p = e.touches ? e.touches[0] : e;
      var vw = pwin.innerWidth, vh = pwin.innerHeight, w = pop.offsetWidth, h = pop.offsetHeight;
      var vx = Math.min(Math.max(6, ovx + (p.clientX - sx)), Math.max(6, vw - w - 6));
      var vy = Math.min(Math.max(6, ovy + (p.clientY - sy)), Math.max(6, vh - h - 6));
      popMoved = true;
      pop.style.left = (vx - orig.x) + 'px'; pop.style.top = (vy - orig.y) + 'px'; pop.style.right = 'auto'; pop.style.bottom = 'auto';
      if (e.cancelable) e.preventDefault();
    }
    function up() {
      pop.style.transition = ''; head.style.cursor = 'grab';
      pwin.removeEventListener('mousemove', move); pwin.removeEventListener('mouseup', up);
      pwin.removeEventListener('touchmove', move); pwin.removeEventListener('touchend', up);
    }
    function down(e) {
      if (e.target && e.target.closest && e.target.closest('button')) return; // клики по вкладкам/кнопкам не тащат
      var p = e.touches ? e.touches[0] : e;
      var r = pop.getBoundingClientRect(); ovx = r.left; ovy = r.top; sx = p.clientX; sy = p.clientY;
      orig = cbOrigin(pop);
      pop.style.transition = 'none'; head.style.cursor = 'grabbing';
      pwin.addEventListener('mousemove', move); pwin.addEventListener('mouseup', up);
      pwin.addEventListener('touchmove', move, { passive: false }); pwin.addEventListener('touchend', up);
      if (e.cancelable) e.preventDefault();
    }
    head.addEventListener('mousedown', down);
    head.addEventListener('touchstart', down, { passive: false });
  })();

  closeBtn.addEventListener('click', function (e) { e.stopPropagation(); closePop(); });
  gearBtn.addEventListener('click', function (e) { e.stopPropagation(); root.classList.add('open'); opened = true; openForm(); });
  refBtn.addEventListener('click', function (e) { e.stopPropagation(); opened = true; genBio(); });
  root.querySelectorAll('.pb-tab').forEach(function (b) { b.addEventListener('click', function (e) { e.stopPropagation(); showView(b.getAttribute('data-v')); }); });
  setTabs();
  pop.addEventListener('click', function (e) { e.stopPropagation(); });
  // клик мимо НЕ закрывает — иначе теряется форма, пока уходишь копировать ключ.
  // закрытие только по ✕ или повторному тапу кружка.

  // события от плагина (entry): новое сообщение → пересчёт/мост; «открыть» из меню.
  // дебаунс: на стриминге message:updated летит на каждый токен — схлопываем в один пересчёт.
  var freshT = null;
  function scheduleFresh() { if (freshT) return; freshT = setTimeout(function () { freshT = null; if (alive()) ensureFresh(); }, 350); }
  function onMsg() { if (alive()) scheduleFresh(); }
  async function onChat() {
    if (!alive()) return;
    viewMonth = null; selDay = null; // календарь пересчитает месяц от даты нового чата
    try { var _cc = await tavo.chat.current(); charName = (_cc && _cc.characters && _cc.characters[0] && _cc.characters[0].name) || charName; } catch (e) {}
    cfg = (await tavo.get(CFG_KEY, 'global')) || cfg;
    scheduleFresh(); // подтянет состояние нового чата и перерисует открытый вид
  }
  function onOpen() { if (alive() && !root.classList.contains('open')) openPop(); }
  function onDate() { if (alive() && view === 'cal') renderCalendar(); }
  function onResize() {
    if (!alive()) return;
    var r = fab.getBoundingClientRect();
    placeFabViewport(r.left, r.top); // держим кружок в экране в координатах вьюпорта
    if (root.classList.contains('open')) placePop();
  }
  // снимаем слушателей прошлого монтирования — иначе за длинный чат они копятся и тормозят
  try { if (typeof pwin.__PB_cleanup === 'function') pwin.__PB_cleanup(); } catch (e) {}
  try {
    pwin.addEventListener('pusya-bio-msg', onMsg);
    pwin.addEventListener('pusya-bio-chat', onChat);
    pwin.addEventListener('pusya-bio-open', onOpen);
    pwin.addEventListener('pusya-bio-date', onDate);
    pwin.addEventListener('resize', onResize);
    pwin.__PB_cleanup = function () {
      try {
        pwin.removeEventListener('pusya-bio-msg', onMsg);
        pwin.removeEventListener('pusya-bio-chat', onChat);
        pwin.removeEventListener('pusya-bio-open', onOpen);
        pwin.removeEventListener('pusya-bio-date', onDate);
        pwin.removeEventListener('resize', onResize);
      } catch (e) {}
    };
  } catch (e) {}

  ensureFresh(); // держим состояние и мост-инжект свежими
})();
