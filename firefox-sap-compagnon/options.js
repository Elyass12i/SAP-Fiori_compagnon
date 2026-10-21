'use strict';

const $ = s => document.querySelector(s);
const { t } = SAPC_I18N;
let rules = [];

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  });
  kids.flat(Infinity).forEach(k => { if (k !== null && k !== undefined) n.append(k instanceof Node ? k : String(k)); });
  return n;
}

function renderRules() {
  const box = $('#rules');
  box.replaceChildren();
  if (!rules.length) box.append(el('p', { class: 'empty' }, t('No rules. Add DEV, ACC and PROD with the buttons below, then fill in the URL text of each one.')));
  rules.forEach((r, i) => {
    const up = el('button', { class: 'btn sm', title: t('Move up'), 'aria-label': t('Move the rule up'), disabled: i === 0 }, '↑');
    up.addEventListener('click', () => { [rules[i - 1], rules[i]] = [rules[i], rules[i - 1]]; renderRules(); });
    const del = el('button', { class: 'btn sm', title: t('Delete'), 'aria-label': t('Delete the rule') }, '✕');
    del.addEventListener('click', () => { rules.splice(i, 1); renderRules(); });
    box.append(el('div', { class: 'rule' },
      el('label', null, el('input', { type: 'checkbox', checked: r.enabled !== false, 'aria-label': t('Rule enabled'), onchange: e => { r.enabled = e.target.checked; } })),
      el('input', { type: 'text', value: r.name || '', placeholder: t('Name'), 'aria-label': t('Environment name'), oninput: e => { r.name = e.target.value; } }),
      el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#c62828', 'aria-label': t('Colour'), oninput: e => { r.color = e.target.value; } }),
      el('input', { type: 'text', class: 'mono', value: r.pattern || '', placeholder: t('e.g. sap-dev.example.com or /shop-dev/'), 'aria-label': t('URL text or regular expression'), oninput: e => { r.pattern = e.target.value; } }),
      el('input', { type: 'url', class: 'mono', value: r.base || '', placeholder: t('https://host:port'), 'aria-label': t('System URL (comparison, “Open in”, SAP logs)'), oninput: e => { r.base = e.target.value.trim(); } }),
      el('input', { type: 'text', class: 'mono', value: r.client || '', placeholder: t('e.g. 410'), 'aria-label': t('SAP client (optional)'), oninput: e => { r.client = e.target.value.trim(); } }),
      el('label', { title: t('Error simulation allowed (development systems only)') }, el('input', { type: 'checkbox', checked: r.simulate === true, 'aria-label': t('Error simulation allowed (development systems only)'), onchange: e => { r.simulate = e.target.checked; } })),
      el('span', { class: 'row', style: 'gap:4px' }, up, del)));
  });
}

async function load() {
  const s = SAPC.withDefaults((await browser.storage.local.get('settings')).settings);
  rules = s.rules.map(r => Object.assign({}, r));
  $('#lang').value = s.lang;
  setLang(s.lang);
  $('#pos').value = s.banner.position;
  $('#title').checked = !!s.banner.titlePrefix;
  $('#toasts').checked = !!s.toasts;
  $('#inspectAlt').checked = !!s.inspectAlt;
  renderRules();
}
async function save() {
  const bad = rules.find(r => /^\/.+\/$/.test(String(r.pattern || '').trim()) && (() => { try { new RegExp(r.pattern.trim().slice(1, -1)); return false; } catch (_) { return true; } })());
  if (bad) { alertBox(t('The regular expression of “{0}” is invalid.', bad.name || t('unnamed'))); return; }
  const badBase = rules.find(r => r.base && !(() => { try { return /^https?:$/.test(new URL(r.base).protocol); } catch (_) { return false; } })());
  if (badBase) { alertBox(t('The system URL of “{0}” is invalid (example: https://host:44300).', badBase.name || t('unnamed'))); return; }
  const settings = {
    rules: rules.map(r => ({ name: String(r.name || '').trim(), color: r.color || '#c62828', pattern: String(r.pattern || '').trim(), base: String(r.base || '').trim(), client: String(r.client || '').trim(), enabled: r.enabled !== false, simulate: r.simulate === true })),
    banner: { position: $('#pos').value === 'bottom' ? 'bottom' : 'top', titlePrefix: $('#title').checked },
    toasts: $('#toasts').checked,
    inspectAlt: $('#inspectAlt').checked,
    lang: $('#lang').value === 'fr' ? 'fr' : 'en'
  };
  await browser.storage.local.set({ settings });
  const s = $('#saved'); s.textContent = t('Saved ✓'); s.style.color = ''; s.hidden = false;
  setTimeout(() => { s.hidden = true; }, 2000);
}
function alertBox(text) { const s = $('#saved'); s.textContent = text; s.style.color = 'var(--bad)'; s.hidden = false; }
// Page language: applied to the preview at once, stored with the "Save" button
function setLang(lang) {
  SAPC_I18N.setLang(lang);
  SAPC_I18N.translatePage(document);
  renderRules();
  $('#testResult').hidden = true;
}
$('#lang').addEventListener('change', () => setLang($('#lang').value));

$('#add').addEventListener('click', () => { rules.push({ name: '', color: '#455a64', pattern: '', client: '', enabled: true }); renderRules(); });
document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
  rules.push(Object.assign({ enabled: true }, SAPC.PRESETS[+b.dataset.preset])); renderRules();
}));
$('#save').addEventListener('click', save);
$('#test').addEventListener('click', () => {
  const url = $('#testUrl').value.trim();
  const r = SAPC.matchEnv(rules, url);
  const out = $('#testResult');
  out.hidden = false;
  out.textContent = !url ? t('Paste a URL.')
    : r ? t('Matched: {0}{1}.', r.name || t('(unnamed)'), SAPC.isODataUrl(url) ? t(' · it is also an OData URL, its errors will be decoded') : '')
      : t('No rule matches{0}.', SAPC.isODataUrl(url) ? t(' (OData errors from this URL will still be decoded)') : '');
});
load();
