#!/usr/bin/env node
/**
 * Verify the chat webview's inline script parses AT RUNTIME.
 *
 * The webview HTML is a TS template literal; escape sequences like \n are
 * processed when the template is evaluated, so checking the raw source text
 * is NOT sufficient (a '\n' inside the inline JS becomes a real newline and
 * a syntax error in the delivered page). This script evaluates the template
 * the same way runtime does, extracts the inline <script>, and parses it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'ui', 'ChatWebviewProvider.ts'),
  'utf8',
);

const start = src.indexOf('return /*html*/ `');
const open = src.indexOf('`', start);
// find the matching closing backtick: the next backtick followed by ';'
let i = open + 1;
while (i < src.length && !(src[i] === '`' && src[i + 1] === ';')) i++;
const template = src.slice(open, i + 1);

// Evaluate as a real template literal with stub interpolation values
const html = vm.runInNewContext('(' + 'nonce => webview => ' + template + ')')('TESTNONCE')({ cspSource: 'vscode-resource:' });

const m = html.match(/<script nonce="TESTNONCE">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('FAIL: inline script not found in rendered html');
  process.exit(1);
}

try {
  new Function(m[1]);
  console.log('OK: runtime webview script parses (' + m[1].length + ' chars)');
} catch (e) {
  console.error('FAIL: runtime webview script has a syntax error:');
  console.error('  ' + e.message);
  // locate the offending line for easier debugging
  const lines = m[1].split('\n');
  const bad = lines.findIndex(l => {
    try { new Function(lines.slice(0, lines.indexOf(l) + 1).join('\n')); return false; } catch { return false; }
  });
  process.exit(1);
}
