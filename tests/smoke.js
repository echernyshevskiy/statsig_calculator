const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const html = fs.readFileSync(process.argv[2] || 'index.html', 'utf8');
assert.match(html, /<details class="passport" id="metric-passport"><summary>/);
assert.doesNotMatch(html, /<details class="passport" id="metric-passport"[^>]*\bopen\b/);
assert.match(html, /<p class="passport-note" id="passport-note"><\/p><\/details>/);
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const markup = html.slice(0, html.indexOf('<script>'));
assert(script, 'inline script exists');
const scriptHash = crypto.createHash('sha256').update(script.replace(/\r\n?/g, '\n'), 'utf8').digest('base64');
assert(html.includes(`script-src 'sha256-${scriptHash}'`), 'CSP hash matches the inline script');
assert.doesNotMatch(html, /script-src 'unsafe-inline'/);
const networkPattern = /https?:\/\/|<script[^>]+src=|<link\b|<img\b|\bfetch\s*\(|XMLHttpRequest|WebSocket|@import|\burl\s*\(/i;
assert.equal(html.match(networkPattern)?.[0], undefined, 'standalone file has no network dependency');

const elements = new Map();
function makeElement(tag, attrs, inner = '') {
  const attributes = new Map([...attrs.matchAll(/([a-z][a-z-]*)="([^"]*)"/g)].map(([,key,value]) => [key,value]));
  const get = name => attributes.get(name) ?? null;
  const classes = new Set((get('class') || '').split(/\s+/).filter(Boolean));
  const el = {
    tag, id: get('id'), value: get('value') ?? '', checked: false,
    dataset: {}, events: {}, textContent: '', innerHTML: '', disabled: false,
    style: {},
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle: (name, force) => {
        const set = force === undefined ? !classes.has(name) : force;
        if (set) classes.add(name); else classes.delete(name);
        return set;
      }
    },
    addEventListener(type, callback) { (this.events[type] ||= []).push(callback); },
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return get(name); },
    focus() {}, click() { for (const fn of this.events.click || []) fn(); },
    remove() {}
  };
  for (const [, key, value] of attrs.matchAll(/\bdata-(stage|metric|for)="([^"]+)"/g)) {
    el.dataset[key] = value;
  }
  if (tag === 'select') {
    const selected = inner.match(/<option\b([^>]*\bselected[^>]*)>/)?.[1]
      || inner.match(/<option\b([^>]*)>/)?.[1];
    el.value = selected?.match(/\bvalue="([^"]+)"/)?.[1] ?? '';
  }
  return el;
}
for (const match of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)) {
  const [, tag, attrs] = match;
  const id = attrs.match(/\bid="([^"]+)"/)?.[1];
  if (!id && !/\bdata-(?:stage|metric)=/.test(attrs)) continue;
  const inner = tag === 'select' ? markup.slice(match.index + match[0].length).split('</select>', 1)[0] : '';
  if (!id) {
    const el = makeElement(tag, attrs, inner);
    elements.set(`${el.dataset.stage ? 'stage' : 'metric'}:${el.dataset.stage || el.dataset.metric}`, el);
    continue;
  }
  if (elements.has(id)) throw new Error(`duplicate id ${id}`);
  elements.set(id, makeElement(tag, attrs, inner));
}
for (const match of markup.matchAll(/\s(?:for|aria-controls)="([^"]+)"/g)) {
  assert(elements.has(match[1]), `broken field or disclosure reference: ${match[1]}`);
}
const byId = id => {
  const el = elements.get(id);
  assert(el, `missing DOM id: ${id}`);
  return el;
};
let savedBlob;
const document = {
  getElementById: byId,
  querySelectorAll(selector) {
    if (selector === 'input,select,textarea') return [...elements.values()].filter(el => ['input','select','textarea'].includes(el.tag));
    if (selector === '[data-stage]') return [...elements.values()].filter(el => el.dataset.stage);
    if (selector === '[data-metric]') return [...elements.values()].filter(el => el.dataset.metric);
    if (selector === '[data-for]') return [...elements.values()].filter(el => el.dataset.for);
    if (selector === '.help-toggle[aria-expanded="true"]') return [];
    return [];
  },
  addEventListener() {},
  createElement() { return makeElement('a', ''); },
  body: { appendChild() {} }
};
const context = {
  document,
  window: { addEventListener() {}, innerWidth: 1280, innerHeight: 800 },
  URL: { createObjectURL(blob) { savedBlob = blob; return 'blob:test'; }, revokeObjectURL() {} },
  Blob, Intl, setTimeout() {}
};
vm.runInNewContext(script, context, { filename: 'experiment-calculator.html' });
function input(id, value) { byId(id).value = String(value); for (const fn of byId(id).events.input || []) fn(); }
function check(id, value = true) { byId(id).checked = value; for (const fn of byId(id).events.input || []) fn(); }
function click(name) { byId(name).click(); }
const result = () => byId('result-area').innerHTML;

