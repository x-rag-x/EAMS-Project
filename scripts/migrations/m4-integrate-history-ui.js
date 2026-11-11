'use strict';
const fs = require('fs');

let tp = fs.readFileSync('public/js/pages/timetable.page.js', 'utf8').replace(/\r\n/g, '\n');

// 1. In historyView, add container
if (!tp.includes('id="tt-history-module-container"')) {
  tp = tp.replace(
    '<div class="panel">',
    '<div id="tt-history-module-container" style="margin-bottom: 24px;"></div>\n    <div class="panel">'
  );
}

// 2. In bindView, initialize TimetableHistoryView
if (!tp.includes('window.TimetableHistoryView && histContainer')) {
  tp = tp.replace(
    "$('#refresh-versions-btn')?.addEventListener('click', async () => {",
    `const histContainer = document.getElementById('tt-history-module-container');
  if (histContainer && window.TimetableHistoryView) {
    const hv = new window.TimetableHistoryView(histContainer);
    hv.load({
      lens: state.env || 'production',
      workspaceId: state.activeWorkspaceId,
      deptId: state.deptId
    });
  }

  $('#refresh-versions-btn')?.addEventListener('click', async () => {`
  );
}

fs.writeFileSync('public/js/pages/timetable.page.js', tp, 'utf8');
console.log('[OK] timetable.page.js updated with TimetableHistoryView integration!');
