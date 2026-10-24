const express = require('express');
const request = require('http');
const assert = require('assert');

// Test with dev mode disabled (explicit production mode)
process.env.NODE_ENV = 'production';

const authRoutes = require('../routes/auth.routes');
const settingsRoutes = require('../routes/settings.routes');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);

const server = app.listen(0, async () => {
  const port = server.address().port;
  console.log(`--- Running Login & Dev Endpoints Security Tests (port: ${port}) ---`);

  function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const req = request.request({
        hostname: '127.0.0.1',
        port: port,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  try {
    // 1. Missing password must return 400
    const resNoPass = await makeRequest('POST', '/api/auth/login', { identifier: 'admin' });
    assert.strictEqual(resNoPass.status, 400, `Expected 400 for missing password, got ${resNoPass.status}`);
    assert.strictEqual(resNoPass.body.error, 'Username and password are required');
    console.log('✓ /login returns 400 when password is omitted');

    // 2. Empty string password must return 400
    const resEmptyPass = await makeRequest('POST', '/api/auth/login', { identifier: 'admin', password: '' });
    assert.strictEqual(resEmptyPass.status, 400, `Expected 400 for empty password, got ${resEmptyPass.status}`);
    assert.strictEqual(resEmptyPass.body.error, 'Username and password are required');
    console.log('✓ /login returns 400 when password is an empty string');

    // 3. GET /api/auth/dev-users must be forbidden (403) in non-dev mode
    const resDevUsers = await makeRequest('GET', '/api/auth/dev-users');
    assert.strictEqual(resDevUsers.status, 403, `Expected 403 for /dev-users, got ${resDevUsers.status}`);
    assert.strictEqual(resDevUsers.body.error, 'Available only in development mode');
    console.log('✓ GET /api/auth/dev-users returns 403 in non-development mode');

    // 4. POST /api/auth/dev-login must be forbidden (403) in non-dev mode
    const resDevLogin = await makeRequest('POST', '/api/auth/dev-login', { username: 'admin' });
    assert.strictEqual(resDevLogin.status, 403, `Expected 403 for /dev-login, got ${resDevLogin.status}`);
    assert.strictEqual(resDevLogin.body.error, 'Available only in development mode');
    console.log('✓ POST /api/auth/dev-login returns 403 in non-development mode');

    // 5. GET /api/settings/public must report isDev: false and retain location requirement
    const resSettings = await makeRequest('GET', '/api/settings/public');
    assert.strictEqual(resSettings.status, 200, `Expected 200 for /settings/public, got ${resSettings.status}`);
    assert.strictEqual(resSettings.body.isDev, false, 'Expected isDev to be false in production mode');
    assert.strictEqual(resSettings.body.security.isDev, false, 'Expected security.isDev to be false in production mode');
    assert.strictEqual(resSettings.body.security.loginLocationRequired, true, 'Expected loginLocationRequired to remain true');
    console.log('✓ GET /api/settings/public reports isDev=false and enforces loginLocationRequired');

    console.log('\nAll login & dev endpoint security tests PASSED successfully!');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err);
    server.close();
    process.exit(1);
  }
});
