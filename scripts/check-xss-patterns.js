#!/usr/bin/env node
/**
 * Security audit script: detects unescaped user input and dynamic field interpolations in frontend files.
 * Flags: reason, name, regNo, className, subjectName, message concatenated outside escapeHtml / textContent.
 */
const fs = require('fs');
const path = require('path');

const targetArg = process.argv[2];
const TARGET_PATH = targetArg ? path.resolve(process.cwd(), targetArg) : path.resolve(__dirname, '..', 'public', 'js');

// Patterns targeting potential stored-XSS sinks in HTML string concatenation
const DYNAMIC_FIELD_PATTERNS = [
  // 1. reason variables
  /(\+\s*[\w\.]*reason\b[^\+]*\+|title=["'][^"']*reason|`[^`]*\$\{[\w\.]*reason\}[^`]*`)/i,
  // 2. regNo / registerNo variables
  /(\+\s*[\w\.]*(?:regNo|registerNo)\b[^\+]*\+|`[^`]*\$\{[\w\.]*(?:regNo|registerNo)\}[^`]*`)/i,
  // 3. className variables in HTML markup
  /(\+\s*[\w\.]*className\b[^\+]*\+|`[^`]*\$\{[\w\.]*className\}[^`]*`)/i,
  // 4. subjectName variables in HTML markup
  /(\+\s*[\w\.]*subjectName\b[^\+]*\+|`[^`]*\$\{[\w\.]*subjectName\}[^`]*`)/i,
  // 5. entity name variables (studentName, deptName, c.name, s.name, row.name, item.name, student.name, substituteTeacherName)
  /(\+\s*[\w\.]*(?:studentName|deptName|substituteTeacherName|(?:\b(?:c|s|row|item|student|institution)\.name))\b[^\+]*\+|`[^`]*\$\{[\w\.]*(?:studentName|deptName|substituteTeacherName|(?:\b(?:c|s|row|item|student|institution)\.name))\}[^`]*`)/i,
  // 6. error/response message variables concatenated in HTML contexts
  /(\+\s*[\w\.]*(?:err|error|res)\.message\b[^\+]*\+|`[^`]*\$\{[\w\.]*(?:err|error|res)\.message\}[^`]*`)/i,
  // 7. academicYear, courseType variables in HTML markup
  /(\+\s*[\w\.]*(?:academicYear|courseType)\b[^\+]*\+|`[^`]*\$\{[\w\.]*(?:academicYear|courseType)\}[^`]*`)/i,
  // 8. cleanName, displayName variables in HTML markup
  /(\+\s*[\w\.]*(?:cleanName|displayName)\b[^\+]*\+|`[^`]*\$\{[\w\.]*(?:cleanName|displayName)\}[^`]*`)/i,
  // 9. device and ip variables in HTML markup
  /(\+\s*[\w\.]*(?:\b[as]\.(?:device|ip))\b[^\+]*\+|`[^`]*\$\{[\w\.]*(?:\b[as]\.(?:device|ip))\}[^`]*`)/i,
];

let violations = 0;

function isSafeContext(line) {
  // Safe if escaped or encoded
  if (line.includes('escapeHtml(') || line.includes('esc(') || line.includes('encodeURIComponent(')) {
    return true;
  }
  // Safe DOM property assignment (text only, never parses HTML)
  if (line.includes('.textContent') || line.includes('.innerText') || line.includes('.value')) {
    return true;
  }
  // Safe logging / toast / notification handlers
  if (
    line.includes('console.') ||
    line.includes('addLog(') ||
    line.includes('showToast(') ||
    line.includes('dbToast(') ||
    line.includes('notify(') ||
    line.includes('showPopup(') ||
    line.includes('recordHistory(') ||
    line.includes('logDiag(')
  ) {
    return true;
  }
  return false;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, lineNum) => {
    const trimmed = line.trim();
    // Skip comments and blank lines
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

    for (const pattern of DYNAMIC_FIELD_PATTERNS) {
      if (pattern.test(line)) {
        if (!isSafeContext(line)) {
          console.error(`[XSS Violation] ${path.relative(process.cwd(), filePath)}:${lineNum + 1}: ${trimmed.substring(0, 120)}`);
          violations++;
          break;
        }
      }
    }
  });
}

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      scanFile(fullPath);
    }
  }
}

console.log(`> Running frontend XSS scan for unescaped output on: ${path.relative(process.cwd(), TARGET_PATH)}`);
if (fs.existsSync(TARGET_PATH)) {
  if (fs.statSync(TARGET_PATH).isDirectory()) {
    scanDir(TARGET_PATH);
  } else {
    scanFile(TARGET_PATH);
  }
} else {
  console.error(`Error: Path ${TARGET_PATH} does not exist`);
  process.exit(1);
}

if (violations > 0) {
  console.error(`\n[FAIL] Found ${violations} unescaped dynamic output pattern(s). Please wrap with escapeHtml().`);
  process.exit(1);
} else {
  console.log('[PASS] No unescaped dynamic output patterns found.');
  process.exit(0);
}