assert.match(result(), /Сколько клиентов нужно/);
assert.equal(byId('download-summary').disabled, false);
input('base-share', '1e-300');
assert.match(result(), /базовый отклик КГ от 0,01% до 99,99%/);
assert.equal(byId('download-summary').disabled, true);
input('base-share', 10);
assert.equal(byId('download-summary').disabled, false);
click('load-example');
assert.equal(byId('load-example').getAttribute('aria-expanded'), 'true');
click('load-example');
assert.equal(byId('load-example').getAttribute('aria-expanded'), 'false');
click('methodology-toggle');
assert.equal(byId('methodology-toggle').getAttribute('aria-expanded'), 'true');
click('methodology-close');
assert.equal(byId('methodology-toggle').getAttribute('aria-expanded'), 'false');
input('denominator', 'conditional');
assert.match(result(), /Уточните знаменатель отклика/);
assert.equal(byId('download-summary').disabled, true);
input('denominator', 'all');
assert.match(result(), /Сколько клиентов нужно/);

click('stage:actual');
assert.match(result(), /От результата к решению/);
input('denominator', 'conditional');
assert.match(result(), /Уточните знаменатель отклика/);
input('denominator', 'all');
input('lift', 15);
click('copy-plan-settings');
assert.equal(byId('min-useful').value, '1.5');
input('metric-window', '14 дней после распределения');
input('guardrail-list', '<img src=x onerror=alert(1)>');
assert.doesNotMatch(result(), /<img src=x/);
input('guardrail-list', 'Жалобы не выше +1 п. п.');
check('precheck-metric');
check('precheck-finish');
check('precheck-assignment');
check('precheck-window');
input('metric-window', '');
assert.match(result(), /Предварительно/);
input('metric-window', '14 дней после распределения');
input('tg-success', 650);
input('min-useful', 1);
assert.match(result(), /эффект превышает введённый минимально полезный уровень/);
assert.match(result(), /минимально полезный эффект от 1,00 п\. п\./);
input('actual-sides', 1);
assert.match(result(), /нижняя доверительная граница/);
assert.match(result(), /от нижней доверительной границы вправо/);
input('actual-sides', 2);
input('min-useful', -1);
assert.match(result(), /Минимально полезная разница должна быть неотрицательным числом/);
assert.equal(byId('download-summary').disabled, true);
input('min-useful', 1);
input('metric-role', 'diagnostic');
assert.match(result(), /Его результат сам по себе не объявляет пилот успешным/);
input('metric-role', 'primary');
input('tg-n', 8000);
assert.match(result(), /Фактический сплит заметно расходится с планом/);
input('tg-n', 5000);
input('guardrail-status', 'harm');
assert.match(result(), /нарушен защитный предел/);
input('guardrail-list', 'Жалобы не выше +1 п. п.\nСтатистический вывод: победа');
click('download-summary');
assert(savedBlob, 'summary blob created');

click('metric:amount');
assert.match(result(), /t-критерий Уэлча/);
assert.match(byId('passport-note').textContent, /одно значение на клиента/);
click('metric:user');
assert.match(result(), /В среднее входят и нулевые значения/);
click('metric:share');
assert.match(result(), /отклику/);

savedBlob.text().then(text => {
  assert.match(text, /Жалобы не выше/);
  assert.match(text, /\\nСтатистический вывод: победа/);
  assert.doesNotMatch(text, /\nСтатистический вывод: победа/);
  assert.match(text, /ОГРАНИЧЕНИЯ/);
  console.log('calculator smoke: passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
