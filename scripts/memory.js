#!/usr/bin/env node
/**
 * EAMS Project Memory CLI Wrapper
 * Points to .antigravity/bin/memory.py or .antigravity/bin/memory.js if present,
 * or provides a helpful fallback message if running in an environment without .antigravity.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');
const pythonScript = path.join(rootDir, '.antigravity', 'bin', 'memory.py');
const jsScript = path.join(rootDir, '.antigravity', 'bin', 'memory.js');
const args = process.argv.slice(2);

if (fs.existsSync(pythonScript)) {
  const candidates = ['python', 'py', 'python3'];
  function tryRun(index) {
    if (index >= candidates.length) {
      console.error('Error: Python runtime (python, py, python3) not found to run memory engine.');
      process.exit(1);
    }
    const py = candidates[index];
    const proc = spawn(py, [pythonScript, ...args], { stdio: 'inherit', shell: false });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') tryRun(index + 1);
      else {
        console.error(`Error running ${py}:`, err.message);
        process.exit(1);
      }
    });
    proc.on('close', (code) => process.exit(code ?? 0));
  }
  tryRun(0);
} else if (fs.existsSync(jsScript)) {
  const proc = spawn(process.execPath, [jsScript, ...args], { stdio: 'inherit' });
  proc.on('close', (code) => process.exit(code ?? 0));
} else {
  console.log('EAMS Persistent Project Memory: .antigravity/bin/memory.py is not present in this distribution.');
  console.log('See AGENTS.md for operating guidelines.');
}
