/**
 * bulk.cards.js
 * Card registry and renderers for all stages of the bulk import workflow.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util;
  var config = root.Bulk.config;
  var api = root.Bulk.api;
  var store = root.Bulk.store;

  var cards = {};

  function registerCard(name, def) {
    cards[name] = def;
  }

  // Helper for template downloads using XLSX
  var foldedOverrides = {};

  function resolveSchemaCols(type, schema) {
    if (!type) return [];
    var pool = (schema && schema.schemas) ? schema.schemas : (schema || {});
    var entry = pool[type];
    if (entry) {
      if (Array.isArray(entry)) return entry;
      if (Array.isArray(entry.columns)) return entry.columns;
    }
    return DEFAULT_SCHEMAS[type] || [];
  }

  function resolveSchema(type, schema) {
    if (!type) return { columns: [] };
    var pool = (schema && schema.schemas) ? schema.schemas : (schema || {});
    var entry = pool[type] || {};
    var cols = resolveSchemaCols(type, schema);
    var typeMeta = config.TYPES[type] || {};
    return {
      type: type,
      label: entry.label || typeMeta.label || type,
      columns: cols,
      exampleRows: entry.exampleRows || [],
      commonMistakes: entry.commonMistakes || [
        'Trailing whitespace in identifiers',
        'Duplicate rows or merged header cells',
        'References to non-existent departments or classes'
      ],
      limits: entry.limits || {
        maxFileSizeMb: 10,
        maxRows: 5000,
        formats: ['.xlsx', '.csv'],
        firstSheetOnly: true
      }
    };
  }

  // Dynamic template download building from single schema source of truth
  function downloadTemplate(type) {
    var schemaData = resolveSchema(type, store.getState().schema);
    var cols = schemaData.columns;
    if (!cols || !cols.length || typeof root.XLSX === 'undefined') {
      if (typeof root.showToast === 'function') root.showToast('Template generation unavailable', 'warn');
      return;
    }

    var headers = cols.map(function (c) { return c.label || c.key; });
    var rows = [];
    if (schemaData.exampleRows && schemaData.exampleRows.length) {
      rows = schemaData.exampleRows.map(function (ex) {
        return headers.map(function (h) {
          if (ex[h] !== undefined) return ex[h];
          var lk = h.charAt(0).toLowerCase() + h.slice(1);
          if (ex[lk] !== undefined) return ex[lk];
          return '';
        });
      });
    } else {
      rows.push(cols.map(function (c) { return c.example || ''; }));
    }

    var data = [headers].concat(rows);
    var ws = root.XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = headers.map(function (h) { return { wch: Math.max(h.length + 4, 18) }; });

    var wb = root.XLSX.utils.book_new();
    var sheetName = (schemaData.label || type).slice(0, 31);
    root.XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Sheet 2: Instructions
    var notes = [
      ['Column', 'Required?', 'Format / Allowed Values', 'Rules', 'Description']
    ];
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      var rulesStr = Array.isArray(c.rules) ? c.rules.join('; ') : (c.rules || '');
      var allowedStr = Array.isArray(c.allowed) && c.allowed.length ? c.allowed.join(' | ') : (c.format || '');
      notes.push([
        c.label || c.key,
        c.required ? 'Yes' : 'No',
        allowedStr,
        rulesStr,
        c.description || c.help || ''
      ]);
    }
    var ns = root.XLSX.utils.aoa_to_sheet(notes);
    ns['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 28 }, { wch: 32 }, { wch: 48 }];
    root.XLSX.utils.book_append_sheet(wb, ns, 'Instructions');

    root.XLSX.writeFile(wb, 'EAMS_' + type + '_template.xlsx');
  }

  // 1. TYPE PICKER CARD / HERO
  registerCard('type', {
    key: function (ctx) {
      var selectedType = (ctx.msg && ctx.msg.payload && ctx.msg.payload.type) || (ctx.batch && ctx.batch.type);
      if (selectedType) {
        return 'type-selected-' + selectedType;
      }
      return (ctx.caps ? JSON.stringify(ctx.caps) : 'type-default');
    },
    render: function (ctx) {
      var selectedType = (ctx.msg && ctx.msg.payload && ctx.msg.payload.type) || (ctx.batch && ctx.batch.type);
      if (selectedType) {
        var meta = config.TYPES[selectedType] || { label: selectedType.charAt(0).toUpperCase() + selectedType.slice(1), icon: 'upload' };
        var typeLabel = meta.label || (selectedType.charAt(0).toUpperCase() + selectedType.slice(1));
        return '<div class="user-request-card">' +
          '<div class="user-request-header">' +
            '<div class="user-request-icon-box">' +
              '<re-icon icon="' + (meta.icon || 'upload') + '" size="18"></re-icon>' +
            '</div>' +
            '<div class="user-request-body">' +
              '<div class="user-request-title">' + util.esc(typeLabel) + ' Import Request</div>' +
              '<div class="user-request-sub">Initiated record import workflow</div>' +
            '</div>' +
            '<span class="user-request-badge">Requested</span>' +
          '</div>' +
        '</div>';
      }

      var caps = (ctx.caps && ctx.caps.types) ? ctx.caps.types : ((ctx.caps && ctx.caps.capabilities) ? ctx.caps.capabilities : (ctx.caps || {}));
      var typeKeys = ['dept', 'teacher', 'class', 'subject', 'student'];
      var html = '<div class="empty-chat-hero">' +
        '<div class="empty-chat-title">Start a Bulk Import</div>' +
        '<div class="empty-chat-sub">Select the type of records you would like to import using an Excel or CSV spreadsheet.</div>' +
        '<div class="type-picker-grid">';

      for (var i = 0; i < typeKeys.length; i++) {
        var k = typeKeys[i];
        var meta = config.TYPES[k];
        var cap = caps[k] || { enabled: true };
        var disabled = !cap.enabled;
        var tooltip = disabled ? (cap.reason || 'Prerequisites missing') : meta.desc;

        html += '<button type="button" class="type-card-btn" data-action="pick-type" data-type="' + k + '" ' + (disabled ? 'disabled title="' + util.esc(tooltip) + '"' : '') + '>' +
          '<div class="type-card-icon"><re-icon icon="' + meta.icon + '" size="20"></re-icon></div>' +
          '<div class="type-card-name">' + util.esc(meta.label) + '</div>' +
          (disabled ? '<div style="font-size:10px;color:var(--amber);margin-top:2px;">' + util.esc(cap.reason || 'Locked') + '</div>' : '') +
        '</button>';
      }

      html += '</div>' +
        '<div class="setup-checklist-strip">' +
          '<div class="setup-check-item done"><re-icon icon="check" size="14"></re-icon> 1. Academic Structure</div>' +
          '<div class="setup-check-item"><re-icon icon="arrow-right" size="12"></re-icon> 2. Faculty</div>' +
          '<div class="setup-check-item"><re-icon icon="arrow-right" size="12"></re-icon> 3. Classes</div>' +
          '<div class="setup-check-item"><re-icon icon="arrow-right" size="12"></re-icon> 4. Subjects</div>' +
          '<div class="setup-check-item"><re-icon icon="arrow-right" size="12"></re-icon> 5. Students</div>' +
        '</div>' +
      '</div>';

      return html;
    },
    bind: function (el, ctx) {
      // Event delegation is handled once on #chat-transcript in bulk.transcript.init()
    }
  });

  var DEFAULT_SCHEMAS = {
    dept: [
      { key: 'name', label: 'Name', required: true, aliases: ['name', 'deptname', 'departmentname', 'department'], example: 'Computer Science & Engineering' },
      { key: 'code', label: 'Code', required: true, aliases: ['code', 'deptcode'], example: 'CSE' },
      { key: 'number', label: 'Number', required: true, aliases: ['number', 'deptnumber', 'no'], example: '104' },
      { key: 'courseType', label: 'CourseType', required: true, aliases: ['coursetype', 'course'], example: 'UG' },
      { key: 'branch', label: 'Branch', required: true, aliases: ['branch', 'degreebranch', 'degree'], example: 'B.E' },
      { key: 'category', label: 'Category', required: false, aliases: ['category', 'deptcategory', 'classification', 'departmentcategory'], example: 'Programme' },
      { key: 'icon', label: 'Icon', required: false, aliases: ['icon', 'depticon'], example: 'building2' }
    ],
    teacher: [
      { key: 'name', label: 'Name', required: true, aliases: ['name', 'fullname', 'teachername', 'staffname'], example: 'Dr. Sarah Connor' },
      { key: 'department', label: 'Department', required: true, aliases: ['department', 'dept', 'deptname', 'deptcode'], example: 'CSE' },
      { key: 'employeeNo', label: 'EmployeeID', required: true, aliases: ['employeeid', 'empid', 'employeeno', 'staffid'], example: 'EMP-4019' },
      { key: 'username', label: 'Username', required: true, aliases: ['username', 'user', 'loginid'], example: 'sconnor' },
      { key: 'designation', label: 'Designation', required: false, aliases: ['designation', 'desig', 'role', 'title'], example: 'Associate Professor' },
      { key: 'password', label: 'Password', required: false, aliases: ['password', 'pass'], example: 'teacher123' },
      { key: 'email', label: 'Email', required: false, aliases: ['email', 'mail', 'emailaddress'], example: 'sarah.c@inst.edu' },
      { key: 'gender', label: 'Gender', required: false, aliases: ['gender', 'sex'], example: 'Female' }
    ],
    class: [
      { key: 'department', label: 'Department', required: true, aliases: ['department', 'dept', 'deptname', 'deptcode'], example: 'CSE' },
      { key: 'hallNo', label: 'HallNo', required: true, aliases: ['hallno', 'hall', 'room', 'roomno'], example: 'LH-301' },
      { key: 'sem', label: 'Semester', required: true, aliases: ['semester', 'sem'], example: 'III' },
      { key: 'batch', label: 'Batch', required: true, aliases: ['batch', 'batchname', 'graduationbatch'], example: '2025-2029' },
      { key: 'year', label: 'Year', required: false, aliases: ['year', 'classyear'], example: 'II Year' },
      { key: 'name', label: 'ClassName', required: false, aliases: ['classname', 'name'], example: '25-29 CSE' }
    ],
    subject: [
      { key: 'name', label: 'SubjectName', required: true, aliases: ['subjectname', 'name', 'title', 'subjecttitle'], example: 'Operating Systems' },
      { key: 'code', label: 'Code', required: true, aliases: ['code', 'subjectcode'], example: 'CS302' },
      { key: 'department', label: 'Department', required: true, aliases: ['department', 'dept', 'deptname', 'deptcode'], example: 'CSE' },
      { key: 'credits', label: 'Credits', required: false, aliases: ['credits', 'credit'], example: '4' },
      { key: 'type', label: 'Type', required: false, aliases: ['type', 'subjecttype'], example: 'Theory' }
    ],
    student: [
      { key: 'fullName', label: 'FullName', required: true, aliases: ['fullname', 'name', 'studentname'], example: 'Alex Mercer' },
      { key: 'registerNo', label: 'RegisterNo', required: true, aliases: ['registerno', 'regno', 'rollno', 'studentregisterno'], example: '7376222CS101' },
      { key: 'gender', label: 'Gender', required: true, aliases: ['gender', 'sex'], example: 'Male' },
      { key: 'academicYear', label: 'AcademicYear', required: true, aliases: ['academicyear', 'ay'], example: '2025-2026' },
      { key: 'batch', label: 'Batch', required: true, aliases: ['batch', 'batchname'], example: '2025-2029' },
      { key: 'courseType', label: 'CourseType', required: true, aliases: ['coursetype', 'course'], example: 'UG' },
      { key: 'branch', label: 'Branch', required: true, aliases: ['branch', 'degreebranch', 'degree'], example: 'B.E' },
      { key: 'department', label: 'Department', required: true, aliases: ['department', 'dept', 'deptname', 'deptcode'], example: 'CSE' },
      { key: 'class', label: 'Class', required: true, aliases: ['class', 'classname', 'section'], example: '25-29 CSE' },
      { key: 'email', label: 'Email', required: true, aliases: ['email', 'mail', 'emailaddress'], example: 'alex.m@student.edu' },
      { key: 'username', label: 'Username', required: true, aliases: ['username', 'user', 'loginid'], example: 'amercer' },
      { key: 'residency', label: 'Residency', required: false, aliases: ['residency', 'residencetype', 'residence', 'stay'], example: 'dayscholar' },
      { key: 'password', label: 'Password', required: false, aliases: ['password', 'pass'], example: 'Student@123' }
    ]
  };

  function resolveSchemaCols(type, schema) {
    if (!type) return [];
    var pool = (schema && schema.schemas) ? schema.schemas : (schema || {});
    var entry = pool[type];
    if (entry) {
      if (Array.isArray(entry)) return entry;
      if (Array.isArray(entry.columns)) return entry.columns;
    }
    return DEFAULT_SCHEMAS[type] || [];
  }

  // 2. COLUMN REFERENCE CARD
  registerCard('column-ref', {
    downloadTemplate: downloadTemplate,
    resolveSchemaCols: resolveSchemaCols,
    resolveSchema: resolveSchema,
    key: function (ctx) {
      var batch = ctx.batch || {};
      var type = batch.type || (ctx.msg && ctx.msg.payload && ctx.msg.payload.type) || 'student';
      var cols = resolveSchemaCols(type, ctx.schema);
      return 'col-ref-' + type + '-c' + cols.length;
    },
    mode: function (ctx) {
      var batch = ctx.batch || {};
      var batchKey = batch._id || 'temp';
      if (foldedOverrides[batchKey] !== undefined) {
        return foldedOverrides[batchKey] ? 'folded' : 'open';
      }
      if (typeof root.Bulk.cardMode === 'function') {
        return root.Bulk.cardMode('column-ref', batch);
      }
      return (!batch.status || batch.status === 'draft') ? 'open' : 'folded';
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var type = batch.type || (ctx.msg && ctx.msg.payload && ctx.msg.payload.type) || 'student';
      var schemaData = resolveSchema(type, ctx.schema);
      var schemaCols = schemaData.columns;
      var meta = config.TYPES[type] || { label: schemaData.label || type, icon: 'book-open' };
      var currentMode = this.mode(ctx);

      // Folded Pill State
      if (currentMode === 'folded') {
        return '<div class="guide-pill-wrap" style="padding:4px 0;">' +
          '<button type="button" class="guide-pill-toggle" data-action="toggle-guide" data-type="' + type + '">' +
            '<span>📘 ' + util.esc(meta.label) + ' Template &amp; Columns Guide</span>' +
            '<span style="opacity:0.75;font-weight:400;margin-left:6px;">▸ Show</span>' +
          '</button>' +
        '</div>';
      }

      // Open Detailed Guide Layout
      var reqCols = schemaCols.filter(function (c) { return c.required; });
      var reqNames = reqCols.map(function (c) { return util.esc(c.label || c.key); }).join(' · ');

      var html = '<div class="card-frame" data-mode="open">' +
        '<div class="card-header" style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;background:#f8faf8;border-bottom:1px solid var(--brl);">' +
          '<div class="card-title" style="font-weight:700;font-size:13.5px;color:var(--td);display:flex;align-items:center;gap:10px;">' +
            '<div style="width:30px;height:30px;border-radius:8px;background:rgba(46,125,50,0.12);color:var(--gD,#1b5e20);display:flex;align-items:center;justify-content:center;">' +
              '<re-icon icon="' + (meta.icon || 'book-open') + '" size="16"></re-icon>' +
            '</div>' +
            '<div>' +
              '<div>' + util.esc(meta.label) + ' Template &amp; Columns Guide</div>' +
              '<div style="font-size:11px;color:var(--tmu);font-weight:400;">Standard layout &amp; data validation rules</div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<button type="button" class="btn-download-tpl" data-action="download-template" data-type="' + type + '" title="Download official Excel template">' +
              '<re-icon icon="download" size="13"></re-icon> <span>Download Excel template</span>' +
            '</button>' +
            '<button type="button" class="btn-out" style="padding:5px 9px;font-size:11.5px;display:inline-flex;align-items:center;gap:4px;" data-action="toggle-guide" title="Collapse guide">' +
              '<re-icon icon="chevron-up" size="12"></re-icon> <span>Collapse</span>' +
            '</button>' +
          '</div>' +
        '</div>' +

        '<div class="card-body guide-full-body" style="padding:16px 18px;">' +
          // 1 · Required columns summary chip
          '<div style="margin-bottom:14px;padding:9px 14px;background:#f0fdf4;border-radius:10px;border:1px solid #bbf7d0;font-size:12px;line-height:1.5;display:flex;align-items:center;gap:8px;">' +
            '<span style="font-weight:700;color:#166534;white-space:nowrap;">1 · Required columns:</span>' +
            '<span style="color:#15803d;font-weight:500;">' + (reqNames || 'All standard columns') + '</span>' +
          '</div>' +

          // Columns Specification Table with horizontal scroll support
          '<div class="guide-table-scroll" style="overflow-x:auto;margin-bottom:16px;border:1px solid var(--brl);border-radius:10px;">' +
            '<table class="stg-table guide-spec-table" style="width:100%;min-width:640px;font-size:11.5px;border-collapse:collapse;">' +
              '<thead>' +
                '<tr style="background:#f4f7f4;text-align:left;">' +
                  '<th style="padding:9px 12px;white-space:nowrap;text-align:left;min-width:110px;">Column</th>' +
                  '<th style="padding:9px 12px;white-space:nowrap;text-align:left;min-width:85px;">Req.</th>' +
                  '<th style="padding:9px 12px;white-space:nowrap;text-align:left;min-width:170px;">Format / Allowed Values</th>' +
                  '<th style="padding:9px 12px;white-space:nowrap;text-align:left;min-width:120px;">Example</th>' +
                  '<th style="padding:9px 12px;white-space:nowrap;text-align:left;min-width:150px;">Rules</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>';

      if (schemaCols && schemaCols.length) {
        for (var i = 0; i < schemaCols.length; i++) {
          var col = schemaCols[i];
          var reqBadge = col.required
            ? '<span class="chat-status-pill status-verified_all" style="font-size:9.5px;font-weight:700;">● Required</span>'
            : '<span class="chat-status-pill status-draft" style="font-size:9.5px;">○ Optional</span>';
          var formatStr = col.format || (col.allowed && col.allowed.length ? col.allowed.join(' | ') : 'Text');
          var rulesStr = Array.isArray(col.rules) && col.rules.length ? col.rules.join(', ') : (col.description || 'standard');

          html += '<tr style="border-bottom:1px solid var(--brl);">' +
            '<td style="padding:8px 12px;font-weight:600;white-space:nowrap;text-align:left;">' + util.esc(col.label || col.key) + '</td>' +
            '<td style="padding:8px 12px;white-space:nowrap;text-align:left;">' + reqBadge + '</td>' +
            '<td style="padding:8px 12px;white-space:nowrap;color:var(--td);text-align:left;">' + util.esc(formatStr) + '</td>' +
            '<td style="padding:8px 12px;white-space:nowrap;color:var(--tmu);font-family:monospace;font-size:11px;text-align:left;">' + util.esc(col.example || '—') + '</td>' +
            '<td style="padding:8px 12px;white-space:nowrap;color:var(--tmu);font-size:11px;text-align:left;">' + util.esc(rulesStr) + '</td>' +
          '</tr>';
        }
      } else {
        html += '<tr><td colspan="5" style="padding:10px;text-align:center;color:var(--tmu);">Loading column specifications…</td></tr>';
      }

      html += '</tbody></table></div>';

      // 2 · Example rows mini-table
      if (schemaData.exampleRows && schemaData.exampleRows.length) {
        var headers = schemaCols.slice(0, 6).map(function (c) { return c.label || c.key; });
        html += '<div style="margin-bottom:16px;">' +
          '<div style="font-size:12px;font-weight:700;color:var(--td);margin-bottom:6px;">2 · Example rows</div>' +
          '<div style="overflow-x:auto;border:1px solid var(--brl);border-radius:10px;">' +
            '<table style="width:100%;min-width:600px;font-size:11.5px;border-collapse:collapse;background:#fafcfa;">' +
              '<thead><tr style="background:#eef4ee;text-align:left;">';
        for (var h = 0; h < headers.length; h++) {
          html += '<th style="padding:7px 12px;border-right:1px solid var(--brl);font-weight:600;white-space:nowrap;text-align:left;">' + util.esc(headers[h]) + '</th>';
        }
        html += '</tr></thead><tbody>';
        for (var r = 0; r < schemaData.exampleRows.length; r++) {
          var rowData = schemaData.exampleRows[r];
          html += '<tr style="border-top:1px solid var(--brl);">';
          for (var cIdx = 0; cIdx < headers.length; cIdx++) {
            var colKey = headers[cIdx];
            var val = rowData[colKey] !== undefined ? rowData[colKey] : (rowData[colKey.toLowerCase()] !== undefined ? rowData[colKey.toLowerCase()] : '—');
            html += '<td style="padding:7px 12px;border-right:1px solid var(--brl);white-space:nowrap;text-align:left;">' + util.esc(val) + '</td>';
          }
          html += '</tr>';
        }
        html += '</tbody></table></div></div>';
      }

      // 3 · Common mistakes
      if (schemaData.commonMistakes && schemaData.commonMistakes.length) {
        html += '<div style="margin-bottom:14px;padding:10px 12px;background:#fef9f4;border-radius:10px;border:1px solid #fde68a;font-size:11.5px;">' +
          '<div style="font-weight:700;color:#92400e;margin-bottom:4px;">3 · Common mistakes to avoid:</div>' +
          '<ul style="margin:0;padding-left:18px;color:#78350f;line-height:1.5;">';
        for (var m = 0; m < schemaData.commonMistakes.length; m++) {
          html += '<li>' + util.esc(schemaData.commonMistakes[m]) + '</li>';
        }
        html += '</ul></div>';
      }

      // 4 · Limits summary pill
      var limits = schemaData.limits || {};
      html += '<div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--tmu);padding-top:4px;border-top:1px solid var(--brl);">' +
        '<strong>4 · Limits:</strong>' +
        '<span>Max ' + (limits.maxFileSizeMb || 10) + ' MB · ' + (limits.maxRows || 5000) + ' rows · .xlsx or .csv · first sheet only</span>' +
      '</div>';

      html += '</div></div>';
      return html;
    },
    update: function (el, ctx) {
      if (!el) return;
      var newMode = this.mode(ctx);
      el.setAttribute('data-mode', newMode);
      el.innerHTML = this.render(ctx);
      this.bind(el, ctx);
    },
    bind: function (el, ctx) {
      var self = this;
      el.addEventListener('click', function (e) {
        var downloadBtn = e.target.closest('[data-action="download-template"]');
        if (downloadBtn) {
          var t = downloadBtn.getAttribute('data-type');
          if (t) downloadTemplate(t);
          return;
        }

        var toggleBtn = e.target.closest('[data-action="toggle-guide"]');
        if (toggleBtn) {
          var batch = ctx.batch || {};
          var batchKey = batch._id || 'temp';
          var current = self.mode(ctx);
          foldedOverrides[batchKey] = (current === 'open');
          el.innerHTML = self.render(ctx);
          self.bind(el, ctx);
          return;
        }
      });
    }
  });

  // 3. UPLOAD CARD
  registerCard('upload', {
    key: function (ctx) {
      var b = ctx.batch || {};
      return ['up', b.status || 'draft', b.originalFileName || ''].join('|');
    },
    mode: function (ctx) {
      var batch = ctx.batch || {};
      if (typeof root.Bulk.cardMode === 'function') {
        return root.Bulk.cardMode('upload', batch);
      }
      return (!batch.status || batch.status === 'draft') ? 'open' : 'closed';
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var currentMode = this.mode(ctx);
      if (currentMode === 'closed') {
        return '<div class="card-frame card-closed" style="display:none;"></div>';
      }

      var html = '<div class="card-frame" data-mode="open">' +
        '<div class="card-header">' +
          '<div class="card-title">' +
            '<re-icon icon="upload-cloud" size="16"></re-icon>' +
            '<span>Upload Spreadsheet (.xlsx, .csv)</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--tmu);">Max 10 MB · Up to 5,000 rows</div>' +
        '</div>' +
        '<div class="card-body">';

      var hasPreviousUploads = batch.status === 'draft' && Array.isArray(batch.uploads) && batch.uploads.length > 0;
      var latestUpload = hasPreviousUploads ? batch.uploads[batch.uploads.length - 1] : null;

      if (latestUpload) {
        html += '<div class="restage-box" style="margin-bottom:16px;padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
          '<div style="display:flex;align-items:center;gap:10px;">' +
            '<div style="width:36px;height:36px;border-radius:10px;background:#dcfce7;color:#166534;display:flex;align-items:center;justify-content:center;">' +
              '<re-icon icon="file-spreadsheet" size="18"></re-icon>' +
            '</div>' +
            '<div>' +
              '<div style="font-weight:700;font-size:13px;color:#166534;">Use previously uploaded spreadsheet</div>' +
              '<div style="font-size:11.5px;color:#15803d;">' +
                util.esc(latestUpload.name || 'sheet.xlsx') + ' · ' + util.formatBytes(latestUpload.size || 0) + ' · ' + util.timeAgo(latestUpload.at) +
              '</div>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn-restage" data-action="restage-file" data-upload-index="' + (batch.uploads.length - 1) + '" style="padding:7px 14px;font-size:12px;font-weight:600;background:#16a34a;color:#fff;border:none;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
            '<re-icon icon="refresh-cw" size="13"></re-icon>' +
            '<span>Use this file →</span>' +
          '</button>' +
        '</div>' +
        '<div style="text-align:center;font-size:11px;color:var(--tmu);margin-bottom:14px;position:relative;">' +
          '<span style="background:#fff;padding:0 8px;position:relative;z-index:1;">or upload a new spreadsheet</span>' +
          '<div style="position:absolute;top:50%;left:0;right:0;height:1px;background:var(--brl,#e2e8f0);z-index:0;"></div>' +
        '</div>';
      }

      html += '<div class="uz" id="chat-dropzone" style="cursor:pointer;padding:28px 20px;text-align:center;border:2px dashed var(--br);border-radius:14px;background:#fbfdfb;transition:all 0.2s;">' +
            '<input type="file" id="chat-file-input" accept=".xlsx,.csv" style="display:none;">' +
            '<div style="width:44px;height:44px;border-radius:12px;background:var(--gLt);color:var(--gD);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;">' +
              '<re-icon icon="file-spreadsheet" size="22"></re-icon>' +
            '</div>' +
            '<div style="font-weight:700;font-size:13.5px;color:var(--td);margin-bottom:4px;" id="chat-dropzone-title">' +
              'Drag & drop your Excel file here, or click to browse' +
            '</div>' +
            '<div style="font-size:11.5px;color:var(--tmu);" id="chat-dropzone-sub">' +
              'Supports Microsoft Excel (.xlsx) and Comma-Separated Values (.csv)' +
            '</div>' +
            '<div id="chat-upload-prog-wrap" style="display:none;margin-top:14px;max-width:320px;margin-left:auto;margin-right:auto;">' +
              '<div class="prog-bar-track">' +
                '<div class="prog-bar-fill" id="chat-upload-prog-fill" style="width:0%;"></div>' +
              '</div>' +
              '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--tmu);margin-top:4px;">' +
                '<span id="chat-upload-prog-text">Uploading…</span>' +
                '<span id="chat-upload-prog-pct">0%</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
      return html;
    },
    update: function (el, ctx) {
      if (!el) return;
      var newMode = this.mode(ctx);
      el.setAttribute('data-mode', newMode);
      if (newMode === 'closed') {
        el.style.transition = 'all 0.32s ease';
        el.style.opacity = '0';
        el.style.transform = 'scaleY(0.9)';
        setTimeout(function () {
          el.style.display = 'none';
        }, 320);
      } else {
        el.style.display = '';
        el.style.opacity = '1';
        el.style.transform = '';
        el.innerHTML = this.render(ctx);
        this.bind(el, ctx);
      }
    },
    bind: function (el, ctx) {
      var batch = ctx.batch || {};
      if (this.mode(ctx) === 'closed') return;

      var dropzone = el.querySelector('#chat-dropzone');
      var fileInput = el.querySelector('#chat-file-input');
      var progWrap = el.querySelector('#chat-upload-prog-wrap');
      var progFill = el.querySelector('#chat-upload-prog-fill');
      var progText = el.querySelector('#chat-upload-prog-text');
      var progPct = el.querySelector('#chat-upload-prog-pct');
      var titleEl = el.querySelector('#chat-dropzone-title');

      if (!dropzone || !fileInput) return;

      var restageBtn = el.querySelector('[data-action="restage-file"]');
      if (restageBtn) {
        restageBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var uIdx = parseInt(restageBtn.getAttribute('data-upload-index'), 10) || 0;
          restageBtn.disabled = true;
          restageBtn.innerHTML = '<span>Processing…</span>';

          api.restageBatch(batch._id, uIdx).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Re-processing uploaded spreadsheet…');
          }).catch(function (err) {
            restageBtn.disabled = false;
            restageBtn.innerHTML = '<re-icon icon="refresh-cw" size="13"></re-icon><span>Use this file →</span>';
            if (typeof root.showToast === 'function') root.showToast('Failed to restage: ' + err.message, 'warn');
          });
        });
      }

      dropzone.addEventListener('click', function () {
        fileInput.click();
      });

      dropzone.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropzone.classList.add('dg');
      });

      dropzone.addEventListener('dragleave', function () {
        dropzone.classList.remove('dg');
      });

      dropzone.addEventListener('drop', function (e) {
        e.preventDefault();
        dropzone.classList.remove('dg');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          handleFile(e.dataTransfer.files[0]);
        }
      });

      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) {
          handleFile(fileInput.files[0]);
        }
      });

      function handleFile(file) {
        var name = file.name.toLowerCase();
        if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
          if (typeof root.showToast === 'function') root.showToast('Please upload a valid .xlsx or .csv file (.xls not supported)', 'warn');
          return;
        }

        if (file.size > 10 * 1024 * 1024) {
          if (typeof root.showToast === 'function') root.showToast('File exceeds 10 MB limit', 'warn');
          return;
        }

        var batchId = ctx.batch._id;

        // 1. Dispatch optimistic right-side file bubble
        var optMsg = {
          _id: 'opt-' + Date.now(),
          batchId: batchId,
          kind: 'user-file',
          card: 'file',
          sender: store.getState().user || { name: 'You', role: 'teacher' },
          author: 'user',
          payload: {
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          },
          createdAt: new Date().toISOString(),
          seq: (ctx.batch.messageSeq || 0) + 1
        };

        // 2. Fold Guide card
        foldedOverrides[batchId] = true;
        var guideEl = document.querySelector('[data-card-key^="col-ref-"]');
        if (guideEl && cards['column-ref'] && typeof cards['column-ref'].update === 'function') {
          cards['column-ref'].update(guideEl, ctx);
        }

        // 3. Animate-close Upload card
        el.setAttribute('data-mode', 'closed');
        el.style.transition = 'all 0.32s ease';
        el.style.opacity = '0';
        el.style.transform = 'scaleY(0.9)';
        setTimeout(function () {
          el.style.display = 'none';
        }, 320);

        // 4. Update batch and progress in store to trigger stage card
        var patchedBatch = Object.assign({}, ctx.batch, {
          status: 'uploading',
          originalFileName: file.name,
          fileSize: file.size,
          progress: {
            jobKind: 'stage',
            percent: 5,
            phase: 'Uploading file…',
            stage: { index: 0, total: 6, key: 'receive', text: 'Uploading the file' }
          }
        });

        var nextMsgs = (store.getState().messages || []).concat([optMsg]);
        store.setState({
          batch: patchedBatch,
          messages: nextMsgs,
          progress: patchedBatch.progress
        });

        // 5. Fire upload XHR
        api.upload(batchId, file, function (loaded, total) {
          var pct = Math.round((loaded / total) * 100);
          if (progFill) progFill.style.width = pct + '%';
          if (progPct) progPct.textContent = pct + '%';
          if (progText) progText.textContent = util.formatBytes(loaded) + ' of ' + util.formatBytes(total);
        }).then(function (res) {
          if (typeof root.showToast === 'function') root.showToast('File uploaded. Processing stages…');
          if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
        }).catch(function (err) {
          // Re-open on error
          el.style.display = '';
          el.style.opacity = '1';
          el.style.transform = '';
          el.setAttribute('data-mode', 'open');
          foldedOverrides[batchId] = false;
          if (guideEl && cards['column-ref']) cards['column-ref'].update(guideEl, ctx);
          if (typeof root.showToast === 'function') root.showToast('Upload error: ' + err.message, 'danger');
        });
      }
    }
  });

  // 3b. UPLOADED SPREADSHEET FILE CARD (WhatsApp-style document bubble)
  registerCard('file', {
    key: function (ctx) {
      var p = (ctx.msg && ctx.msg.payload) || {};
      return ['file', p.name || '', p.size || 0].join('|');
    },
    mode: function () {
      return 'open';
    },
    render: function (ctx) {
      var p = (ctx.msg && ctx.msg.payload) || {};
      var name = p.name || 'Spreadsheet.xlsx';
      var bytes = p.size || 0;
      var sizeStr = util.formatBytes ? util.formatBytes(bytes) : ((bytes ? (bytes / 1024).toFixed(1) : 0) + ' KB');
      var ext = (name.split('.').pop() || 'XLSX').toUpperCase();
      var isExcel = ext === 'XLSX' || ext === 'XLS';
      var isCsv = ext === 'CSV';
      var typeDesc = isExcel ? 'Excel Spreadsheet' : (isCsv ? 'CSV Document' : 'Spreadsheet File');

      var fileSvg = (typeof root.getIconSvg === 'function')
        ? root.getIconSvg('file-spreadsheet', { size: 20 })
        : '<re-icon icon="file-spreadsheet" size="20"></re-icon>';

      return '<div class="file-attachment-card" data-ext="' + util.esc(ext.toLowerCase()) + '">' +
        '<div class="file-icon-box ' + (isExcel ? 'is-excel' : (isCsv ? 'is-csv' : '')) + '">' +
          fileSvg +
          '<span class="file-badge">' + util.esc(ext) + '</span>' +
        '</div>' +
        '<div class="file-details">' +
          '<div class="file-name" title="' + util.esc(name) + '">' + util.esc(name) + '</div>' +
          '<div class="file-meta">' +
            '<span class="file-size">' + util.esc(sizeStr) + '</span>' +
            '<span class="file-dot">•</span>' +
            '<span class="file-desc">' + util.esc(typeDesc) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    }
  });

  // 4. PROGRESS CARD (Single Status Line Stage Engine)
  registerCard('progress', {
    key: function (ctx) {
      var p = ctx.progress || (ctx.batch ? ctx.batch.progress : null);
      if (!p) return 'prog-empty';
      var stg = p.stage || {};
      return [p.jobKind, p.phase, p.percent, stg.key, stg.index, p.error].join('|');
    },
    mode: function (ctx) {
      var batch = ctx.batch || {};
      if (typeof root.Bulk.cardMode === 'function') {
        return root.Bulk.cardMode('progress', batch);
      }
      var s = batch.status;
      if (s === 'uploading' || s === 'processing' || s === 'committing') return 'open';
      if (s === 'staged' || s === 'skipped_resolved' || s === 'committed') return 'folded';
      return 'closed';
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var currentMode = this.mode(ctx);
      if (currentMode === 'closed') {
        return '<div class="card-frame card-closed" style="display:none;"></div>';
      }
      if (currentMode === 'folded') {
        if (root.Bulk && root.Bulk.stage && typeof root.Bulk.stage.renderDoneChip === 'function') {
          return root.Bulk.stage.renderDoneChip(batch);
        }
        var totalRows = (batch.eligibleRows ? batch.eligibleRows.length : 0) + (batch.skippedRows ? batch.skippedRows.length : 0);
        return '<div class="chip-stage-done" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#eef7ee;color:var(--gD);border-radius:16px;font-size:12px;font-weight:600;">' +
          '<span>✓</span> <span>Validated ' + (totalRows || 0) + ' rows</span>' +
        '</div>';
      }

      // Open mode: 6-dot single status line
      if (root.Bulk && root.Bulk.stage && typeof root.Bulk.stage.render === 'function') {
        return root.Bulk.stage.render(ctx);
      }

      var p = ctx.progress || (ctx.batch ? ctx.batch.progress : null) || {};
      return '<div class="progress-card-box">' +
        '<div style="font-size:13px;font-weight:700;color:var(--td);margin-bottom:8px;">Parsing &amp; Validating Workbook</div>' +
        '<div style="font-size:12px;color:var(--tmu);">' + util.esc(p.phase || 'Processing…') + '</div>' +
      '</div>';
    },
    update: function (el, ctx) {
      if (!el) return;
      var newMode = this.mode(ctx);
      el.setAttribute('data-mode', newMode);
      if (newMode === 'closed') {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      if (newMode === 'folded') {
        el.innerHTML = this.render(ctx);
      } else if (newMode === 'open') {
        if (root.Bulk && root.Bulk.stage && typeof root.Bulk.stage.update === 'function') {
          root.Bulk.stage.update(el, ctx);
        } else {
          el.innerHTML = this.render(ctx);
        }
      }
    },
    bind: function (el, ctx) {}
  });

  // 5. SUMMARY CARD (Phase 4 V2: Skipped Checklist, CSV Report, Grievances, Auto-Approve CTA)
  registerCard('summary', {
    mode: function (ctx) {
      var batch = ctx.batch || {};
      if (typeof root.Bulk.cardMode === 'function') {
        return root.Bulk.cardMode('summary', batch);
      }
      var s = batch.status;
      if (s === 'draft' || s === 'uploading' || s === 'processing') return 'closed';
      return 'open';
    },
    key: function (ctx) {
      var b = ctx.batch || {};
      var skippedDoneCount = 0;
      var skipped = b.skippedRows || [];
      for (var i = 0; i < skipped.length; i++) {
        if (skipped[i].isDone || skipped[i].isResolved) skippedDoneCount++;
      }
      var grvOpen = (b.grievance && b.grievance.open) || 0;
      return [b.status, b.eligibleCount, b.skippedCount, skippedDoneCount, grvOpen, b.drive ? b.drive.folderUrl : ''].join('|');
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var total = (batch.eligibleCount || 0) + (batch.skippedCount || 0);
      var eligible = batch.eligibleCount || 0;
      var skippedList = batch.skippedRows || [];
      var skippedCount = batch.skippedCount || skippedList.length;

      var unresolvedCount = 0;
      for (var s = 0; s < skippedList.length; s++) {
        if (!skippedList[s].isDone && !skippedList[s].isResolved) unresolvedCount++;
      }

      var user = ctx.user || ctx.viewer || (store.getState ? store.getState().user : null) || {};
      var isAutoApprover = Boolean(
        user.isSudoAdmin ||
        user.accessRole === 'sudoAdmin' ||
        user.accessRole === 'superAdmin' ||
        user.role === 'sudo' ||
        (user.role === 'admin' && user.adminFlag !== 'subadmin')
      );

      var isForwarded = ['pending_sudo_initial', 'sudo_initial_approved', 'verifying', 'verified_all', 'pending_final_approval', 'committing', 'committed'].includes(batch.status);
      var isStagedOrSkipped = batch.status === 'staged' || batch.status === 'skipped_resolved';
      var openGrievanceCount = (batch.grievance && batch.grievance.open) || 0;

      var html = '<div class="card-frame" data-card="summary">' +
        '<div class="card-header" style="display:flex;align-items:center;justify-content:space-between;">' +
          '<div class="card-title">' +
            '<re-icon icon="clipboard-check" size="16"></re-icon>' +
            '<span>Staging Summary &amp; Validation Report</span>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            (openGrievanceCount > 0 ? (
              '<button type="button" class="btn-out" data-action="open-grievances" style="padding:2px 8px;font-size:11px;background:#fef2f2;border-color:#fca5a5;color:#991b1b;font-weight:700;">' +
                '<re-icon icon="flag" size="12"></re-icon> ' + openGrievanceCount + ' open grievance' + (openGrievanceCount > 1 ? 's' : '') +
              '</button>'
            ) : '') +
            '<div style="font-size:11px;color:var(--tmu);">' + util.fmtDate(batch.updatedAt || batch.createdAt) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-body">' +
          // 3 Stat Tiles
          '<div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:12px;margin-bottom:16px;">' +
            '<div style="background:#f8faf8;padding:12px;border-radius:12px;border:1px solid var(--brl);text-align:center;">' +
              '<div style="font-size:11px;color:var(--tmu);font-weight:600;text-transform:uppercase;">Total Scanned</div>' +
              '<div style="font-size:22px;font-weight:700;color:var(--td);margin-top:2px;">' + total + '</div>' +
            '</div>' +
            '<div style="background:#f0fdf4;padding:12px;border-radius:12px;border:1px solid #bbf7d0;text-align:center;">' +
              '<div style="font-size:11px;color:#166534;font-weight:600;text-transform:uppercase;">Eligible Rows</div>' +
              '<div style="font-size:22px;font-weight:700;color:#15803d;margin-top:2px;">' + eligible + '</div>' +
            '</div>' +
            '<div style="background:' + (skippedCount > 0 ? '#fffbeb' : '#f8faf8') + ';padding:12px;border-radius:12px;border:1px solid ' + (skippedCount > 0 ? '#fde68a' : 'var(--brl)') + ';text-align:center;">' +
              '<div style="font-size:11px;color:' + (skippedCount > 0 ? '#92400e' : 'var(--tmu)') + ';font-weight:600;text-transform:uppercase;">Skipped / Conflicts</div>' +
              '<div style="font-size:22px;font-weight:700;color:' + (skippedCount > 0 ? '#b45309' : 'var(--tmu)') + ';margin-top:2px;">' + skippedCount + '</div>' +
            '</div>' +
          '</div>';

      // Admin-only Drive Strip (Redacted by server for staff)
      if (batch.drive) {
        var driveFolder = batch.drive.folderUrl;
        var driveFile = batch.drive.fileUrl;
        var isDriveDegraded = batch.drive.status === 'folder_failed' || batch.drive.status === 'file_failed';

        if (isDriveDegraded) {
          html += '<div class="drive-sync-strip" style="background:#fff7ed;border-color:#fed7aa;">' +
            '<div class="drive-sync-info" style="color:#c2410c;">' +
              '<re-icon icon="alert-triangle" size="16"></re-icon>' +
              '<span>Google Drive folder not created or sync degraded</span>' +
            '</div>' +
            '<div class="drive-actions">' +
              '<button type="button" class="btn-out drive-btn" data-action="retry-drive"><re-icon icon="refresh-cw" size="13"></re-icon> Retry Drive</button>' +
            '</div>' +
          '</div>';
        } else if (driveFolder || driveFile) {
          html += '<div class="drive-sync-strip">' +
            '<div class="drive-sync-info">' +
              '<re-icon icon="hard-drive" size="16"></re-icon>' +
              '<span>Google Drive Folder &amp; Raw Sheet Synchronized</span>' +
            '</div>' +
            '<div class="drive-actions">' +
              (driveFolder ? ('<a href="' + util.esc(driveFolder) + '" target="_blank" class="btn-out drive-btn"><re-icon icon="folder" size="13"></re-icon> Open Folder</a>') : '') +
              (driveFile ? ('<a href="' + util.esc(driveFile) + '" target="_blank" class="btn-out drive-btn"><re-icon icon="external-link" size="13"></re-icon> View Sheet</a>') : '') +
            '</div>' +
          '</div>';
        }
      }

      // Skipped Rows Checklist v2
      if (skippedList.length > 0) {
        var showFilters = skippedList.length > 20;

        html += '<div style="margin-top:16px;border-top:1px solid var(--brl);padding-top:16px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;flex-wrap:wrap;gap:8px;">' +
            '<div style="font-weight:700;font-size:12.5px;color:#92400e;display:flex;align-items:center;gap:6px;">' +
              '<re-icon icon="alert-triangle" size="15"></re-icon>' +
              '<span>Skipped Rows Checklist (' + unresolvedCount + ' pending)</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              (showFilters ? (
                '<div class="skipped-filter-strip" style="display:flex;gap:4px;">' +
                  '<button type="button" class="skipped-pill act" data-filter="all">All ' + skippedList.length + '</button>' +
                  '<button type="button" class="skipped-pill" data-filter="pending">Pending ' + unresolvedCount + '</button>' +
                  '<button type="button" class="skipped-pill" data-filter="done">Done ' + (skippedList.length - unresolvedCount) + '</button>' +
                  '<input type="text" class="skipped-filter-input" placeholder="Search rows…" style="padding:2px 8px;font-size:11px;border:1px solid var(--brl);border-radius:12px;width:110px;">' +
                '</div>'
              ) : '') +
              (!isForwarded ? '<button type="button" class="btn-out" style="padding:3px 8px;font-size:11px;" data-action="mark-all-done"><re-icon icon="check-check" size="12"></re-icon> Mark All Done</button>' : '') +
            '</div>' +
          '</div>' +

          // Table layout: Row 56px, Identifier minmax(150px, 1fr), Reason 2fr, Done 64px
          '<div style="max-height:260px;overflow-y:auto;border:1px solid var(--brl);border-radius:10px;" class="skipped-table-wrap">' +
            '<table class="stg-table skipped-table" style="width:100%;font-size:11.5px;border-collapse:collapse;">' +
              '<thead style="position:sticky;top:0;z-index:2;background:#f8faf8;">' +
                '<tr style="border-bottom:1px solid var(--br);text-align:left;">' +
                  '<th style="padding:8px 10px;width:56px;">Row</th>' +
                  '<th style="padding:8px 10px;min-width:150px;">Identifier / Name</th>' +
                  '<th style="padding:8px 10px;">Reason / Issues</th>' +
                  '<th style="padding:8px 10px;width:64px;text-align:center;">Done</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody id="skipped-rows-tbody">';

        for (var r = 0; r < skippedList.length; r++) {
          var row = skippedList[r];
          var isDone = Boolean(row.isDone || row.isResolved);
          var rowKey = (row.rowNumber !== undefined ? row.rowNumber : r);
          var ident = row.name || (row.data ? (row.data.registerNo || row.data.name || row.data.fullName || row.data.employeeNo || row.data.code) : '') || '—';
          var issuesStr = Array.isArray(row.issues) && row.issues.length ? row.issues.join('; ') : (row.reason || 'Invalid data');

          html += '<tr class="skipped-row-item" data-done="' + (isDone ? '1' : '0') + '" data-search="' + util.esc((ident + ' ' + issuesStr).toLowerCase()) + '" style="border-bottom:1px solid var(--brl);background:' + (isDone ? '#f0fdf4' : '#ffffff') + ';">' +
            '<td style="padding:8px 10px;font-weight:700;color:var(--td);">' + (row.rowNumber || (r + 1)) + '</td>' +
            '<td style="padding:8px 10px;font-weight:600;color:var(--td);">' + util.esc(ident) + '</td>' +
            '<td style="padding:8px 10px;color:#92400e;line-height:1.4;">' + util.esc(issuesStr) + '</td>' +
            '<td style="padding:8px 10px;text-align:center;">' +
              '<input type="checkbox" class="skipped-done-check" data-row-key="' + rowKey + '" ' + (isDone ? 'checked' : '') + ' ' + (isForwarded ? 'disabled' : '') + '>' +
            '</td>' +
          '</tr>';
        }

        html += '</tbody></table></div>';

        // Skipped Footer Bar: Grievance, CSV Download, Re-scan, Continue
        html += '<div style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<button type="button" class="btn-out" data-action="open-report-grievance" style="font-size:11px;padding:5px 10px;color:#92400e;border-color:#fde68a;background:#fffbeb;">' +
              '<re-icon icon="flag" size="13"></re-icon> <span>⚑ Grievances</span>' +
            '</button>' +
            '<button type="button" class="btn-out" data-action="download-skipped-csv" style="font-size:11px;padding:5px 10px;">' +
              '<re-icon icon="download" size="13"></re-icon> <span>⬇ Skipped report (.csv)</span>' +
            '</button>' +
          '</div>' +
          (isStagedOrSkipped ? (
            '<div style="display:flex;gap:8px;align-items:center;">' +
              '<button type="button" class="btn-out" style="padding:7px 12px;font-size:11.5px;" data-action="rescan-batch">' +
                '<re-icon icon="refresh-cw" size="13"></re-icon> <span>↻ Re-scan file</span>' +
              '</button>' +
              '<button type="button" class="btn-replace" style="padding:7px 18px;font-size:12px;background:var(--gB);" data-action="forward-sudo" ' + (unresolvedCount > 0 ? 'disabled title="Please mark all skipped rows as done before continuing"' : '') + '>' +
                (isAutoApprover
                  ? '<re-icon icon="check" size="14"></re-icon> <span>Continue — auto-approve</span>'
                  : '<re-icon icon="arrow-right" size="14"></re-icon> <span>Request initial approval</span>') +
              '</button>' +
            '</div>'
          ) : '') +
        '</div>' +
        '</div>';
      } else if (isStagedOrSkipped) {
        // No skipped rows: simple continue bar
        html += '<div style="margin-top:20px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--brl);padding-top:14px;">' +
          '<button type="button" class="btn-out" style="padding:8px 14px;font-size:12px;" data-action="rescan-batch">' +
            '<re-icon icon="refresh-cw" size="13"></re-icon> Re-scan file' +
          '</button>' +
          '<button type="button" class="btn-replace" style="padding:8px 20px;font-size:12.5px;background:var(--gB);" data-action="forward-sudo">' +
            (isAutoApprover
              ? '<re-icon icon="check" size="14"></re-icon> <span>Continue — auto-approve</span>'
              : '<re-icon icon="arrow-right" size="14"></re-icon> <span>Request initial approval</span>') +
          '</button>' +
        '</div>';
      } else if (isForwarded) {
        html += '<div style="margin-top:14px;font-size:11.5px;color:var(--gD);display:flex;align-items:center;gap:6px;">' +
          '<re-icon icon="check-circle" size="15"></re-icon>' +
          '<span>Initial approval granted / in verification pipeline</span>' +
        '</div>';
      }

      html += '</div></div>';
      return html;
    },
    bind: function (el, ctx) {
      var batch = ctx.batch || {};
      var batchId = batch._id;

      // Handle Skipped Rows Checkbox Toggle
      var debouncedSave = util.debounce(function () {
        var checkboxes = el.querySelectorAll('.skipped-done-check');
        var resolved = [];
        checkboxes.forEach(function (cb) {
          if (cb.checked) {
            resolved.push(parseInt(cb.getAttribute('data-row-key'), 10));
          }
        });
        api.resolveSkipped(batchId, resolved).then(function (res) {
          if (res && res.batch) {
            store.setState({ batch: res.batch });
          } else {
            api.getBatch(batchId).then(function (bRes) {
              var fresh = (bRes && bRes.data && bRes.data.batch) || (bRes && bRes.batch);
              if (fresh) store.setState({ batch: fresh });
            });
          }
        }).catch(function (err) {
          if (typeof root.showToast === 'function') root.showToast('Failed to update: ' + err.message, 'danger');
        });
      }, 300);

      el.addEventListener('change', function (e) {
        if (e.target.classList.contains('skipped-done-check')) {
          var tr = e.target.closest('tr');
          if (tr) {
            tr.style.background = e.target.checked ? '#f0fdf4' : '#ffffff';
            tr.setAttribute('data-done', e.target.checked ? '1' : '0');
          }
          debouncedSave();
        }
      });

      // Filter pills & search filter in skipped rows table
      var filterPills = el.querySelectorAll('.skipped-pill');
      var filterInput = el.querySelector('.skipped-filter-input');
      var currentFilter = 'all';

      function applyRowFilters() {
        var query = (filterInput ? filterInput.value : '').toLowerCase().trim();
        var rows = el.querySelectorAll('.skipped-row-item');
        rows.forEach(function (row) {
          var isDone = row.getAttribute('data-done') === '1';
          var matchesFilter = (currentFilter === 'all') ||
                              (currentFilter === 'pending' && !isDone) ||
                              (currentFilter === 'done' && isDone);
          var searchContent = row.getAttribute('data-search') || '';
          var matchesSearch = !query || searchContent.includes(query);

          row.style.display = (matchesFilter && matchesSearch) ? '' : 'none';
        });
      }

      filterPills.forEach(function (pill) {
        pill.addEventListener('click', function () {
          filterPills.forEach(function (p) { p.classList.remove('act'); });
          pill.classList.add('act');
          currentFilter = pill.getAttribute('data-filter') || 'all';
          applyRowFilters();
        });
      });

      if (filterInput) {
        filterInput.addEventListener('input', applyRowFilters);
      }

      // Mark all done button
      var markAllBtn = el.querySelector('[data-action="mark-all-done"]');
      if (markAllBtn) {
        markAllBtn.addEventListener('click', function () {
          var checkboxes = el.querySelectorAll('.skipped-done-check');
          var resolved = [];
          checkboxes.forEach(function (cb) {
            cb.checked = true;
            resolved.push(parseInt(cb.getAttribute('data-row-key'), 10));
            var tr = cb.closest('tr');
            if (tr) {
              tr.style.background = '#f0fdf4';
              tr.setAttribute('data-done', '1');
            }
          });
          api.resolveSkipped(batchId, resolved).then(function (res) {
            if (typeof root.showToast === 'function') root.showToast('All skipped issues marked as done');
            api.getBatch(batchId).then(function (bRes) {
              var fresh = (bRes && bRes.data && bRes.data.batch) || (bRes && bRes.batch);
              if (fresh) store.setState({ batch: fresh });
            });
          }).catch(function (err) {
            if (typeof root.showToast === 'function') root.showToast('Failed to mark all done: ' + err.message, 'danger');
          });
        });
      }

      // Action clicks: download CSV, re-scan, forward-sudo, retry-drive
      el.addEventListener('click', function (e) {
        if (e.target.closest('[data-action="download-skipped-csv"]')) {
          api.downloadSkippedCsv(batchId);
          return;
        }

        var rescanBtn = e.target.closest('[data-action="rescan-batch"]');
        if (rescanBtn) {
          rescanBtn.disabled = true;
          api.rescanBatch(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Re-scan initiated');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            rescanBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast('Re-scan failed: ' + err.message, 'danger');
          });
          return;
        }

        var fwdBtn = e.target.closest('[data-action="forward-sudo"]');
        if (fwdBtn) {
          fwdBtn.disabled = true;
          fwdBtn.textContent = 'Submitting…';
          api.forwardSudo(batchId).then(function (res) {
            if (typeof root.showToast === 'function') {
              root.showToast(res.message || 'Advanced to next stage');
            }
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            fwdBtn.disabled = false;
            fwdBtn.textContent = 'Continue';
            if (typeof root.showToast === 'function') root.showToast('Error: ' + err.message, 'danger');
          });
          return;
        }

        var retryDriveBtn = e.target.closest('[data-action="retry-drive"]');
        if (retryDriveBtn) {
          retryDriveBtn.disabled = true;
          retryDriveBtn.textContent = 'Retrying…';
          api.retryDrive(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Google Drive retry initiated');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            retryDriveBtn.disabled = false;
            retryDriveBtn.textContent = 'Retry Drive';
            if (typeof root.showToast === 'function') root.showToast('Drive retry failed: ' + err.message, 'danger');
          });
          return;
        }
      });
    }
  });

  // 5.5 GRIEVANCE CARD (Problem Report Chat Bubble)
  registerCard('grievance', {
    key: function (ctx) {
      var p = (ctx.msg && ctx.msg.payload) || {};
      return ['grievance', p.status || 'open', (p.rows || []).length].join('|');
    },
    render: function (ctx) {
      var msg = ctx.msg || {};
      var p = msg.payload || {};
      var isResolved = p.status === 'resolved';
      var viewer = ctx.viewer || ctx.user || {};
      var isAdm = viewer.role === 'admin' || viewer.role === 'sudo' || viewer.isSudoAdmin || viewer.accessRole === 'sudoAdmin' || viewer.accessRole === 'superAdmin';

      var html = '<div class="card-frame card-grievance" style="border-color:' + (isResolved ? '#bbf7d0' : '#fecaca') + ';">' +
        '<div class="card-header" style="background:' + (isResolved ? '#f0fdf4' : '#fff5f5') + ';display:flex;align-items:center;justify-content:space-between;padding:10px 14px;">' +
          '<div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:12.5px;color:' + (isResolved ? '#15803d' : '#991b1b') + ';">' +
            '<re-icon icon="flag" size="14"></re-icon>' +
            '<span>Problem Report · ' + ((p.rows && p.rows.length) || 0) + ' row(s) flagged</span>' +
          '</div>' +
          '<span class="chat-status-pill ' + (isResolved ? 'status-verified_all' : 'status-failed') + '">' +
            (isResolved ? '✓ Resolved' : '● Open') +
          '</span>' +
        '</div>' +
        '<div class="card-body" style="padding:12px 14px;">' +
          (p.note ? ('<div style="font-size:12px;color:#78350f;background:#fef3c7;padding:6px 10px;border-radius:8px;margin-bottom:8px;"><strong>Note:</strong> ' + util.esc(p.note) + '</div>') : '') +
          '<div style="font-size:11px;font-family:monospace;color:var(--td);background:#fbfdfb;padding:8px 10px;border-radius:8px;border:1px solid var(--brl);white-space:pre-wrap;max-height:140px;overflow-y:auto;margin-bottom:8px;">' +
            util.esc(p.text || '') +
          '</div>';

      if (isResolved) {
        html += '<div style="font-size:11px;color:#15803d;display:flex;align-items:center;gap:6px;">' +
          '<re-icon icon="check" size="12"></re-icon>' +
          '<span>Resolved by ' + util.esc(p.resolvedBy || 'Administrator') + (p.replyNote ? ' · ' + util.esc(p.replyNote) : '') + '</span>' +
        '</div>';
      } else if (isAdm) {
        html += '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;">' +
          '<button type="button" class="btn-out" data-action="open-admin-grievances" style="font-size:11px;padding:4px 10px;color:#991b1b;border-color:#fca5a5;">' +
            '<span>Inspect &amp; Resolve</span>' +
          '</button>' +
        '</div>';
      }

      html += '</div></div>';
      return html;
    },
    bind: function (el, ctx) {}
  });

  // 6. SUDO REVIEW CARD
  registerCard('sudo-review', {
    key: function (ctx) {
      var b = ctx.batch || {};
      var app = b.sudoInitialApproval || b.initialApproval || {};
      return [b.status, app.approved ? 'approved' : '', b.rejection ? b.rejection.reason : ''].join('|');
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var user = ctx.user;
      var isSudo = typeof root.isSudoAdmin === 'function' ? root.isSudoAdmin(user) : (user && (user.role === 'sudo' || (user.role === 'admin' && user.adminFlag !== 'subadmin')));
      var isRejected = batch.status === 'rejected';
      var isApproved = !isRejected && (['sudo_initial_approved', 'verifying', 'verified_all', 'pending_final_approval', 'committing', 'committed'].includes(batch.status) || Boolean(batch.sudoInitialApproval && batch.sudoInitialApproval.approved));

      var html = '<div class="card-frame">' +
        '<div class="card-header">' +
          '<div class="card-title">' +
            '<re-icon icon="shield-alert" size="16"></re-icon>' +
            '<span>Step 2: Sudo Administrator Initial Approval</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--tmu);">' + (isRejected ? 'Rejected' : (isApproved ? 'Approved' : 'Action Required')) + '</div>' +
        '</div>' +
        '<div class="card-body">';

      if (isRejected) {
        var rej = batch.rejection || batch.initialApproval || {};
        html += '<div style="display:flex;align-items:center;gap:10px;color:#dc2626;font-size:13px;font-weight:600;">' +
          '<re-icon icon="x-circle" size="20"></re-icon>' +
          '<span>Import request rejected by ' + util.esc(rej.by || 'Sudo Administrator') + '</span>' +
        '</div>';
      } else if (isApproved) {
        var app = batch.sudoInitialApproval || batch.initialApproval || {};
        html += '<div style="display:flex;align-items:center;gap:10px;color:var(--gD);font-size:13px;font-weight:600;">' +
          '<re-icon icon="check-circle-2" size="20"></re-icon>' +
          '<span>Initial approval granted by ' + util.esc(app.approvedBy || 'Sudo Administrator') + '</span>' +
        '</div>';
      } else if (isSudo) {
        html += '<div style="font-size:13px;color:var(--td);margin-bottom:14px;">' +
          'As Sudo Administrator, please review the ' + (batch.eligibleCount || 0) + ' staged records and approve proceeding to verification.' +
        '</div>' +
        '<div style="display:flex;gap:10px;">' +
          '<button type="button" class="btn-replace" style="padding:10px 20px;font-size:12.5px;background:var(--gB);" data-action="approve-initial">' +
            '<re-icon icon="check" size="14"></re-icon> Approve Import Request' +
          '</button>' +
          '<button type="button" class="btn-out" style="padding:10px 16px;font-size:12.5px;color:#dc2626;border-color:#fca5a5;" data-action="reject-initial">' +
            '<re-icon icon="x" size="14"></re-icon> Reject…' +
          '</button>' +
        '</div>';
      } else {
        html += '<div style="display:flex;align-items:center;gap:12px;background:#fffbeb;padding:12px 16px;border-radius:12px;border:1px solid #fde68a;">' +
          '<re-icon icon="clock" size="20" style="color:#d97706;"></re-icon>' +
          '<div>' +
            '<div style="font-size:13px;font-weight:700;color:#92400e;">Awaiting Sudo Administrator Review</div>' +
            '<div style="font-size:11.5px;color:#b45309;margin-top:2px;">The import request has been submitted to Sudo Administrator for authorization.</div>' +
          '</div>' +
        '</div>';
      }

      html += '</div></div>';
      return html;
    },
    bind: function (el, ctx) {
      var batchId = ctx.batch._id;
      el.addEventListener('click', function (e) {
        var appBtn = e.target.closest('[data-action="approve-initial"]');
        if (appBtn) {
          appBtn.disabled = true;
          api.approveInitial(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Initial approval granted');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            appBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
          });
          return;
        }

        var rejBtn = e.target.closest('[data-action="reject-initial"]');
        if (rejBtn) {
          Promise.resolve(prompt('Please enter rejection reason:')).then(function (reason) {
            if (!reason || !String(reason).trim()) return;
            var cleanReason = String(reason).trim();
            rejBtn.disabled = true;
            api.rejectInitial(batchId, cleanReason).then(function () {
              if (typeof root.showToast === 'function') root.showToast('Import request rejected');
              if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
            }).catch(function (err) {
              rejBtn.disabled = false;
              if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
            });
          });
          return;
        }
      });
    }
  });

  // 7. VERIFY CARD
  registerCard('verify', {
    key: function (ctx) {
      var b = ctx.batch || {};
      var verCount = 0;
      var rows = b.eligibleRows || [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].isVerified) verCount++;
      }
      return [b.status, verCount, b.eligibleCount].join('|');
    },
    mode: function (ctx) {
      if (typeof root.Bulk.cardMode === 'function') {
        return root.Bulk.cardMode('verify', ctx.batch);
      }
      return 'open';
    },
    update: function (el, ctx) {
      if (typeof this.mode === 'function') {
        el.dataset.mode = this.mode(ctx);
      }
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var type = batch.type;

      var total = batch.eligibleCount || (batch.eligibleRows ? batch.eligibleRows.length : 0);
      var verifiedCount = 0;
      var rows = batch.eligibleRows || [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].isVerified) verifiedCount++;
      }
      var pct = total > 0 ? Math.round((verifiedCount / total) * 100) : 0;
      var isAllVerified = verifiedCount >= total && total > 0;
      var caps = root.Bulk.caps || (store.getState() && store.getState().caps) || {};
      var isDev = Boolean(caps.isDev || (caps.flags && caps.flags.isDev));

      var stepTitle = (type === 'student' || type === 'teacher')
        ? 'Step 3: Verification &amp; Credential Dispatch'
        : 'Step 3: Verification &amp; Details Review';

      var html = '<div class="card-frame">' +
        '<div class="card-header">' +
          '<div class="card-title">' +
            '<re-icon icon="user-check" size="16"></re-icon>' +
            '<span>' + stepTitle + '</span>' +
          '</div>' +
          '<div style="font-size:11px;font-weight:700;color:var(--gD);">' + verifiedCount + ' / ' + total + ' Verified (' + pct + '%)</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div style="margin-bottom:14px;">' +
            '<div class="prog-bar-track" style="height:10px;">' +
              '<div class="prog-bar-fill" style="width:' + pct + '%;"></div>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">' +
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">';

      if (!isAllVerified) {
        html += '<button type="button" class="btn-replace" style="padding:10px 20px;font-size:12.5px;background:var(--w-teal,#00a884);" data-action="start-verifying">' +
          '<re-icon icon="check" size="14"></re-icon> Start verifying &rarr;' +
        '</button>' +
        '<button type="button" class="btn-out" style="padding:10px 18px;font-size:12.5px;" data-action="open-drawer">' +
          '<re-icon icon="table" size="14"></re-icon> Open Overview (' + (total - verifiedCount) + ' remaining)' +
        '</button>';
      } else {
        html += '<button type="button" class="btn-out" style="padding:10px 18px;font-size:12.5px;" data-action="open-drawer">' +
          '<re-icon icon="table" size="14"></re-icon> Review Verified Records (' + total + ')' +
        '</button>';

        var isSudo = typeof root.isSudoAdmin === 'function' ? root.isSudoAdmin(ctx.user) : (ctx.user && (ctx.user.role === 'sudo' || (ctx.user.role === 'admin' && ctx.user.adminFlag !== 'subadmin')));
        if (isSudo) {
          html += '<button type="button" class="btn-replace" style="padding:10px 20px;font-size:12.5px;background:var(--gD);" data-action="approve-commit">' +
            '<re-icon icon="check" size="14"></re-icon> Commit Records to Database' +
          '</button>';
        } else {
          html += '<button type="button" class="btn-replace" style="padding:10px 20px;font-size:12.5px;background:var(--gB);" data-action="submit-final">' +
            '<re-icon icon="arrow-right" size="14"></re-icon> Submit for Final Approval' +
          '</button>';
        }
      }

      html += '</div>';

      if (isDev && !isAllVerified) {
        html += '<div style="margin-left:auto;">' +
          '<button type="button" class="btn-out" style="padding:10px 14px;font-size:11.5px;color:var(--w-accent-dark,#d97706);border-color:currentColor;" data-action="dev-verify-all" title="Development only testing shortcut">' +
            '<re-icon icon="zap" size="12"></re-icon> DEV &middot; Verify all (testing only)' +
          '</button>' +
        '</div>';
      }

      html += '</div></div></div>';
      return html;
    },
    bind: function (el, ctx) {
      var batchId = ctx.batch._id;
      el.addEventListener('click', function (e) {
        var startBtn = e.target.closest('[data-action="start-verifying"]');
        if (startBtn) {
          var batch = (store.getState && store.getState().batch) || ctx.batch;
          var firstUnverified = (batch.eligibleRows || []).find(function (r) { return !r.isVerified; });
          if (firstUnverified && typeof root.Bulk.openVerifyEditModal === 'function') {
            root.Bulk.openVerifyEditModal(firstUnverified.rowNumber);
          } else if (typeof root.showToast === 'function') {
            root.showToast('All records already verified');
          }
          return;
        }

        var drawerBtn = e.target.closest('[data-action="open-drawer"]');
        if (drawerBtn) {
          store.setState({ drawerOpen: true });
          return;
        }

        var devVerifyAllBtn = e.target.closest('[data-action="dev-verify-all"]');
        if (devVerifyAllBtn) {
          e.preventDefault();
          var confFn = (typeof root.Bulk?.util?.safeConfirm === 'function') ? root.Bulk.util.safeConfirm :
                       (typeof root.confirmModal === 'function') ? root.confirmModal : window.confirm;
          Promise.resolve(confFn('DEV: Verify all remaining entries without sending emails?')).then(function (ok) {
            if (!ok) return;
            devVerifyAllBtn.disabled = true;
            api.verifyAll(batchId).then(function () {
              if (typeof root.showToast === 'function') root.showToast('DEV: All records verified successfully');
              if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
            }).catch(function (err) {
              devVerifyAllBtn.disabled = false;
              if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
            });
          });
          return;
        }

        var submitFinalBtn = e.target.closest('[data-action="submit-final"]');
        if (submitFinalBtn) {
          submitFinalBtn.disabled = true;
          api.submitFinal(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Submitted for final approval');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            submitFinalBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
          });
          return;
        }

        var commitBtn = e.target.closest('[data-action="approve-commit"]');
        if (commitBtn) {
          commitBtn.disabled = true;
          api.approveFinal(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Batch commit initiated');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            commitBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
          });
          return;
        }
      });
    }
  });

  // 7.5 ADMIN REVIEW CARD (P6, §6.14)
  registerCard('review', {
    key: function (ctx) {
      var b = ctx.batch || {};
      var changesCount = (b.reviewChanges && b.reviewChanges.length) || 0;
      var removedCount = (b.removedRows && b.removedRows.length) || 0;
      return [b.status, b.eligibleCount, changesCount, removedCount].join('|');
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var user = ctx.user;
      var isSudo = typeof root.isSudoAdmin === 'function' ? root.isSudoAdmin(user) : (user && (user.role === 'sudo' || (user.role === 'admin' && user.adminFlag !== 'subadmin')));
      var eligible = batch.eligibleCount || 0;
      var changes = batch.reviewChanges || [];
      var editsCount = changes.filter(function (c) { return c.action === 'edit'; }).length;
      var removedCount = (batch.removedRows && batch.removedRows.length) || 0;
      var rows = batch.eligibleRows || [];
      var typeMeta = config.TYPES[batch.type] || { label: batch.type || 'Records', singular: 'Record' };

      var html = '<div class="card-frame" style="border-color:#bbf7d0;">' +
        '<div class="card-header" style="background:#f0fdf4;">' +
          '<div class="card-title" style="color:#15803d;">' +
            '<re-icon icon="shield-check" size="18"></re-icon>' +
            '<span>Step 3½: Admin Review</span>' +
          '</div>' +
          '<div style="font-size:11.5px;color:var(--tmu);font-weight:600;">' +
            eligible + ' records · ' + editsCount + ' edits · ' + removedCount + ' removed' +
          '</div>' +
        '</div>';

      if (!isSudo) {
        html += '<div class="card-body" style="padding:20px;">' +
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">' +
            '<div class="chat-status-pill st-pending">Waiting for admin review</div>' +
          '</div>' +
          '<div style="font-size:13.5px;color:var(--td);line-height:1.5;">' +
            'All <strong>' + eligible + ' records</strong> have been verified. An administrator is now reviewing the verified records before final approval.' +
          '</div>' +
        '</div></div>';
        return html;
      }

      // Sudo view: 4 Tabs
      html += '<div class="review-tabs">' +
        '<button type="button" class="review-tab-btn active" data-tab="overview">Overview</button>' +
        '<button type="button" class="review-tab-btn" data-tab="records">Records (' + eligible + ')</button>' +
        '<button type="button" class="review-tab-btn" data-tab="fields">Fields written</button>' +
        '<button type="button" class="review-tab-btn" data-tab="changes">Changes (' + changes.length + ')</button>' +
      '</div>';

      // Panel 1: Overview
      html += '<div class="review-tab-panel active" data-panel="overview">' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:12px;margin-bottom:16px;">' +
          '<div style="background:#f8faf8;padding:12px;border-radius:10px;border:1px solid var(--brl);">' +
            '<div style="font-size:11px;color:var(--tmu);text-transform:uppercase;font-weight:600;">Target Collection</div>' +
            '<div style="font-size:15px;font-weight:700;color:var(--td);margin-top:2px;">' + util.esc(typeMeta.label) + '</div>' +
            '<div style="font-size:11px;color:var(--ts);margin-top:2px;">Will create ' + eligible + ' ' + util.esc(typeMeta.singular) + (['student', 'teacher'].includes(batch.type) ? (' + ' + eligible + ' User') : '') + ' accounts</div>' +
          '</div>' +
          '<div style="background:#f8faf8;padding:12px;border-radius:10px;border:1px solid var(--brl);">' +
            '<div style="font-size:11px;color:var(--tmu);text-transform:uppercase;font-weight:600;">Review Modifications</div>' +
            '<div style="font-size:15px;font-weight:700;color:var(--td);margin-top:2px;">' + editsCount + ' Edits · ' + removedCount + ' Removed</div>' +
            '<div style="font-size:11px;color:var(--ts);margin-top:2px;">Every change tracked with audit log</div>' +
          '</div>' +
          '<div style="background:#f8faf8;padding:12px;border-radius:10px;border:1px solid var(--brl);">' +
            '<div style="font-size:11px;color:var(--tmu);text-transform:uppercase;font-weight:600;">Google Drive Backup</div>' +
            '<div style="font-size:15px;font-weight:700;color:var(--td);margin-top:2px;">' + (batch.drive?.folderId ? 'Folder Provisioned' : 'Local Archive') + '</div>' +
            '<div style="font-size:11px;color:var(--ts);margin-top:2px;">' + util.esc(batch.drive?.folderName || (batch.batchTrackId || '')) + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:12.5px;color:var(--ts);line-height:1.5;">' +
          'Verify all records and columns below. You can edit individual records, remove duplicates/invalids, or bulk-clear optional columns before giving final approval.' +
        '</div>' +
      '</div>';

      // Panel 2: Records
      html += '<div class="review-tab-panel" data-panel="records">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">' +
          '<div style="display:flex;gap:6px;">' +
            '<button type="button" class="btn-out active" data-filter="all" style="padding:4px 10px;font-size:11px;">All (' + eligible + ')</button>' +
            '<button type="button" class="btn-out" data-filter="edited" style="padding:4px 10px;font-size:11px;">Edited (' + editsCount + ')</button>' +
            '<button type="button" class="btn-out" data-filter="mailed" style="padding:4px 10px;font-size:11px;">Mailed (' + rows.filter(function(r){ return r.emailSent; }).length + ')</button>' +
          '</div>' +
          '<input type="text" id="review-records-search" placeholder="Search rows…" style="padding:4px 10px;border-radius:6px;border:1px solid var(--brl);font-size:11.5px;max-width:180px;">' +
        '</div>' +
        '<div style="max-height:280px;overflow-y:auto;border:1px solid var(--brl);border-radius:8px;">';
      var col2H = 'Identifier / Name';
      var col3H = 'Department / Detail';
      var col4H = 'Mail Status';
      if (batch.type === 'class') {
        col2H = 'Class Name';
        col3H = 'Department & Batch';
        col4H = 'Semester & Hall';
      } else if (batch.type === 'dept') {
        col2H = 'Department Name';
        col3H = 'Code & Branch';
        col4H = 'Course & Category';
      } else if (batch.type === 'subject') {
        col2H = 'Subject Name';
        col3H = 'Code & Department';
        col4H = 'Semester & Credits';
      }

      html += '<table style="width:100%;border-collapse:collapse;font-size:11.5px;" id="review-records-table">' +
            '<thead style="background:#fafbfa;position:sticky;top:0;z-index:2;border-bottom:1px solid var(--brl);">' +
              '<tr>' +
                '<th style="padding:6px 10px;text-align:left;">Row</th>' +
                '<th style="padding:6px 10px;text-align:left;">' + col2H + '</th>' +
                '<th style="padding:6px 10px;text-align:left;">' + col3H + '</th>' +
                '<th style="padding:6px 10px;text-align:left;">' + col4H + '</th>' +
                '<th style="padding:6px 10px;text-align:right;">Actions</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>';

      var displayRows = rows.slice(0, 100);
      for (var ri = 0; ri < displayRows.length; ri++) {
        var r = displayRows[ri];
        var d = r.data || {};
        var isMailed = Boolean(r.emailSent || (r.mail && r.mail.mode === 'sent'));
        var isEdited = changes.some(function(c){ return c.rowNumber === r.rowNumber; });

        var c2Html = '', c3Html = '', c4Html = '';
        if (batch.type === 'class') {
          var cName = d.name || d.className || ('Class Row ' + r.rowNumber);
          c2Html = '<div style="font-weight:600;color:var(--td);">' + util.esc(cName) + '</div>' +
                   (d.advisor ? ('<div style="font-size:10.5px;color:var(--ts);">Adv: ' + util.esc(d.advisor) + '</div>') : '');
          c3Html = util.esc((d.department || d.deptName || d.deptCode || '—') + (d.batch ? (' · ' + d.batch) : ''));
          c4Html = util.esc((d.sem || d.semester ? ('Sem ' + (d.sem || d.semester)) : '') + (d.hallNo ? (' · ' + d.hallNo) : '—'));
        } else if (batch.type === 'dept') {
          c2Html = '<div style="font-weight:600;color:var(--td);">' + util.esc(d.name || ('Dept Row ' + r.rowNumber)) + '</div>' +
                   '<div style="font-size:10.5px;color:var(--ts);font-family:monospace;">Code: ' + util.esc(d.code || '—') + '</div>';
          c3Html = util.esc((d.courseType || 'UG') + ' · ' + (d.branch || 'B.E'));
          c4Html = util.esc((d.category || 'programme') + (d.number ? (' · ' + d.number) : ''));
        } else if (batch.type === 'subject') {
          c2Html = '<div style="font-weight:600;color:var(--td);">' + util.esc(d.name || ('Subject Row ' + r.rowNumber)) + '</div>';
          c3Html = util.esc((d.code || '—') + ' · ' + (d.department || d.deptName || '—'));
          c4Html = util.esc((d.sem ? ('Sem ' + d.sem) : '') + (d.credits ? (' · ' + d.credits + ' cr') : '—'));
        } else {
          var ident = d.registerNo || d.employeeNo || d.code || d.username || ('Row ' + r.rowNumber);
          var name = d.fullName || d.name || ident;
          var dept = d.deptCode || d.department || d.deptName || d.branch || '—';
          c2Html = '<div style="font-weight:600;color:var(--td);">' + util.esc(name) + '</div>' +
                   '<div style="font-size:10.5px;color:var(--ts);">' + util.esc(ident) + (isEdited ? ' <span style="color:#d97706;">(Edited)</span>' : '') + '</div>';
          c3Html = util.esc(dept);
          c4Html = isMailed ? '<span class="chat-status-pill st-done" style="font-size:10px;padding:2px 6px;">Mailed</span>' : '<span style="color:var(--tmu);font-size:10.5px;">Pending</span>';
        }

        html += '<tr style="border-bottom:1px solid var(--brl);" data-row="' + r.rowNumber + '" data-mailed="' + isMailed + '" data-edited="' + isEdited + '">' +
          '<td style="padding:6px 10px;font-weight:600;color:var(--tmu);">' + r.rowNumber + '</td>' +
          '<td style="padding:6px 10px;">' + c2Html + '</td>' +
          '<td style="padding:6px 10px;color:var(--ts);">' + c3Html + '</td>' +
          '<td style="padding:6px 10px;">' + c4Html + '</td>' +
          '<td style="padding:6px 10px;text-align:right;">' +
            '<div class="review-row-actions" style="justify-content:flex-end;">' +
              '<button type="button" class="review-action-btn" data-action="review-edit-row" data-row="' + r.rowNumber + '" title="Edit record"><re-icon icon="edit-2" size="12"></re-icon> Edit</button>' +
              '<button type="button" class="review-action-btn" data-action="review-remove-row" data-row="' + r.rowNumber + '" ' + (isMailed ? 'disabled title="Row credentials already emailed; cannot be removed"' : 'title="Remove record"') + '><re-icon icon="trash-2" size="12"></re-icon> Remove</button>' +
            '</div>' +
          '</td>' +
        '</tr>';
      }

      if (displayRows.length === 0) {
        html += '<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--tmu);">No records found.</td></tr>';
      }

      html += '</tbody></table></div>' +
        (rows.length > 100 ? ('<div style="font-size:11px;color:var(--tmu);margin-top:6px;text-align:right;">Showing first 100 of ' + rows.length + ' records</div>') : '') +
      '</div>';

      // Panel 3: Fields written
      html += '<div class="review-tab-panel" data-panel="fields">' +
        '<div style="border:1px solid var(--brl);border-radius:8px;overflow:hidden;">' +
          '<table style="width:100%;border-collapse:collapse;font-size:11.5px;">' +
            '<thead style="background:#fafbfa;border-bottom:1px solid var(--brl);">' +
              '<tr>' +
                '<th style="padding:6px 10px;text-align:left;">Field</th>' +
                '<th style="padding:6px 10px;text-align:left;">Source</th>' +
                '<th style="padding:6px 10px;text-align:left;">Sample Value</th>' +
                '<th style="padding:6px 10px;text-align:left;">Status</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>';

      var sampleRow = (rows[0] && rows[0].data) || {};
      var sampleFields = Object.keys(sampleRow).filter(function(k){ return k !== 'password'; });
      var systemKeys = ['trackId', 'username', 'mustChangePassword', 'deptId', 'classId'];

      for (var f = 0; f < sampleFields.length; f++) {
        var k = sampleFields[f];
        var isSys = systemKeys.includes(k);
        html += '<tr style="border-bottom:1px solid var(--brl);">' +
          '<td style="padding:6px 10px;font-weight:600;"><code>' + util.esc(k) + '</code></td>' +
          '<td style="padding:6px 10px;color:var(--ts);">' + (isSys ? 'System generated' : 'Uploaded sheet, normalized') + '</td>' +
          '<td style="padding:6px 10px;color:var(--td);">' + util.esc(String(sampleRow[k] || '—')) + '</td>' +
          '<td style="padding:6px 10px;">' + (isSys ? '<span class="chat-status-pill st-staged" style="font-size:9.5px;padding:1px 5px;">NEW</span>' : '<span style="color:var(--tmu);font-size:10px;">Mapped</span>') + '</td>' +
        '</tr>';
      }

      html += '</tbody></table></div></div>';

      // Panel 4: Changes
      html += '<div class="review-tab-panel" data-panel="changes">';
      if (changes.length === 0) {
        html += '<div style="padding:24px;text-align:center;color:var(--tmu);font-size:12px;">No admin edits or removals have been made yet.</div>';
      } else {
        html += '<div style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;">';
        var revChanges = changes.slice().reverse();
        for (var ci = 0; ci < revChanges.length; ci++) {
          var ch = revChanges[ci];
          var actColor = ch.action === 'remove' ? '#ef4444' : (ch.action === 'clear' ? '#f59e0b' : '#3b82f6');
          var timeStr = ch.at ? new Date(ch.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

          html += '<div style="background:#f8faf8;padding:8px 12px;border-radius:8px;border:1px solid var(--brl);font-size:12px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">' +
              '<span style="font-weight:700;color:' + actColor + ';text-transform:uppercase;font-size:10.5px;">' + util.esc(ch.action) + '</span>' +
              '<span style="font-size:10.5px;color:var(--tmu);">' + util.esc(timeStr) + '</span>' +
            '</div>' +
            '<div style="color:var(--td);">' +
              (ch.action === 'edit' ? ('Edited row ' + ch.rowNumber + ' · ' + util.esc(ch.field) + ': ' + util.esc(String(ch.oldValue || 'none')) + ' → ' + util.esc(String(ch.newValue))) :
               (ch.action === 'remove' ? ('Removed row ' + ch.rowNumber + ' · Reason: ' + util.esc(ch.reason)) :
               ('Cleared optional field ' + util.esc(ch.field) + ' on ' + (ch.affectedCount || 0) + ' records'))) +
            '</div>' +
            '<div style="font-size:10.5px;color:var(--tmu);margin-top:2px;">By ' + util.esc(ch.by || 'Sudo Admin') + '</div>' +
          '</div>';
        }
        html += '</div>';
      }
      html += '</div>';

      // Footer with Clear Optional Field dropdown and Continue button
      var optionalFields = [];
      if (batch.type === 'student') optionalFields = [{ key: 'gender', label: 'Gender' }, { key: 'residency', label: 'Residency' }];
      else if (batch.type === 'teacher') optionalFields = [{ key: 'designation', label: 'Designation' }, { key: 'gender', label: 'Gender' }];
      else if (batch.type === 'dept') optionalFields = [{ key: 'number', label: 'Phone Number' }, { key: 'branch', label: 'Branch' }];
      else if (batch.type === 'class') optionalFields = [{ key: 'hallNo', label: 'Hall Number' }];
      else if (batch.type === 'subject') optionalFields = [{ key: 'credits', label: 'Credits' }];

      html += '<div class="review-footer">' +
        '<div style="display:flex;align-items:center;gap:8px;">';

      if (optionalFields.length > 0) {
        html += '<select id="review-clear-field-select" style="padding:6px 10px;border-radius:6px;border:1px solid var(--brl);font-size:11.5px;background:#fff;">' +
          '<option value="">— Clear optional field —</option>' +
          optionalFields.map(function(opt){ return '<option value="' + util.esc(opt.key) + '">' + util.esc(opt.label) + '</option>'; }).join('') +
        '</select>' +
        '<button type="button" class="btn-out" data-action="review-clear-field" style="padding:6px 12px;font-size:11.5px;"><re-icon icon="eraser" size="13"></re-icon> Clear</button>';
      }

      html += '</div>' +
        '<button type="button" class="btn-replace" data-action="review-confirm" style="padding:8px 18px;font-size:12.5px;background:var(--gD);">' +
          '<re-icon icon="check" size="14"></re-icon> Checked — continue to Final Approval' +
        '</button>' +
      '</div></div>';

      return html;
    },
    bind: function (el, ctx) {
      var batchId = ctx.batch._id;

      // Tab switching
      el.querySelectorAll('.review-tab-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          el.querySelectorAll('.review-tab-btn').forEach(function (b) { b.classList.remove('active'); });
          el.querySelectorAll('.review-tab-panel').forEach(function (p) { p.classList.remove('active'); });
          btn.classList.add('active');
          var tabName = btn.getAttribute('data-tab');
          var targetPanel = el.querySelector('.review-tab-panel[data-panel="' + tabName + '"]');
          if (targetPanel) targetPanel.classList.add('active');
        });
      });

      // Filter chips in Records tab
      el.querySelectorAll('[data-filter]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          el.querySelectorAll('[data-filter]').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          var filter = btn.getAttribute('data-filter');
          var trs = el.querySelectorAll('#review-records-table tbody tr');
          trs.forEach(function (tr) {
            if (filter === 'all') tr.style.display = '';
            else if (filter === 'edited') tr.style.display = tr.getAttribute('data-edited') === 'true' ? '' : 'none';
            else if (filter === 'mailed') tr.style.display = tr.getAttribute('data-mailed') === 'true' ? '' : 'none';
          });
        });
      });

      // Search input in Records tab
      var searchInput = el.querySelector('#review-records-search');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          var q = searchInput.value.toLowerCase().trim();
          var trs = el.querySelectorAll('#review-records-table tbody tr');
          trs.forEach(function (tr) {
            tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
          });
        });
      }

      // Actions delegator
      el.addEventListener('click', function (e) {
        // Edit Row
        var editBtn = e.target.closest('[data-action="review-edit-row"]');
        if (editBtn) {
          var rowNum = parseInt(editBtn.getAttribute('data-row'), 10);
          if (typeof root.Bulk.openVerifyEditModal === 'function') {
            root.Bulk.openVerifyEditModal(rowNum, { mode: 'admin-edit' });
          }
          return;
        }

        // Remove Row
        var removeBtn = e.target.closest('[data-action="review-remove-row"]');
        if (removeBtn) {
          var rowNumRem = parseInt(removeBtn.getAttribute('data-row'), 10);
          var reason = window.prompt('Enter reason for removing row ' + rowNumRem + ':');
          if (!reason || reason.trim().length < 3) {
            if (reason !== null && typeof root.showToast === 'function') {
              root.showToast('A reason of at least 3 characters is required', 'warn');
            }
            return;
          }
          removeBtn.disabled = true;
          api.removeReviewRow(batchId, rowNumRem, reason.trim()).then(function (res) {
            if (typeof root.showToast === 'function') root.showToast('Row ' + rowNumRem + ' removed');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            removeBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
          });
          return;
        }

        // Clear Optional Field
        var clearBtn = e.target.closest('[data-action="review-clear-field"]');
        if (clearBtn) {
          var sel = el.querySelector('#review-clear-field-select');
          var fieldToClear = sel ? sel.value : '';
          if (!fieldToClear) {
            if (typeof root.showToast === 'function') root.showToast('Please select a field to clear', 'warn');
            return;
          }
          var confFn = (typeof root.Bulk?.util?.safeConfirm === 'function') ? root.Bulk.util.safeConfirm :
                       (typeof root.confirmModal === 'function') ? root.confirmModal : window.confirm;
          Promise.resolve(confFn('Are you sure you want to blank field "' + fieldToClear + '" across all eligible records?')).then(function (ok) {
            if (!ok) return;
            clearBtn.disabled = true;
            api.clearReviewField(batchId, fieldToClear).then(function (res) {
              if (typeof root.showToast === 'function') root.showToast('Cleared ' + fieldToClear + ' on ' + res.data.affectedCount + ' records');
              if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
            }).catch(function (err) {
              clearBtn.disabled = false;
              if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
            });
          });
          return;
        }

        // Confirm Review
        var confirmBtn = e.target.closest('[data-action="review-confirm"]');
        if (confirmBtn) {
          confirmBtn.disabled = true;
          api.confirmReview(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Admin review confirmed');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            confirmBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
          });
        }
      });
    }
  });

  // 8. FINAL APPROVAL & COMMIT CARD (P6, §6.15)
  registerCard('final', {
    key: function (ctx) {
      var b = ctx.batch || {};
      return [b.status, b.eligibleCount, b.finalApproval ? b.finalApproval.status : '', (b.reviewChanges && b.reviewChanges.length) || 0].join('|');
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var user = ctx.user;
      var isSudo = typeof root.isSudoAdmin === 'function' ? root.isSudoAdmin(user) : (user && (user.role === 'sudo' || (user.role === 'admin' && user.adminFlag !== 'subadmin')));
      var isCommitted = batch.status === 'committed';
      var isCommitting = batch.status === 'committing';
      var isPendingFinal = batch.status === 'pending_final_approval';
      var isVerifiedAll = batch.status === 'verified_all';
      var eligible = batch.eligibleCount || 0;
      var ownerName = (batch.uploadedBy && batch.uploadedBy.name) ? batch.uploadedBy.name : 'Uploader';
      var editsCount = (batch.reviewChanges || []).filter(function(c){ return c.action === 'edit'; }).length;
      var removedCount = (batch.removedRows && batch.removedRows.length) || 0;
      var openGrievances = (batch.grievance && batch.grievance.open) || 0;
      var driveFolderUrl = batch.drive && batch.drive.folderUrl;
      var trackId = batch.batchTrackId || batch._id;

      var html = '<div class="card-frame" style="border-color:#bbf7d0;">' +
        '<div class="card-header" style="background:#f0fdf4;">' +
          '<div class="card-title" style="color:#15803d;">' +
            '<re-icon icon="database" size="18"></re-icon>' +
            '<span>Step 4: Final Approval &amp; Database Commit</span>' +
          '</div>' +
          '<div style="font-size:11.5px;color:var(--tmu);font-weight:600;">' +
            (isCommitted ? 'Committed' : (eligible + ' records ready')) +
          '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div style="background:#f8faf8;padding:12px 16px;border-radius:12px;border:1px solid var(--brl);margin-bottom:16px;font-size:12px;">' +
            '<div style="font-weight:700;color:var(--td);margin-bottom:8px;">Pre-Flight Execution Summary</div>' +
            '<div style="display:flex;flex-direction:column;gap:5px;color:var(--td);">' +
              '<div>✓ <strong>' + eligible + ' records</strong> validated and ready to commit</div>' +
              '<div>✓ <strong>' + editsCount + ' admin edits</strong> · <strong>' + removedCount + ' rows removed</strong></div>' +
              (openGrievances > 0 ? ('<div style="color:#b45309;font-weight:600;">⚠ ' + openGrievances + ' open grievance(s) reported on this batch</div>') : '') +
              '<div>✓ Google Drive cryptographic ZIP backup enabled (' + util.esc(trackId) + '_ARCHIVE.zip)</div>' +
              (driveFolderUrl ? ('<div>✓ Drive Folder: <a href="' + util.esc(driveFolderUrl) + '" target="_blank" style="color:var(--gD);font-weight:600;text-decoration:none;">' + util.esc(trackId) + '</a></div>') : '') +
            '</div>' +
            '<div style="font-size:11px;color:var(--ts);margin-top:8px;padding-top:6px;border-top:1px solid var(--brl);">' +
              'This will write ' + eligible + ' records · archive encrypted backup to Google Drive · log the action · close this chat · notify ' + util.esc(ownerName) + '.' +
            '</div>' +
          '</div>';

      if (isCommitted) {
        html += '<div style="display:flex;align-items:center;gap:10px;color:var(--gD);font-size:13px;font-weight:600;">' +
          '<re-icon icon="check-circle-2" size="20"></re-icon>' +
          '<span>Batch records have already been committed to the database.</span>' +
        '</div>';
      } else if (isCommitting) {
        html += '<div style="display:flex;align-items:center;gap:10px;color:#0284c7;font-size:13px;font-weight:600;">' +
          '<re-icon icon="refresh-cw" size="18" class="spin"></re-icon>' +
          '<span>Database commit is in progress…</span>' +
        '</div>';
      } else if (isSudo) {
        html += '<div style="margin-bottom:12px;">' +
          '<textarea id="final-approval-notes" placeholder="Optional notes or commentary for this approval…" style="width:100%;height:60px;padding:8px 12px;border-radius:8px;border:1px solid var(--brl);font-size:12px;box-sizing:border-box;"></textarea>' +
        '</div>' +
        '<div style="display:flex;gap:10px;align-items:center;">' +
          '<button type="button" class="btn-replace" style="padding:10px 20px;font-size:13px;background:var(--gD);" data-action="approve-commit">' +
            '<re-icon icon="database" size="15"></re-icon> Approve &amp; Commit Records' +
          '</button>' +
          '<button type="button" class="btn-out" style="padding:10px 16px;font-size:13px;color:#ef4444;border-color:#fca5a5;" data-action="reject-batch">' +
            '<re-icon icon="x-circle" size="14"></re-icon> Reject…' +
          '</button>' +
        '</div>';
      } else if (isPendingFinal) {
        html += '<div style="display:flex;align-items:center;gap:10px;background:#fffbeb;padding:12px 16px;border-radius:12px;border:1px solid #fde68a;">' +
          '<re-icon icon="clock" size="20" style="color:#d97706;"></re-icon>' +
          '<div>' +
            '<div style="font-size:13px;font-weight:700;color:#92400e;">Submitted for Final Sudo Admin Approval</div>' +
            '<div style="font-size:11.5px;color:#b45309;margin-top:2px;">Sudo administrator will execute final database commit.</div>' +
          '</div>' +
        '</div>';
      } else if (isVerifiedAll) {
        html += '<button type="button" class="btn-replace" style="padding:12px 24px;font-size:13px;background:var(--gB);" data-action="submit-final">' +
          '<re-icon icon="send" size="14"></re-icon> Submit for Final Sudo Admin Approval' +
        '</button>';
      }

      html += '</div></div>';
      return html;
    },
    bind: function (el, ctx) {
      var batchId = ctx.batch._id;
      el.addEventListener('click', function (e) {
        var subBtn = e.target.closest('[data-action="submit-final"]');
        if (subBtn) {
          subBtn.disabled = true;
          api.submitFinal(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Submitted for Final Sudo Approval');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            subBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
          });
          return;
        }

        var commitBtn = e.target.closest('[data-action="approve-commit"]');
        if (commitBtn) {
          var confFn = (typeof root.Bulk?.util?.safeConfirm === 'function') ? root.Bulk.util.safeConfirm :
                       (typeof root.confirmModal === 'function') ? root.confirmModal : window.confirm;
          Promise.resolve(confFn('Execute final database commit? This will write verified records into MongoDB and archive backup to Google Drive.')).then(function (ok) {
            if (!ok) return;
            commitBtn.disabled = true;
            api.approveFinal(batchId).then(function () {
              if (typeof root.showToast === 'function') root.showToast('Database commit initiated');
              if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
            }).catch(function (err) {
              commitBtn.disabled = false;
              if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
            });
          });
          return;
        }

        var rejectBtn = e.target.closest('[data-action="reject-batch"]');
        if (rejectBtn) {
          var reason = window.prompt('Enter reason for rejecting this bulk import (minimum 3 characters):');
          if (!reason || reason.trim().length < 3) {
            if (reason !== null && typeof root.showToast === 'function') {
              root.showToast('A reason of at least 3 characters is required to reject', 'warn');
            }
            return;
          }
          rejectBtn.disabled = true;
          api.rejectInitial(batchId, reason.trim()).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Batch rejected');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            rejectBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
          });
        }
      });
    }
  });

  // 9. COMPLETE CARD
  registerCard('complete', {
    key: function (ctx) {
      var b = ctx.batch || {};
      return [b.status, b.addedCount, b.backup ? b.backup.status : ''].join('|');
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var count = batch.addedCount || batch.eligibleCount || 0;
      var backup = batch.backup || {};
      var drive = batch.drive || {};
      var driveFile = backup.driveWebViewLink || drive.fileUrl;
      var driveFolder = drive.folderUrl;
      var backupFailed = backup.status === 'failed';

      var html = '<div class="card-frame" style="border-color:#bbf7d0;">' +
        '<div class="card-header" style="background:#f0fdf4;">' +
          '<div class="card-title" style="color:#15803d;">' +
            '<re-icon icon="check-circle" size="18"></re-icon>' +
            '<span>Import Complete &amp; Committed to Database</span>' +
          '</div>' +
          '<div class="chat-status-pill status-committed">Live in Database</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div style="font-size:14px;color:var(--td);margin-bottom:16px;">' +
            '<strong>' + count + ' records</strong> have been successfully inserted into MongoDB.' +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px;">' +
            (driveFolder ? ('<a href="' + util.esc(driveFolder) + '" target="_blank" class="btn-out" style="padding:8px 14px;font-size:12px;text-decoration:none;"><re-icon icon="folder" size="14"></re-icon> Google Drive Folder</a>') : '') +
            (driveFile ? ('<a href="' + util.esc(driveFile) + '" target="_blank" class="btn-out" style="padding:8px 14px;font-size:12px;text-decoration:none;"><re-icon icon="hard-drive" size="14"></re-icon> View Backup Archive</a>') : '') +
            (backupFailed ? '<button type="button" class="btn-out" style="padding:8px 14px;font-size:12px;color:#d97706;border-color:#fde68a;" data-action="retry-backup"><re-icon icon="refresh-cw" size="13"></re-icon> Retry Google Drive Backup</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';

      return html;
    },
    bind: function (el, ctx) {
      var batchId = ctx.batch._id;
      el.addEventListener('click', function (e) {
        var retryBtn = e.target.closest('[data-action="retry-backup"]');
        if (retryBtn) {
          retryBtn.disabled = true;
          api.retryBackup(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Backup retried');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            retryBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
          });
        }
      });
    }
  });

  // 10. ERROR & REJECTED CARDS
  registerCard('error', {
    key: function (ctx) {
      var b = ctx.batch || {};
      var err = (b.progress && b.progress.error) || b.error || '';
      return ['error', b.status, err].join('|');
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var errMsg = (batch.progress && batch.progress.error) || batch.error || 'Operation encountered an unexpected error.';

      return '<div class="card-frame" style="border-color:#fecaca;">' +
        '<div class="card-header" style="background:#fef2f2;">' +
          '<div class="card-title" style="color:#b91c1c;">' +
            '<re-icon icon="alert-octagon" size="16"></re-icon>' +
            '<span>Import Job Failed</span>' +
          '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div style="font-size:13px;color:#991b1b;margin-bottom:14px;">' + util.esc(errMsg) + '</div>' +
          '<div style="display:flex;gap:10px;">' +
            '<button type="button" class="btn-replace" style="padding:8px 16px;font-size:12px;background:#dc2626;" data-action="retry-job">' +
              '<re-icon icon="refresh-cw" size="13"></re-icon> Retry Operation' +
            '</button>' +
            '<button type="button" class="btn-out" style="padding:8px 14px;font-size:12px;" data-action="clone-batch">' +
              '<re-icon icon="copy" size="13"></re-icon> Clone as New Draft' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    },
    bind: function (el, ctx) {
      var batchId = ctx.batch._id;
      el.addEventListener('click', function (e) {
        var retryBtn = e.target.closest('[data-action="retry-job"]');
        if (retryBtn) {
          retryBtn.disabled = true;
          api.retryJob(batchId).then(function () {
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            retryBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast('Retry failed: ' + (err.message || err), 'danger');
          });
          return;
        }
        var cloneBtn = e.target.closest('[data-action="clone-batch"]');
        if (cloneBtn) {
          cloneBtn.disabled = true;
          api.cloneBatch(batchId).then(function (res) {
            var b = (res && res.batch) || (res && res.data && res.data.batch);
            if (b && b._id) {
              if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(b._id);
            }
          }).catch(function (err) {
            cloneBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast('Clone failed: ' + (err.message || err), 'danger');
          });
        }
      });
    }
  });

  registerCard('rejected', {
    key: function (ctx) {
      var b = ctx.batch || {};
      var rej = b.rejection || b.initialApproval || {};
      return ['rejected', rej.reason || ''].join('|');
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var rej = batch.rejection || batch.initialApproval || {};
      var reason = rej.reason || 'Import request was declined by Sudo Administrator.';

      return '<div class="card-frame" style="border-color:#fed7aa;">' +
        '<div class="card-header" style="background:#fff7ed;">' +
          '<div class="card-title" style="color:#c2410c;">' +
            '<re-icon icon="x-circle" size="16"></re-icon>' +
            '<span>Import Request Rejected</span>' +
          '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div style="font-size:13px;color:#9a3412;margin-bottom:14px;"><strong>Rejection Note:</strong> ' + util.esc(reason) + '</div>' +
          '<button type="button" class="btn-out" style="padding:8px 16px;font-size:12px;" data-action="clone-batch">' +
            '<re-icon icon="copy" size="13"></re-icon> Clone into New Draft' +
          '</button>' +
        '</div>' +
      '</div>';
    },
    bind: function (el, ctx) {
      var batchId = ctx.batch._id;
      el.addEventListener('click', function (e) {
        var cloneBtn = e.target.closest('[data-action="clone-batch"]');
        if (cloneBtn) {
          cloneBtn.disabled = true;
          api.cloneBatch(batchId).then(function (res) {
            var b = (res && res.batch) || (res && res.data && res.data.batch);
            if (b && b._id) {
              if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(b._id);
            }
          }).catch(function (err) {
            cloneBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast('Clone failed: ' + (err.message || err), 'danger');
          });
        }
      });
    }
  });

  root.Bulk.cards = cards;
  root.Bulk.registerCard = registerCard;
  root.Bulk.downloadTemplate = downloadTemplate;
})(window);
