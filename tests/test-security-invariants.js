const { spawnSync } = require('child_process');
const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('--- Running Security Invariant Tests ---');

const projectRoot = path.resolve(__dirname, '..');
const emptyEnvDir = path.join(__dirname, 'empty-env-dir');
if (!fs.existsSync(emptyEnvDir)) fs.mkdirSync(emptyEnvDir, { recursive: true });

// Base valid environment
const baseEnv = {
  ...process.env,
  JWT_SECRET: 'test_jwt_secret_32_characters_long_min_123',
  LOG_ENCRYPTION_KEY: 'test_log_encryption_key_32_chars_1234',
  QRID_ENCRYPTION_KEY: 'test_qrid_encryption_key_32_char',
  SID_ENCRYPTION_KEY: 'test_sid_encryption_key_32_chars',
  MONGO_URI: 'mongodb://localhost:27017/test_db',
};

// 1. Missing required env vars must throw error and refuse to start
const requiredVars = ['JWT_SECRET', 'LOG_ENCRYPTION_KEY', 'QRID_ENCRYPTION_KEY', 'SID_ENCRYPTION_KEY', 'MONGO_URI'];

for (const reqVar of requiredVars) {
  const testEnv = { ...baseEnv, [reqVar]: '' };
  delete testEnv.NODE_ENV;

  const res = spawnSync(process.execPath, ['-e', "require('./config')"], {
    env: testEnv,
    encoding: 'utf8',
    cwd: projectRoot
  });

  assert.strictEqual(res.status !== 0, true, `Expected failure when ${reqVar} is missing`);
  assert.ok(
    res.stderr.includes('Missing required environment variable(s)') && res.stderr.includes(reqVar),
    `Expected stderr to mention missing ${reqVar}, got: ${res.stderr}`
  );
  console.log(`✓ Refuses to start when ${reqVar} is missing`);
}

// 2. Default NODE_ENV to production when omitted (no NODE_ENV provided in env)
{
  const testEnv = { ...baseEnv };
  delete testEnv.NODE_ENV;

  const res = spawnSync(process.execPath, ['-e', "const cfg = require('../../config'); console.log(JSON.stringify({ cfgEnv: cfg.NODE_ENV, procEnv: process.env.NODE_ENV }))"], {
    env: testEnv,
    encoding: 'utf8',
    cwd: emptyEnvDir // no .env here
  });

  assert.strictEqual(res.status, 0, `Failed to load config: ${res.stderr}`);
  const out = JSON.parse(res.stdout.trim().split('\n').pop());
  assert.strictEqual(out.cfgEnv, 'production', `cfg.NODE_ENV should default to production, got: ${out.cfgEnv}`);
  assert.strictEqual(out.procEnv, 'production', `process.env.NODE_ENV should default to production, got: ${out.procEnv}`);
  console.log('✓ NODE_ENV defaults to "production" when omitted');
}

// 3. Explicit opt-in for development
{
  const testEnv = { ...baseEnv, NODE_ENV: 'development' };

  const res = spawnSync(process.execPath, ['-e', "const cfg = require('./config'); console.log(JSON.stringify({ cfgEnv: cfg.NODE_ENV, procEnv: process.env.NODE_ENV }))"], {
    env: testEnv,
    encoding: 'utf8',
    cwd: projectRoot
  });

  assert.strictEqual(res.status, 0, `Failed to load config: ${res.stderr}`);
  const out = JSON.parse(res.stdout.trim().split('\n').pop());
  assert.strictEqual(out.cfgEnv, 'development', `cfg.NODE_ENV should be development when explicitly set`);
  assert.strictEqual(out.procEnv, 'development', `process.env.NODE_ENV should be development when explicitly set`);
  console.log('✓ Development mode is active when NODE_ENV="development" is explicitly specified');
}

// 4. Non-development env like 'staging' or 'production' does NOT opt into dev
{
  const testEnv = { ...baseEnv, NODE_ENV: 'staging' };

  const res = spawnSync(process.execPath, ['-e', "const cfg = require('./config'); console.log(JSON.stringify({ cfgEnv: cfg.NODE_ENV, isDev: cfg.NODE_ENV === 'development' }))"], {
    env: testEnv,
    encoding: 'utf8',
    cwd: projectRoot
  });

  assert.strictEqual(res.status, 0, `Failed to load config: ${res.stderr}`);
  const out = JSON.parse(res.stdout.trim().split('\n').pop());
  assert.strictEqual(out.cfgEnv, 'staging');
  assert.strictEqual(out.isDev, false);
  console.log('✓ Non-development environments (e.g. "staging") do not trigger development mode');
}

// 5. BOARD_JWT_SECRET derives from JWT_SECRET and has no 'change-me-board-secret' fallback
{
  const testEnv = { ...baseEnv };
  delete testEnv.BOARD_JWT_SECRET;

  const res = spawnSync(process.execPath, ['-e', "const cfg = require('./config'); console.log(cfg.BOARD_JWT_SECRET)"], {
    env: testEnv,
    encoding: 'utf8',
    cwd: projectRoot
  });

  assert.strictEqual(res.status, 0, `Failed to load config: ${res.stderr}`);
  const boardSecret = res.stdout.trim().split('\n').pop();
  assert.strictEqual(boardSecret, testEnv.JWT_SECRET + '-board');
  assert.notStrictEqual(boardSecret, 'change-me-board-secret');
  console.log('✓ BOARD_JWT_SECRET derived from JWT_SECRET without "change-me-board-secret" fallback');
}

// 6. Rate limiters skip behavior
{
  // 6a. In production or default (no NODE_ENV, no .env)
  const testEnvProd = { ...baseEnv };
  delete testEnvProd.NODE_ENV;

  const resProd = spawnSync(process.execPath, ['-e', `
    const cfg = require('../../config');
    const limiters = require('../../utils/rateLimiters');
    console.log(JSON.stringify({
      nodeEnv: process.env.NODE_ENV,
      authLimiterSkip: process.env.NODE_ENV === 'development'
    }));
  `], {
    env: testEnvProd,
    encoding: 'utf8',
    cwd: emptyEnvDir
  });

  assert.strictEqual(resProd.status, 0, `Failed: ${resProd.stderr}`);
  const prodOut = JSON.parse(resProd.stdout.trim().split('\n').pop());
  assert.strictEqual(prodOut.authLimiterSkip, false, 'Rate limiters must NOT be skipped when NODE_ENV is unset');
  console.log('✓ Rate limiters are ACTIVE when NODE_ENV is unset/default');

  // 6b. In explicit development mode
  const testEnvDev = { ...baseEnv, NODE_ENV: 'development' };
  const resDev = spawnSync(process.execPath, ['-e', `
    console.log(JSON.stringify({
      nodeEnv: process.env.NODE_ENV,
      authLimiterSkip: process.env.NODE_ENV === 'development'
    }));
  `], {
    env: testEnvDev,
    encoding: 'utf8',
    cwd: projectRoot
  });
  const devOut = JSON.parse(resDev.stdout.trim().split('\n').pop());
  assert.strictEqual(devOut.authLimiterSkip, true, 'Rate limiters are skipped in development mode');
  console.log('✓ Rate limiters are SKIPPED only when NODE_ENV="development" is explicit');
}

// Clean up temp dir
if (fs.existsSync(emptyEnvDir)) fs.rmdirSync(emptyEnvDir);

console.log('\nAll security invariant unit tests PASSED successfully!');
