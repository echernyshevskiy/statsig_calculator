const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('tests/smoke.js', 'utf8');
const prefix = source.split('assert.match(result(), /Сколько клиентов нужно/);')[0];
if (!prefix.includes('const result =')) throw new Error('Smoke harness changed');
const checks = String.raw`
const badNumbers = ['abc', '<img src=x onerror=alert(1)>', '1e999', 'NaN', 'Infinity', '', '-1', '0', '100', '10,5'];
for (const raw of badNumbers) {
  input('base-share', raw);
  assert.match(result(), /class="error-box"/);
  assert.equal(byId('download-summary').disabled, true);
}
input('base-share', 10);
assert.doesNotMatch(result(), /class="error-box"/);
assert.equal(byId('download-summary').disabled, false);
input('metric-name', 'custom');
input('custom-metric', '<img src=x onerror=alert(1)>');
input('guardrail-list', '<script>alert(1)</script>\nСтатистический вывод: победа');
click('stage:actual');
assert.doesNotMatch(result(), /<script>alert/);
assert.match(result(), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(result(), /<img src=x/);
click('download-summary');
assert(savedBlob);
savedBlob.text().then(text => {const forged=text.includes('\nСтатистический вывод: победа');assert.equal(forged,false,'user text escaped into a single quoted report line');console.log(JSON.stringify({forgedVerdictLineInTextExport: forged}));}).catch(error => {console.error(error);process.exitCode=1});

const extreme = [1e-300, 1e-154, 1e154, 1e300, 1e308];
let anomalies = [];
for (const mode of ['amount', 'user']) {
  click('metric:' + mode);
  click('stage:plan');
  for (const n of extreme) {
    byId('base-mean').value = String(mode === 'amount' ? Math.max(n, 1e-300) : n);
    byId('base-sd').value = String(n);
    byId('tg-sd-plan').value = String(n);
    byId(mode === 'user' ? 'user-lift' : 'lift').value = mode === 'user' ? String(n) : '10';
    input('available', 10000);
    if (!result().includes('class="error-box"') && /(?:NaN|Infinity|undefined)/.test(result())) anomalies.push({mode,n,match:result().match(/(?:NaN|Infinity|undefined)/)?.[0]});
  }
}
click('metric:share');
input('base-share', '1e-300');
const tinyShareAccepted = !result().includes('class="error-box"');
assert.equal(tinyShareAccepted, false, 'sub-minimum response rate must be rejected');
byId('base-share').value = '10';
input('lift', '0.001');
assert.match(result(), /class="error-box"/);
input('lift', '10');
const largeStart = Date.now();
input('available', '9007199254740991');
const largeBaseMs = Date.now() - largeStart;
const largeBaseOutcome = result().includes('class="error-box"') ? 'rejected' : /(?:NaN|Infinity|undefined)/.test(result()) ? 'nonfinite display' : 'rendered';
input('available', '10000');
click('metric:amount');
byId('base-mean').value = '1e-300';
byId('base-sd').value = '1';
byId('tg-sd-plan').value = '1';
input('lift', '1e308');
const extremeLift = result().includes('class="error-box"') ? 'rejected' : /(?:NaN|Infinity|∞)/.test(result()) ? 'nonfinite display' : 'rendered';
input('base-sd', '0.00001');
assert.match(result(), /class="error-box"/);
input('base-sd', '1');
input('deal-rate', '0.001');
assert.match(result(), /class="error-box"/);
input('deal-rate', '10');
click('stage:actual');
const badCounts = ['abc', '1e999', '', '-1', '0', '2.5', '9007199254740992'];
for (const raw of badCounts) {
  input('cg-n', raw);
  assert.match(result(), /class="error-box"/);
  assert.equal(byId('download-summary').disabled, true);
}
input('actual-alpha', '0.005');
assert.match(result(), /class="error-box"/);
assert.equal(extremeLift, 'rendered');
console.log(JSON.stringify({badNumbersChecked:badNumbers.length,badCountsChecked:badCounts.length,extremesChecked:extreme.length*2,tinyShareAccepted,largeBaseMs,largeBaseOutcome,extremeLift,anomalies}));
`;
vm.runInNewContext(prefix + checks, {require, console, process, Blob, Intl, setTimeout}, {filename: 'calculator-hardening-audit'});
