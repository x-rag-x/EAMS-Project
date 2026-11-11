'use strict';
const fs = require('fs');

// 1. Update public/timetable.html
let html = fs.readFileSync('public/timetable.html', 'utf8').replace(/\r\n/g, '\n');

if (!html.includes('data-view="hub"')) {
  html = html.replace(
    '<div class="sb-section-label">Workspace Views</div>\n        <button class="sb-item act" data-view="dashboard">',
    '<div class="sb-section-label">Workspace Views</div>\n        <button class="sb-item" data-view="hub" id="sb-nav-hub"><span class="sbi-ic"><re-icon icon="folder"></re-icon></span>Workspaces Hub</button>\n        <button class="sb-item act" data-view="dashboard">'
  );
}

if (!html.includes('js/modules/hub.module.js')) {
  html = html.replace(
    '<script src="js/modules/history.module.js"></script>',
    '<script src="js/modules/hub.module.js"></script>\n  <script src="js/modules/history.module.js"></script>'
  );
}

fs.writeFileSync('public/timetable.html', html, 'utf8');
console.log('[OK] timetable.html updated');

// 2. Update public/js/pages/timetable.page.js to handle viewName === 'hub'
let tp = fs.readFileSync('public/js/pages/timetable.page.js', 'utf8').replace(/\r\n/g, '\n');

// Add 'hub' to viewTitles
if (!tp.includes("hub: 'Workspaces Hub'")) {
  tp = tp.replace(
    "dashboard: 'Operations Dashboard & Command Center',",
    "hub: 'Workspaces Hub',\n    dashboard: 'Operations Dashboard & Command Center',"
  );
}

// In asyncLoader inside switchTab, render hub if viewName === 'hub'
if (!tp.includes("if (viewName === 'hub')")) {
  tp = tp.replace(
    "if (viewName === 'dashboard') {",
    "if (viewName === 'hub') {\n        if (window.WorkspaceHubView) {\n          const hubView = new window.WorkspaceHubView(fullPage);\n          await hubView.load();\n          return;\n        }\n      } else if (viewName === 'dashboard') {"
  );
}

fs.writeFileSync('public/js/pages/timetable.page.js', tp, 'utf8');
console.log('[OK] timetable.page.js updated with hub view');
