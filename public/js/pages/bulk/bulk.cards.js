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
  function downloadTemplate(type) {
    var T = {
      dept: {
        headers: ['DeptName', 'Code', 'Number', 'CourseType', 'Branch', 'Category', 'Icon'],
        rows: [
          ['Computer Science Engineering', 'CSE', '104', 'UG', 'B.E', 'Programme', 'laptop'],
          ['Electronics & Communication', 'ECE', '105', 'UG', 'B.E', 'Programme', 'cpu'],
          ['Science & Humanities', 'S&H', '100', 'UG', 'B.E', 'Supportive', 'book-open']
        ],
        notes: [
          ['Column', 'Required?', 'Notes'],
          ['DeptName', 'Yes', 'Full department name. Must be unique.'],
          ['Code', 'Yes', 'Short uppercase code. Must be unique.'],
          ['Number', 'Yes', '3-digit register code e.g. 104'],
          ['CourseType', 'Yes', 'UG or PG (default: UG)'],
          ['Branch', 'Yes', 'B.E, B.TECH, M.E, or M.TECH (default: B.E)'],
          ['Category', 'No', 'Programme or Supportive (default: Programme)'],
          ['Icon', 'No', 'Icon name (default: building2)']
        ]
      },
      teacher: {
        headers: ['Name', 'EmployeeID', 'Department', 'Username', 'Designation', 'Password', 'Email', 'Gender'],
        rows: [
          ['John Doe', 'EMP001', 'CSE', 'johndoe', 'Assistant Professor', 'teacher123', 'john@inst.edu', 'male'],
          ['Jane Smith', 'EMP002', 'ECE', 'janesmith', 'Associate Professor', 'teacher123', 'jane@inst.edu', 'female'],
          ['Raj Kumar', 'EMP003', 'MECH', 'rajkumar', 'Professor', 'teacher123', 'raj@inst.edu', 'male']
        ],
        notes: [
          ['Column', 'Required?', 'Notes'],
          ['Name', 'Yes', 'Full name of the teacher'],
          ['EmployeeID', 'Yes', 'Unique employee number'],
          ['Department', 'Yes', 'Dept code (e.g. CSE, IT, AIML) or department name'],
          ['Username', 'Yes', 'Unique login username (lowercase)'],
          ['Designation', 'No', 'Role title (default: Assistant Professor)'],
          ['Password', 'No', 'Initial password (default: teacher123)'],
          ['Email', 'No', 'Email address'],
          ['Gender', 'No', 'male, female, or other (default: unspecified)']
        ]
      },
      class: {
        headers: ['Department', 'HallNo', 'Semester', 'Batch', 'Year'],
        rows: [
          ['CSE', 'LH01', 'I', '2025-29', 'I Year'],
          ['CSE', 'LH02', 'I', '2025-29', 'I Year'],
          ['ECE', 'LH03', 'III', '2024-28', 'II Year']
        ],
        notes: [
          ['Column', 'Required?', 'Notes'],
          ['Department', 'Yes', 'Dept code (e.g. CSE, IT, AIML) or department name. Auto-creates if not found.'],
          ['HallNo', 'Yes', 'Room or hall identifier'],
          ['Semester', 'Yes', 'Roman numeral I through VIII'],
          ['Batch', 'Yes', 'Must match an active batch under current Academic Year'],
          ['Year', 'No', 'Year level (default: I Year)'],
          ['', '', ''],
          ['NOTE', '', 'ClassName is auto-generated as BATCH DEPTCODE (e.g. 25-29 CSE)']
        ]
      },
      subject: {
        headers: ['Name', 'Code', 'Department', 'Credits', 'Type'],
        rows: [
          ['Data Structures', 'CS201', 'CSE', '4', 'Theory'],
          ['Digital Electronics Lab', 'EC301', 'ECE', '2', 'Lab'],
          ['Engineering Mathematics', 'MA101', 'CSE', '3', 'Theory']
        ],
        notes: [
          ['Column', 'Required?', 'Notes'],
          ['Name', 'Yes', 'Full subject name'],
          ['Code', 'Yes', 'Subject short code e.g. CS201'],
          ['Department', 'Yes', 'Dept code (e.g. CSE, IT, AIML) or department name'],
          ['Credits', 'No', 'Number of credits (default: 3)'],
          ['Type', 'No', 'Theory, Lab, or Project (default: Theory)'],
          ['', '', ''],
          ['NOTE', '', 'SubjectCode is auto-generated as DEPTCODE-CODE (e.g. CSE-CS201)']
        ]
      },
      student: {
        headers: ['FullName', 'RegisterNo', 'Gender', 'AcademicYear', 'Batch', 'CourseType', 'Branch', 'Department', 'Class', 'Email', 'Username', 'Residency', 'Year', 'Password'],
        rows: [
          ['Ananya Sharma', '2025104001', 'Female', '2025-26', '2025-29', 'UG', 'B.E', 'CSE', '25-29 CSE-A', 'ananya@inst.edu', 'ananya25', 'Dayscholar', 'I Year', 'Student@123'],
          ['Ravi Kumar', '2025104002', 'Male', '2025-26', '2025-29', 'UG', 'B.E', 'CSE', '25-29 CSE-A', 'ravi@inst.edu', 'ravi25', 'Hosteller', 'I Year', 'Student@123'],
          ['Priya Nair', '2025105001', 'Female', '2025-26', '2025-29', 'UG', 'B.E', 'ECE', '25-29 ECE-A', 'priya@inst.edu', 'priya25', 'Dayscholar', 'I Year', 'Student@123']
        ],
        notes: [
          ['Column', 'Required?', 'Notes'],
          ['FullName', 'Yes', 'Student full name'],
          ['RegisterNo', 'Yes', 'Unique registration number'],
          ['Gender', 'Yes', 'Male or Female'],
          ['AcademicYear', 'Yes', 'Academic year e.g. 2025-26'],
          ['Batch', 'Yes', 'Batch range e.g. 2025-29'],
          ['CourseType', 'Yes', 'UG or PG'],
          ['Branch', 'Yes', 'B.E, B.TECH, M.E, or M.TECH'],
          ['Department', 'Yes', 'Dept code (e.g. CSE, IT, AIML) or department name'],
          ['Class', 'Yes', 'Class name e.g. 25-29 CSE-A'],
          ['Email', 'Yes', 'Valid email address'],
          ['Username', 'Yes', 'Unique login (no SB-/TR- prefix)'],
          ['Residency', 'No', 'Dayscholar or Hosteller (default: Dayscholar)'],
          ['Year', 'No', 'Year level e.g. I Year'],
          ['Password', 'No', 'Initial password (server default if blank)'],
          ['', '', ''],
          ['NOTE', '', 'Use standard Dept Code (e.g. CSE, IT, AIML) for Department to avoid naming mismatches.']
        ]
      }
    };

    var cfg = T[type];
    if (!cfg || typeof root.XLSX === 'undefined') {
      if (typeof root.showToast === 'function') root.showToast('Template generation unavailable', 'warn');
      return;
    }

    var data = [cfg.headers].concat(cfg.rows);
    var ws = root.XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = cfg.headers.map(function (h) { return { wch: Math.max(h.length + 4, 16) }; });
    var wb = root.XLSX.utils.book_new();
    root.XLSX.utils.book_append_sheet(wb, ws, type);
    if (cfg.notes) {
      var ns = root.XLSX.utils.aoa_to_sheet(cfg.notes);
      ns['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 55 }];
      root.XLSX.utils.book_append_sheet(wb, ns, 'Instructions');
    }
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
        return '<div class="bubble-user-file">' +
          '<re-icon icon="' + (meta.icon || 'upload') + '" size="16"></re-icon>' +
          '<span>' + util.esc(meta.label) + ' import</span>' +
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
    key: function (ctx) {
      var batch = ctx.batch || {};
      var type = batch.type || (ctx.msg && ctx.msg.payload && ctx.msg.payload.type) || 'student';
      var cols = resolveSchemaCols(type, ctx.schema);
      return 'col-ref-' + type + '-c' + cols.length;
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var type = batch.type || (ctx.msg && ctx.msg.payload && ctx.msg.payload.type) || 'student';
      var meta = config.TYPES[type] || { label: type, icon: 'file' };
      var schemaCols = resolveSchemaCols(type, ctx.schema);

      var html = '<div class="card-frame">' +
        '<div class="card-header">' +
          '<div class="card-title">' +
            '<re-icon icon="' + meta.icon + '" size="16"></re-icon>' +
            '<span>' + util.esc(meta.label) + ' Template & Columns Guide</span>' +
          '</div>' +
          '<div style="display:flex;gap:8px;">' +
            '<button type="button" class="btn-out" style="padding:4px 10px;font-size:11px;" data-action="download-template" data-type="' + type + '">' +
              '<re-icon icon="download" size="13"></re-icon> Download Excel Template' +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div class="card-body" style="padding:14px 18px;">' +
          '<div style="font-size:12px;color:var(--tmu);margin-bottom:12px;">' +
            'Your spreadsheet must include the required columns below. Column order is automatically detected by header names.' +
          '</div>' +
          '<div style="overflow-x:auto;">' +
            '<table class="stg-table" style="width:100%;font-size:11.5px;border-collapse:collapse;">' +
              '<thead>' +
                '<tr style="background:#f4f7f4;text-align:left;">' +
                  '<th style="padding:6px 10px;">Column Name</th>' +
                  '<th style="padding:6px 10px;">Required?</th>' +
                  '<th style="padding:6px 10px;">Accepted Headers / Aliases</th>' +
                  '<th style="padding:6px 10px;">Example</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>';

      if (schemaCols && schemaCols.length) {
        for (var i = 0; i < schemaCols.length; i++) {
          var col = schemaCols[i];
          var reqBadge = col.required
            ? '<span class="chat-status-pill status-verified_all" style="font-size:9px;">Required</span>'
            : '<span class="chat-status-pill status-draft" style="font-size:9px;">Optional</span>';
          var aliases = (col.aliases || []).slice(0, 3).join(', ');

          html += '<tr style="border-bottom:1px solid var(--brl);">' +
            '<td style="padding:6px 10px;font-weight:600;">' + util.esc(col.label || col.key) + '</td>' +
            '<td style="padding:6px 10px;">' + reqBadge + '</td>' +
            '<td style="padding:6px 10px;color:var(--tmu);font-family:monospace;font-size:11px;">' + util.esc(aliases || col.key) + '</td>' +
            '<td style="padding:6px 10px;color:var(--td);">' + util.esc(col.example || '—') + '</td>' +
          '</tr>';
        }
      } else {
        html += '<tr><td colspan="4" style="padding:10px;text-align:center;color:var(--tmu);">Loading column specifications…</td></tr>';
      }

      html += '</tbody></table></div>' +
        '</div>' +
      '</div>';

      return html;
    },
    bind: function (el, ctx) {
      el.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-action="download-template"]');
        if (!btn) return;
        var t = btn.getAttribute('data-type');
        if (t) downloadTemplate(t);
      });
    }
  });

  // 3. UPLOAD CARD
  registerCard('upload', {
    key: function (ctx) {
      return (ctx.batch ? ctx.batch.status : 'up-draft');
    },
    render: function (ctx) {
      var batch = ctx.batch || {};
      var isDraft = !batch.status || batch.status === 'draft' || batch.status === 'uploading';
      var isUploading = batch.status === 'uploading' || batch.status === 'processing';

      var html = '<div class="card-frame">' +
        '<div class="card-header">' +
          '<div class="card-title">' +
            '<re-icon icon="upload-cloud" size="16"></re-icon>' +
            '<span>Upload Spreadsheet (.xlsx, .csv)</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--tmu);">' + (isDraft ? 'Max 10 MB · Up to 5,000 rows' : 'Uploaded') + '</div>' +
        '</div>' +
        '<div class="card-body">';

      if (!isDraft && !isUploading) {
        html += '<div style="padding:16px 20px;text-align:center;border:1px solid var(--brl);border-radius:14px;background:#f8faf8;">' +
          '<div style="width:36px;height:36px;border-radius:10px;background:#f0fdf4;color:#15803d;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;">' +
            '<re-icon icon="check" size="20"></re-icon>' +
          '</div>' +
          '<div style="font-weight:700;font-size:13px;color:var(--td);">' +
            util.esc(batch.originalFileName || 'Spreadsheet uploaded') +
          '</div>' +
          '<div style="font-size:11px;color:var(--tmu);margin-top:2px;">File uploaded and validated</div>' +
        '</div>';
      } else {
        html += '<div class="uz ' + (isUploading ? 'dg' : '') + '" id="chat-dropzone" style="cursor:pointer;padding:28px 20px;text-align:center;border:2px dashed var(--br);border-radius:14px;background:#fbfdfb;transition:all 0.2s;">' +
          '<input type="file" id="chat-file-input" accept=".xlsx,.csv" style="display:none;">' +
          '<div style="width:44px;height:44px;border-radius:12px;background:var(--gLt);color:var(--gD);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;">' +
            '<re-icon icon="file-spreadsheet" size="22"></re-icon>' +
          '</div>' +
          '<div style="font-weight:700;font-size:13.5px;color:var(--td);margin-bottom:4px;" id="chat-dropzone-title">' +
            (isUploading ? 'Uploading and validating spreadsheet…' : 'Drag & drop your Excel file here, or click to browse') +
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
        '</div>';
      }

      html += '</div></div>';
      return html;
    },
    bind: function (el, ctx) {
      var batch = ctx.batch || {};
      var isDraft = !batch.status || batch.status === 'draft' || batch.status === 'uploading';
      if (!isDraft) return;

      var dropzone = el.querySelector('#chat-dropzone');
      var fileInput = el.querySelector('#chat-file-input');
      var progWrap = el.querySelector('#chat-upload-prog-wrap');
      var progFill = el.querySelector('#chat-upload-prog-fill');
      var progText = el.querySelector('#chat-upload-prog-text');
      var progPct = el.querySelector('#chat-upload-prog-pct');
      var titleEl = el.querySelector('#chat-dropzone-title');

      if (!dropzone || !fileInput) return;

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

        if (titleEl) titleEl.textContent = 'Uploading ' + file.name + ' (' + util.formatBytes(file.size) + ')…';
        if (progWrap) progWrap.style.display = 'block';

        var batchId = ctx.batch._id;
        api.upload(batchId, file, function (loaded, total) {
          var pct = Math.round((loaded / total) * 100);
          if (progFill) progFill.style.width = pct + '%';
          if (progPct) progPct.textContent = pct + '%';
          if (progText) progText.textContent = util.formatBytes(loaded) + ' of ' + util.formatBytes(total);
        }).then(function (res) {
          if (typeof root.showToast === 'function') root.showToast('File uploaded successfully. Processing rows…');
          if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
        }).catch(function (err) {
          if (progWrap) progWrap.style.display = 'none';
          if (titleEl) titleEl.textContent = 'Upload failed: ' + (err.message || 'Error');
          if (typeof root.showToast === 'function') root.showToast('Upload error: ' + err.message, 'danger');
        });
      }
    }
  });

  // 4. PROGRESS CARD
  registerCard('progress', {
    key: function (ctx) {
      var p = ctx.progress || (ctx.batch ? ctx.batch.progress : null);
      if (!p) return 'prog-empty';
      return [p.jobKind, p.phase, p.percent, p.error].join('|');
    },
    render: function (ctx) {
      var p = ctx.progress || (ctx.batch ? ctx.batch.progress : null);
      if (!p || !p.phases) {
        return '<div class="progress-card-box"><div style="color:var(--tmu);font-size:12px;">Initializing job execution…</div></div>';
      }

      var overallPct = p.percent || 0;
      var isError = Boolean(p.error);

      var html = '<div class="progress-card-box">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">' +
          '<div style="font-weight:700;font-size:13.5px;color:var(--td);display:flex;align-items:center;gap:8px;">' +
            '<re-icon icon="activity" size="16"></re-icon>' +
            '<span>' + (p.jobKind === 'commit' ? 'Database Commit & Google Drive Archive' : 'Parsing & Validating Workbook') + '</span>' +
          '</div>' +
          '<div style="font-size:12px;font-weight:700;color:var(--gD);">' + overallPct + '%</div>' +
        '</div>' +
        '<div class="prog-phases-list">';

      for (var i = 0; i < p.phases.length; i++) {
        var ph = p.phases[i];
        var iconHtml = '';
        var status = ph.status || 'pending';

        if (status === 'running') {
          iconHtml = '<re-icon icon="loader" size="14"></re-icon>';
        } else if (status === 'done') {
          iconHtml = '<re-icon icon="check" size="14"></re-icon>';
        } else if (status === 'warn') {
          iconHtml = '<re-icon icon="alert-triangle" size="14"></re-icon>';
        } else if (status === 'error') {
          iconHtml = '<re-icon icon="x" size="14"></re-icon>';
        } else {
          iconHtml = '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#cbd5e1;"></span>';
        }

        html += '<div class="prog-item">' +
          '<div class="prog-status-icon ' + status + '">' + iconHtml + '</div>' +
          '<div class="prog-label">' + util.esc(ph.label || ph.key) + '</div>' +
          '<div class="prog-bar-track">' +
            '<div class="prog-bar-fill" style="width:' + (ph.percent || (status === 'done' ? 100 : 0)) + '%;"></div>' +
          '</div>' +
          '<div class="prog-detail">' + util.esc(ph.detail || '') + '</div>' +
        '</div>';
      }

      html += '</div>';

      if (isError) {
        html += '<div style="margin-top:14px;padding:10px 14px;background:#fee2e2;border-radius:10px;color:#991b1b;font-size:12px;display:flex;align-items:center;gap:8px;">' +
          '<re-icon icon="alert-circle" size="16"></re-icon>' +
          '<span>' + util.esc(p.error) + '</span>' +
        '</div>';
      }

      html += '</div>';
      return html;
    },
    bind: function (el, ctx) {}
  });

  // 5. SUMMARY CARD
  registerCard('summary', {
    key: function (ctx) {
      var b = ctx.batch || {};
      var skippedDoneCount = 0;
      var skipped = b.skippedRows || [];
      for (var i = 0; i < skipped.length; i++) {
        if (skipped[i].isDone || skipped[i].isResolved) skippedDoneCount++;
      }
      return [b.status, b.eligibleCount, b.skippedCount, skippedDoneCount, b.drive ? b.drive.folderUrl : ''].join('|');
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

      var driveFolder = batch.drive && batch.drive.folderUrl;
      var driveFile = batch.drive && batch.drive.fileUrl;
      var isForwarded = ['pending_sudo_initial', 'sudo_initial_approved', 'verifying', 'verified_all', 'pending_final_approval', 'committing', 'committed'].includes(batch.status);
      var isStagedOrSkipped = batch.status === 'staged' || batch.status === 'skipped_resolved';

      var html = '<div class="card-frame">' +
        '<div class="card-header">' +
          '<div class="card-title">' +
            '<re-icon icon="clipboard-check" size="16"></re-icon>' +
            '<span>Staging Summary &amp; Validation Report</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--tmu);">' + util.fmtDate(batch.updatedAt || batch.createdAt) + '</div>' +
        '</div>' +
        '<div class="card-body">' +
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

      if (driveFolder || driveFile) {
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

      if (skippedList.length > 0) {
        html += '<div style="margin-top:16px;border-top:1px solid var(--brl);padding-top:16px;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
            '<div style="font-weight:700;font-size:12.5px;color:#92400e;display:flex;align-items:center;gap:6px;">' +
              '<re-icon icon="alert-triangle" size="15"></re-icon>' +
              '<span>Skipped Rows Checklist (' + unresolvedCount + ' pending)</span>' +
            '</div>' +
            (!isForwarded ? '<button type="button" class="btn-out" style="padding:3px 8px;font-size:11px;" data-action="mark-all-done"><re-icon icon="check-check" size="12"></re-icon> Mark All Done</button>' : '') +
          '</div>' +
          '<div style="max-height:220px;overflow-y:auto;border:1px solid var(--brl);border-radius:10px;">' +
            '<table class="stg-table" style="width:100%;font-size:11px;border-collapse:collapse;">' +
              '<thead>' +
                '<tr style="background:#f8faf8;text-align:left;">' +
                  '<th style="padding:6px 8px;width:30px;">Done</th>' +
                  '<th style="padding:6px 8px;width:50px;">Row</th>' +
                  '<th style="padding:6px 8px;">Identifier / Name</th>' +
                  '<th style="padding:6px 8px;">Reason / Issues</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>';

        for (var r = 0; r < skippedList.length; r++) {
          var row = skippedList[r];
          var isDone = Boolean(row.isDone || row.isResolved);
          var rowKey = (row.rowNumber !== undefined ? row.rowNumber : r);
          var ident = row.name || (row.data ? (row.data.registerNo || row.data.name || row.data.code) : '') || '—';
          var issuesStr = Array.isArray(row.issues) ? row.issues.join('; ') : (row.reason || 'Invalid data');

          html += '<tr style="border-bottom:1px solid var(--brl);background:' + (isDone ? '#f0fdf4' : '#ffffff') + ';">' +
            '<td style="padding:6px 8px;text-align:center;">' +
              '<input type="checkbox" class="skipped-done-check" data-row-key="' + rowKey + '" ' + (isDone ? 'checked' : '') + ' ' + (isForwarded ? 'disabled' : '') + '>' +
            '</td>' +
            '<td style="padding:6px 8px;font-weight:600;">' + (row.rowNumber || (r + 1)) + '</td>' +
            '<td style="padding:6px 8px;font-weight:600;color:var(--td);">' + util.esc(ident) + '</td>' +
            '<td style="padding:6px 8px;color:#b45309;">' + util.esc(issuesStr) + '</td>' +
          '</tr>';
        }

        html += '</tbody></table></div>' +
        '</div>';
      }

      if (isStagedOrSkipped) {
        html += '<div style="margin-top:20px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--brl);padding-top:14px;">' +
          '<button type="button" class="btn-out" style="padding:8px 14px;font-size:12px;" data-action="rescan-batch">' +
            '<re-icon icon="refresh-cw" size="13"></re-icon> Re-scan Uploaded File' +
          '</button>' +
          '<button type="button" class="btn-replace" style="padding:8px 20px;font-size:12.5px;background:var(--gB);" data-action="forward-sudo" ' + (unresolvedCount > 0 ? 'disabled title="Please resolve or mark all skipped rows before continuing"' : '') + '>' +
            '<re-icon icon="arrow-right" size="14"></re-icon> Continue to Initial Approval' +
          '</button>' +
        '</div>';
      } else if (isForwarded) {
        html += '<div style="margin-top:14px;font-size:11.5px;color:var(--gD);display:flex;align-items:center;gap:6px;">' +
          '<re-icon icon="check-circle-2" size="15"></re-icon>' +
          '<span>Forwarded for Initial Approval</span>' +
        '</div>';
      }

      html += '</div></div>';
      return html;
    },
    bind: function (el, ctx) {
      var batchId = ctx.batch._id;

      // Checkbox changes for skipped rows
      var debouncedSave = util.debounce(function () {
        var checkboxes = el.querySelectorAll('.skipped-done-check');
        var resolved = [];
        checkboxes.forEach(function (cb) {
          if (cb.checked) {
            resolved.push(parseInt(cb.getAttribute('data-row-key'), 10));
          }
        });
        api.resolveSkipped(batchId, resolved)
          .then(function (res) {
            if (typeof root.showToast === 'function') root.showToast('Skipped status saved');
            var b = store.getState().batch;
            store.setState({
              batch: Object.assign({}, b, {
                skippedRows: (res && res.skippedRows) ? res.skippedRows : b.skippedRows,
                status: (res && res.status) ? res.status : b.status
              })
            });
          })
          .catch(function (err) {
            if (typeof root.showToast === 'function') root.showToast('Failed to save: ' + err.message, 'warn');
          });
      }, 400);

      el.addEventListener('change', function (e) {
        if (e.target.classList.contains('skipped-done-check')) {
          debouncedSave();
        }
      });

      el.addEventListener('click', function (e) {
        var markAllBtn = e.target.closest('[data-action="mark-all-done"]');
        if (markAllBtn) {
          var checkboxes = el.querySelectorAll('.skipped-done-check');
          var resolved = [];
          checkboxes.forEach(function (cb) {
            cb.checked = true;
            resolved.push(parseInt(cb.getAttribute('data-row-key'), 10));
          });
          api.resolveSkipped(batchId, resolved).then(function (res) {
            var b = store.getState().batch;
            store.setState({
              batch: Object.assign({}, b, {
                skippedRows: (res && res.skippedRows) ? res.skippedRows : b.skippedRows,
                status: (res && res.status) ? res.status : b.status
              })
            });
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          });
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
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
          });
          return;
        }

        var forwardBtn = e.target.closest('[data-action="forward-sudo"]');
        if (forwardBtn) {
          forwardBtn.disabled = true;
          api.forwardSudo(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Forwarded for Initial Approval');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            forwardBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
          });
        }
      });
    }
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
    render: function (ctx) {
      var batch = ctx.batch || {};
      var type = batch.type;
      var isSimpleType = type === 'dept' || type === 'class' || type === 'subject';

      var total = batch.eligibleCount || (batch.eligibleRows ? batch.eligibleRows.length : 0);
      var verifiedCount = 0;
      var rows = batch.eligibleRows || [];
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].isVerified) verifiedCount++;
      }
      var pct = total > 0 ? Math.round((verifiedCount / total) * 100) : 0;
      var isAllVerified = verifiedCount >= total && total > 0;

      var html = '<div class="card-frame">' +
        '<div class="card-header">' +
          '<div class="card-title">' +
            '<re-icon icon="user-check" size="16"></re-icon>' +
            '<span>Step 3: Verification &amp; Credential Dispatch</span>' +
          '</div>' +
          '<div style="font-size:11px;font-weight:700;color:var(--gD);">' + verifiedCount + ' / ' + total + ' Verified (' + pct + '%)</div>' +
        '</div>' +
        '<div class="card-body">';

      if (isSimpleType) {
        html += '<div style="display:flex;align-items:center;gap:10px;color:var(--gD);font-size:13px;font-weight:600;">' +
          '<re-icon icon="check-circle-2" size="20"></re-icon>' +
          '<span>Verification automatically passed for ' + (config.TYPES[type] ? config.TYPES[type].label : type) + '. Ready for final commitment.</span>' +
        '</div>';
      } else {
        html += '<div style="margin-bottom:14px;">' +
          '<div class="prog-bar-track" style="height:10px;">' +
            '<div class="prog-bar-fill" style="width:' + pct + '%;"></div>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">' +
          '<button type="button" class="btn-out" style="padding:10px 18px;font-size:12.5px;" data-action="open-drawer">' +
            '<re-icon icon="table" size="14"></re-icon> ' + (isAllVerified ? ('Review Verified Records (' + total + ')') : ('Open Verification Panel (' + (total - verifiedCount) + ' remaining)')) +
          '</button>';

        if (isAllVerified) {
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
        } else {
          html += '<button type="button" class="btn-out" style="padding:10px 14px;font-size:12px;" data-action="verify-all-remaining">' +
            '<re-icon icon="check-circle" size="14"></re-icon> Verify All Remaining' +
          '</button>';
          if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
            html += '<button type="button" class="btn-out" style="padding:10px 14px;font-size:11px;color:var(--tmu);" data-action="dev-bypass-verify">' +
              '<re-icon icon="zap" size="12"></re-icon> Dev Bypass' +
            '</button>';
          }
        }

        html += '</div>';
      }

      html += '</div></div>';
      return html;
    },
    bind: function (el, ctx) {
      var batchId = ctx.batch._id;
      el.addEventListener('click', function (e) {
        var drawerBtn = e.target.closest('[data-action="open-drawer"]');
        if (drawerBtn) {
          store.setState({ drawerOpen: true });
          return;
        }

        var verifyAllBtn = e.target.closest('[data-action="verify-all-remaining"]');
        if (verifyAllBtn) {
          e.preventDefault();
          var confFn = (typeof root.Bulk?.util?.safeConfirm === 'function') ? root.Bulk.util.safeConfirm :
                       (typeof root.confirmModal === 'function') ? root.confirmModal : window.confirm;
          Promise.resolve(confFn('Are you sure you want to verify all remaining records and dispatch credentials?')).then(function (ok) {
            if (!ok) return;
            verifyAllBtn.disabled = true;
            api.verifyAll(batchId).then(function () {
              if (typeof root.showToast === 'function') root.showToast('All records verified successfully');
              if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
            }).catch(function (err) {
              verifyAllBtn.disabled = false;
              if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
            });
          });
          return;
        }

        var bypassBtn = e.target.closest('[data-action="dev-bypass-verify"]');
        if (bypassBtn) {
          bypassBtn.disabled = true;
          api.devBypassVerify(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Dev bypass executed');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            bypassBtn.disabled = false;
            if (typeof root.showToast === 'function') root.showToast(err.message, 'warn');
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

  // 8. FINAL APPROVAL & COMMIT CARD
  registerCard('final', {
    key: function (ctx) {
      var b = ctx.batch || {};
      return [b.status, b.eligibleCount, b.finalApproval ? b.finalApproval.status : ''].join('|');
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

      var html = '<div class="card-frame">' +
        '<div class="card-header">' +
          '<div class="card-title">' +
            '<re-icon icon="database" size="16"></re-icon>' +
            '<span>Step 4: Final Approval &amp; Database Commit</span>' +
          '</div>' +
          '<div style="font-size:11px;color:var(--tmu);">' + (isCommitted ? 'Committed' : (eligible + ' records ready')) + '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div style="background:#f8faf8;padding:12px 16px;border-radius:12px;border:1px solid var(--brl);margin-bottom:16px;font-size:12px;">' +
            '<div style="font-weight:700;color:var(--td);margin-bottom:6px;">Pre-Flight Summary</div>' +
            '<div>✓ All ' + eligible + ' records verified and validated</div>' +
            '<div>✓ Passwords scrubbed before backup archive generation</div>' +
            '<div>✓ Google Drive cryptographic ZIP backup enabled</div>' +
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
        html += '<button type="button" class="btn-replace" style="padding:12px 24px;font-size:13.5px;background:var(--gD);" data-action="approve-commit">' +
          '<re-icon icon="database" size="15"></re-icon> Commit Records to Database' +
        '</button>';
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
          commitBtn.disabled = true;
          api.approveFinal(batchId).then(function () {
            if (typeof root.showToast === 'function') root.showToast('Database commit initiated');
            if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batchId);
          }).catch(function (err) {
            commitBtn.disabled = false;
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
