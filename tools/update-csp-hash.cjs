const fs = require('node:fs');
const crypto = require('node:crypto');

const path = process.argv[2] || 'index.html';
let html = fs.readFileSync(path, 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (scripts.length !== 1) throw new Error(`Expected one inline script, found ${scripts.length}`);

// HTML parsing normalizes CRLF and CR to LF before CSP checks script text.
const scriptText = scripts[0][1].replace(/\r\n?/g, '\n');
const digest = crypto.createHash('sha256').update(scriptText, 'utf8').digest('base64');
const old = /script-src '(?:unsafe-inline|sha256-[A-Za-z0-9+/=]+)'/g;
const matches = [...html.matchAll(old)];
if (matches.length !== 1) throw new Error(`Expected one script-src directive, found ${matches.length}`);
html = html.replace(old, `script-src 'sha256-${digest}'`);
fs.writeFileSync(path, html, 'utf8');
console.log(`Updated script CSP hash in ${path}`);
