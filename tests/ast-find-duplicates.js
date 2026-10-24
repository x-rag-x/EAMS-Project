const fs = require('fs');
const acorn = require('acorn');

function findDuplicatesWithAcorn(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  let ast;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      allowHashBang: true,
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true
    });
  } catch (err) {
    try {
      ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        locations: true,
        allowHashBang: true,
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true
      });
    } catch (err2) {
      console.error(`Failed to parse ${filePath}:`, err2.message);
      return;
    }
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'ObjectExpression') {
      const seen = new Map();
      for (const prop of node.properties) {
        if (prop.type === 'Property') {
          let name = null;
          if (prop.key.type === 'Identifier') name = prop.key.name;
          else if (prop.key.type === 'Literal') name = String(prop.key.value);

          if (name !== null) {
            if (seen.has(name)) {
              console.log(`[AST DUPLICATE KEY] ${filePath}:${prop.loc.start.line}:${prop.loc.start.column} - Duplicate key "${name}" (first defined at line ${seen.get(name)})`);
            } else {
              seen.set(name, prop.loc.start.line);
            }
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) walk(c);
      } else if (child && typeof child === 'object') {
        walk(child);
      }
    }
  }

  walk(ast);
}

console.log('=== utils/teacherSchedule.js ===');
findDuplicatesWithAcorn('utils/teacherSchedule.js');
console.log('=== public/js/pages/admin.page.js ===');
findDuplicatesWithAcorn('public/js/pages/admin.page.js');
console.log('=== public/js/pages/timetable.page.js ===');
findDuplicatesWithAcorn('public/js/pages/timetable.page.js');
