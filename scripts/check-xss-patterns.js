#!/usr/bin/env node
/**
 * Security audit script: detects unescaped reason and user input interpolations in frontend files.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_JS_DIR = path.resolve(__dirname, '..', 'public', 'js');

const UNESCAPED_REASON_REGEX = /(\+\s*[\w\.]*reason\b[^\+]*\+|title=["'][^"']*reason|`[^`]*\$\{[\w\.]*reason\}[^`]*`)/i;

let violations = 0;

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split(/\r?\n/);
      lines.forEach((line, lineNum) => {
        // Skip comment lines
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

        if (UNESCAPED_REASON_REGEX.test(line)) {
          // Check if escapeHtml or esc is wrapping it
          if (!line.includes('escapeHtml(') && !line.includes('esc(') && !line.includes('textContent')) {
            console.error(`[XSS Violation] ${path.relative(process.cwd(), fullPath)}:${lineNum + 1}: ${trimmed.substring(0, 100)}`);
            violations++;
          }
        }
      });
    }
  }
}

console.log('> Running frontend XSS scan for unescaped reason patterns...');
scanDir(PUBLIC_JS_DIR);

if (violations > 0) {
  console.error(`\n[FAIL] Found ${violations} unescaped reason pattern(s). Please wrap with escapeHtml().`);
  process.exit(1);
} else {
  console.log('[PASS] No unescaped reason patterns found in frontend scripts.');
  process.exit(0);
}
