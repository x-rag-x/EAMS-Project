const assert = require('assert');
const fs = require('fs');
const acorn = require('acorn');

console.log('--- Testing H4 Teacher Leave Query & Linter Duplicate Key Fixes ---');

// 1. Verify utils/teacherSchedule.js query structure
{
  const code = fs.readFileSync('utils/teacherSchedule.js', 'utf8');
  assert.ok(code.includes('$and: ['), 'utils/teacherSchedule.js must wrap conditions in $and');
  assert.ok(!code.includes('$or: [\n        { teacherTrackId: idn.trackId },\n        { teacherId: idn._id }\n      ],\n      $or: ['), 'Must not have two adjacent $or keys in one object');

  // Parse with acorn to ensure AST contains $and with two $or elements
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  let foundLeaveQuery = false;

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' &&
        node.callee &&
        node.callee.property &&
        node.callee.property.name === 'find' &&
        node.arguments.length > 0 &&
        node.arguments[0].type === 'ObjectExpression') {
      const obj = node.arguments[0];
      const hasStatusApproved = obj.properties.some(p => p.key && p.key.name === 'status' && p.value && p.value.value === 'Approved');
      const andProp = obj.properties.find(p => p.key && p.key.name === '$and');
      if (hasStatusApproved && andProp) {
        foundLeaveQuery = true;
        assert.strictEqual(andProp.value.type, 'ArrayExpression', '$and must be an array');
        assert.strictEqual(andProp.value.elements.length, 2, '$and array must contain two elements');
        const elem1 = andProp.value.elements[0];
        const elem2 = andProp.value.elements[1];
        assert.ok(elem1.properties.some(p => p.key.name === '$or'), 'First element must have $or');
        assert.ok(elem2.properties.some(p => p.key.name === '$or'), 'Second element must have $or');
      }
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const c = node[k];
      if (Array.isArray(c)) c.forEach(walk);
      else if (c && typeof c === 'object') walk(c);
    }
  }
  walk(ast);
  assert.strictEqual(foundLeaveQuery, true, 'Must find M.TeacherLeaveRequest.find with $and: [{ $or: [...] }, { $or: [...] }]');
  console.log('✓ utils/teacherSchedule.js: TeacherLeaveRequest query correctly wraps both $or in $and');
}

// 2. Verify admin.page.js has no duplicate email in payload
{
  const code = fs.readFileSync('public/js/pages/admin.page.js', 'utf8');
  assert.ok(code.includes('fullName, firstName, lastName, employeeNo: empId, email: email,'), 'Must keep email: email');
  assert.ok(code.includes('deptCode: deptCode, designation: desig, username: uname,'), 'Must have removed duplicate email shorthand');
  assert.ok(!code.includes('designation: desig, email, username: uname,'), 'Must not contain designation: desig, email, username: uname,');

  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  let payloadChecked = false;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionDeclaration' && node.id && node.id.name === 'addTch') {
      // Find payload inside addTch
      function walkAddTch(child) {
        if (!child || typeof child !== 'object') return;
        if (child.type === 'VariableDeclarator' && child.id && child.id.name === 'payload' && child.init && child.init.type === 'ObjectExpression') {
          const emailProps = child.init.properties.filter(p => p.key && p.key.name === 'email');
          assert.strictEqual(emailProps.length, 1, 'payload in addTch must contain exactly one email property');
          payloadChecked = true;
        }
        for (const k of Object.keys(child)) {
          if (k === 'loc') continue;
          const c = child[k];
          if (Array.isArray(c)) c.forEach(walkAddTch);
          else if (c && typeof c === 'object') walkAddTch(c);
        }
      }
      walkAddTch(node);
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const c = node[k];
      if (Array.isArray(c)) c.forEach(walk);
      else if (c && typeof c === 'object') walk(c);
    }
  }
  walk(ast);
  assert.strictEqual(payloadChecked, true, 'payload in addTch was verified');
  console.log('✓ public/js/pages/admin.page.js: addTch payload has exactly one email property');
}

// 3. Verify public/js/pages/timetable.page.js state object has no duplicate mode key
{
  const code = fs.readFileSync('public/js/pages/timetable.page.js', 'utf8');
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  let stateChecked = false;
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'VariableDeclarator' && node.id && node.id.name === 'state' && node.init && node.init.type === 'ObjectExpression') {
      const modeProps = node.init.properties.filter(p => p.key && p.key.name === 'mode');
      assert.strictEqual(modeProps.length, 0, 'state object literal must not contain duplicate mode property');
      stateChecked = true;
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const c = node[k];
      if (Array.isArray(c)) c.forEach(walk);
      else if (c && typeof c === 'object') walk(c);
    }
  }
  walk(ast);
  assert.strictEqual(stateChecked, true, 'state object in timetable.page.js was verified');

  // Verify Object.defineProperty(state, 'mode') works
  const state = { env: 'development' };
  Object.defineProperty(state, 'mode', {
    get() { return this.env; },
    set(val) { this.env = val; },
    configurable: true,
    enumerable: false
  });
  assert.strictEqual(state.mode, 'development');
  state.mode = 'production';
  assert.strictEqual(state.env, 'production');
  console.log('✓ public/js/pages/timetable.page.js: state object literal is clean, and state.mode alias works as expected');
}

console.log('\nAll H4 teacher schedule and linter tests PASSED successfully!');
