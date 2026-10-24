/**
 * EAMS Searchable Custom Dropdown Component
 * Timetable-styled searchable dropdown with live search, badges, and full native <select> sync.
 */
(function (global) {
  'use strict';

  var instances = new Map();

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function resolveBatchYear(batchStr, opt) {
    if (!batchStr) return '';
    // 1. Direct dataset or attribute on option element
    if (opt) {
      if (opt.dataset && opt.dataset.year) return opt.dataset.year;
      if (opt.dataset && opt.dataset.badge && opt.dataset.badge !== 'Batch') return opt.dataset.badge;
      var attrYr = opt.getAttribute('data-year') || opt.getAttribute('data-badge');
      if (attrYr && attrYr !== 'Batch') return attrYr;
    }

    // 2. Global helper function if defined on window/page
    if (typeof global.getBatchYearLevel === 'function') {
      var byFn = global.getBatchYearLevel(batchStr);
      if (byFn) return byFn;
    }

    // 3. In-memory academic years data from Manage Page / Admin Page API cache
    var yearsData = (typeof YEAR_CONFIG !== 'undefined' && Array.isArray(YEAR_CONFIG.yearsData)) ? YEAR_CONFIG.yearsData :
                    (typeof global.yearsData !== 'undefined' && Array.isArray(global.yearsData)) ? global.yearsData :
                    SearchableDropdown._yearsData;
    var currentAcadYear = (typeof YEAR_CONFIG !== 'undefined' && YEAR_CONFIG.current) ? YEAR_CONFIG.current :
                          (typeof global.currentAcademicYear !== 'undefined' ? global.currentAcademicYear : '');

    if (Array.isArray(yearsData) && yearsData.length) {
      // Find current/active academic year record first
      var curRecord = currentAcadYear ? yearsData.find(function(y) { return y.academicYear === currentAcadYear; }) : null;
      if (!curRecord) curRecord = yearsData.find(function(y) { return y.isCurrent; }) || yearsData[0];
      if (curRecord && Array.isArray(curRecord.batches)) {
        var fb = curRecord.batches.find(function(b) {
          return b && (b.batch === batchStr || b.batchTrackId === batchStr);
        });
        if (fb && fb.currentYear) return fb.currentYear;
      }
      // Check other year records if not found in active record
      for (var i = 0; i < yearsData.length; i++) {
        var yRec = yearsData[i];
        if (Array.isArray(yRec.batches)) {
          var fb2 = yRec.batches.find(function(b) {
            return b && (b.batch === batchStr || b.batchTrackId === batchStr);
          });
          if (fb2 && fb2.currentYear) return fb2.currentYear;
        }
      }
    }

    // 4. Mathematical calculation with reference to academic year
    var acadStr = currentAcadYear;
    if (!acadStr && Array.isArray(yearsData) && yearsData.length) {
      var r = yearsData.find(function(y) { return y.isCurrent; }) || yearsData[0];
      if (r && r.academicYear) acadStr = r.academicYear;
    }
    var acadStart = 0;
    if (acadStr) {
      var mAcad = String(acadStr).match(/(\d{4})/);
      if (mAcad) acadStart = parseInt(mAcad[1], 10);
    }
    if (!acadStart) {
      var now = new Date();
      acadStart = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
    }

    var mBatch = String(batchStr).match(/(\d{4})/);
    if (mBatch && acadStart) {
      var batchStart = parseInt(mBatch[1], 10);
      var offset = acadStart - batchStart;
      var ROMAN = ['I', 'II', 'III', 'IV'];
      if (offset >= 0 && offset < ROMAN.length) {
        return ROMAN[offset];
      }
    }

    // 5. Lazy-fetch Manage Page API (/api/year) if not in memory
    if (!SearchableDropdown._yearsData && !SearchableDropdown._fetchingYears) {
      SearchableDropdown._fetchingYears = true;
      try {
        var tok = sessionStorage.getItem('eams_token');
        var p = (typeof global.apiCall === 'function')
          ? global.apiCall('GET', '/year')
          : fetch('/api/year', { headers: { 'Authorization': tok ? 'Bearer ' + tok : '' } }).then(function(res) { return res.json(); });
        p.then(function (data) {
          if (Array.isArray(data) && data.length) {
            SearchableDropdown._yearsData = data;
            SearchableDropdown.syncAll();
          }
        }).catch(function () {});
      } catch (e) {}
    }

    return '';
  }

  function normalizeDeptCode(deptStr) {
    if (!deptStr) return '';
    var str = String(deptStr).trim();
    if (!str) return '';

    // If it's already a short code like CSE, IT, ECE, MECH, CIVIL, AIDS, AIML, MAT, etc.
    if (str.length <= 5 && !/\s/.test(str)) {
      var u = str.toUpperCase();
      if (u === 'MATH' || u === 'MATHS') return 'MAT';
      return u;
    }

    var lower = str.toLowerCase();

    // Specific standard mappings
    if (lower.includes('mathematics') || lower === 'maths' || lower === 'math' || lower === 'mat') return 'MAT';
    if (lower.includes('computer science') || lower === 'cse') return 'CSE';
    if (lower.includes('information tech') || lower === 'it') return 'IT';
    if (lower.includes('electronics and comm') || lower.includes('electronics & comm') || lower.includes('ece')) return 'ECE';
    if (lower.includes('electrical') || lower.includes('eee')) return 'EEE';
    if (lower.includes('mechatronics') || lower === 'mtrx') return 'MTRX';
    if (lower.includes('mechanical') || lower === 'mech') return 'MECH';
    if (lower.includes('civil')) return 'CIVIL';
    if (lower.includes('machine learning') || lower.includes('aiml') || lower.includes('ai & ml') || lower.includes('ai/ml')) return 'AIML';
    if (lower.includes('data science') || lower.includes('aids') || lower.includes('ai & ds') || lower.includes('ai and ds') || lower.includes('artificial')) return 'AIDS';
    if (lower.includes('cyber') || lower === 'cys') return 'CYS';
    if (lower.includes('biomedical') || lower === 'bme') return 'BME';
    if (lower.includes('biotech') || lower === 'bt') return 'BT';
    if (lower.includes('aeronautical') || lower.includes('aerospace') || lower === 'aero') return 'AERO';
    if (lower.includes('automobile') || lower === 'auto') return 'AUTO';
    if (lower.includes('physics') || lower === 'phy') return 'PHY';
    if (lower.includes('chemistry') || lower === 'chem') return 'CHEM';
    if (lower.includes('english') || lower === 'eng') return 'ENG';
    if (lower.includes('humanities') || lower === 's&h') return 'S&H';
    if (lower.includes('business administration') || lower === 'mba') return 'MBA';
    if (lower.includes('computer application') || lower === 'mca') return 'MCA';

    // Check against global departments list in memory if available
    var depts = (typeof DB !== 'undefined' && DB.get) ? (DB.get('depts') || DB.get('departments') || []) : [];
    if (Array.isArray(depts) && depts.length) {
      var dMatch = depts.find(function (d) {
        return (d.name && d.name.toLowerCase().trim() === lower) ||
               (d.code && d.code.toLowerCase().trim() === lower);
      });
      if (dMatch && (dMatch.code || dMatch.threeLetterCode)) {
        var c = String(dMatch.code || dMatch.threeLetterCode).toUpperCase();
        if (c === 'MATH' || c === 'MATHS') return 'MAT';
        return c;
      }
    }

    // Fallback: extract acronym from words
    var words = str.split(/\s+/).filter(Boolean);
    if (words.length > 1) {
      return words.map(function (w) { return w[0] || ''; }).join('').toUpperCase().slice(0, 5);
    }
    return str.slice(0, 4).toUpperCase();
  }

  function lookupTeacherDeptCode(teacherId) {
    if (!teacherId) return '';
    try {
      var allT = (typeof _teacherData !== 'undefined' && Array.isArray(_teacherData)) ? _teacherData : [];
      if (!allT.length && typeof DB !== 'undefined' && DB.get) {
        allT = (DB.get('users') || []).filter(function (u) { return u.role === 'teacher'; });
      }
      if (Array.isArray(allT) && allT.length) {
        var found = allT.find(function (t) {
          return String(t._id || t.trackId || t.shadowId) === String(teacherId);
        });
        if (found) {
          var c = found.deptCode || found.dept || found.department;
          if (c) return normalizeDeptCode(c);
          var dId = found.deptId ? (typeof found.deptId === 'object' && found.deptId._id ? found.deptId._id : found.deptId) : '';
          var depts = (typeof DB !== 'undefined' && DB.get) ? (DB.get('depts') || DB.get('departments') || []) : [];
          if (dId && Array.isArray(depts)) {
            var dMatch = depts.find(function (d) { return String(d._id) === String(dId); });
            if (dMatch && dMatch.code) return String(dMatch.code).toUpperCase();
            if (dMatch && dMatch.name) return normalizeDeptCode(dMatch.name);
          }
        }
      }
    } catch (e) {}
    return '';
  }

  function parseOptionData(opt, kind, selectId) {
    var rawText = (opt.textContent || '').trim();
    var val = opt.value;
    var isLoading = rawText.toLowerCase().includes('loading');
    var isPlaceholder = !val || val === '' || rawText.startsWith('—') || rawText.startsWith('All ') || rawText === 'All' || isLoading;

    var attrBadge = opt.dataset ? (opt.dataset.badge || opt.dataset.dept) : (opt.getAttribute('data-badge') || opt.getAttribute('data-dept'));
    if (attrBadge && /^[0-9a-fA-F]{24}$/.test(attrBadge.trim())) {
      attrBadge = '';
    }
    var attrSub = opt.dataset ? opt.dataset.sub : opt.getAttribute('data-sub');

    var data = {
      value: val,
      rawText: rawText,
      title: rawText,
      badge: attrBadge ? attrBadge.trim() : '',
      sub: attrSub ? attrSub.trim() : '',
      icon: 'chevron-right',
      isPlaceholder: isPlaceholder,
      disabled: opt.disabled || isLoading,
      selected: opt.selected,
      isLab: false,
      isLoading: isLoading
    };

    if (isLoading) {
      data.icon = 'hourglass';
      data.badge = 'Loading';
      return data;
    }

    if (isPlaceholder) {
      if (rawText.startsWith('All ') || rawText === 'All') {
        data.badge = 'All';
      }
      if (kind === 'room') data.icon = 'arrow-door-in';
      else if (kind === 'dept') data.icon = 'building2';
      else if (kind === 'class') data.icon = 'chalkboard';
      else if (kind === 'batch') data.icon = 'calendar';
      else if (kind === 'ct' || kind === 'courseType') data.icon = 'award';
      else if (kind === 'sec' || kind === 'section') data.icon = 'layout-grid';
      else if (kind === 'advisor') data.icon = 'teacher';
      else if (kind === 'desig' || selectId.includes('desig')) data.icon = 'award';
      else if (kind === 'status' || selectId.includes('status')) data.icon = 'activity';
      else if (kind === 'teacher' || kind === 'faculty' || selectId.includes('advisor') || selectId.includes('tch') || selectId.includes('teacher')) data.icon = 'teacher';
      else if (kind === 'subject' || kind === 'subj' || selectId.includes('subj')) data.icon = 'book-open';
      else data.icon = 'search';
      return data;
    }

    // Room parser
    if (kind === 'room' || selectId.includes('room') || selectId.includes('hall')) {
      // Format usually: "LH 38 (Main Block, Fl 2 • Room)" or "Hall 1 (Block A • Lab)"
      var roomMatch = rawText.match(/^([^(]+)(?:\(([^)]+)\))?/);
      if (roomMatch) {
        data.title = roomMatch[1].trim();
        var details = roomMatch[2] ? roomMatch[2].trim() : '';
        if (details) {
          var parts = details.split('•');
          data.badge = (parts[0] || '').trim();
          data.sub = (parts[1] || '').trim();
        }
      }
      var isLab = (data.title + ' ' + data.sub + ' ' + data.badge).toLowerCase().includes('lab');
      data.isLab = isLab;
      data.icon = isLab ? 'microscope' : 'arrow-door-in';
      return data;
    }

    // Department parser
    if (kind === 'dept' || selectId.includes('dept')) {
      data.icon = 'building2';
      var dCode = '';

      // 1. Check data-badge or data-code attribute on option
      if (attrBadge) {
        dCode = normalizeDeptCode(attrBadge);
      }
      if (!dCode && opt.dataset && opt.dataset.code) {
        dCode = normalizeDeptCode(opt.dataset.code);
      }

      // 2. Check DB lookup by option value (department ObjectId or code)
      if (!dCode && val) {
        try {
          var depts = (typeof DB !== 'undefined' && DB.get) ? (DB.get('depts') || DB.get('departments') || []) : [];
          if (Array.isArray(depts) && depts.length) {
            var foundD = depts.find(function (d) {
              return String(d._id || d.id || '') === String(val) ||
                     String(d.code || '').toLowerCase() === String(val).toLowerCase();
            });
            if (foundD) {
              if (foundD.code || foundD.threeLetterCode) {
                dCode = normalizeDeptCode(foundD.code || foundD.threeLetterCode);
              }
              if (!dCode && foundD.name) {
                dCode = normalizeDeptCode(foundD.name);
              }
            }
          }
        } catch (e) {}
      }

      // 3. Handle rawText with "CODE - Name" or "Name - CODE"
      if (rawText.includes(' - ')) {
        var deptParts = rawText.split(' - ');
        var p0 = deptParts[0].trim();
        var p1 = deptParts.slice(1).join(' - ').trim();
        if (p0.length <= 6) {
          if (!dCode) dCode = normalizeDeptCode(p0);
          data.title = p1;
        } else {
          if (!dCode) dCode = normalizeDeptCode(p1);
          data.title = p0;
        }
      } else {
        // Handle rawText with parentheses e.g. "Computer Science (CSE)"
        var deptMatch = rawText.match(/^([^(]+)(?:\(([^)]+)\))?/);
        if (deptMatch && deptMatch[2]) {
          data.title = deptMatch[1].trim();
          if (!dCode) dCode = normalizeDeptCode(deptMatch[2].trim());
        } else {
          data.title = rawText;
        }
      }

      // 4. Fallback to normalizeDeptCode on title or rawText
      if (!dCode) {
        dCode = normalizeDeptCode(data.title || rawText);
      }

      data.badge = dCode || '';
      return data;
    }

    // Class parser
    if (kind === 'class' || selectId.includes('cls') || selectId.includes('class')) {
      data.icon = 'chalkboard';
      if (attrBadge) {
        data.badge = attrBadge.trim();
        var clm = rawText.match(/^([^(]+)(?:\(([^)]+)\))?/);
        data.title = clm && clm[1] ? clm[1].trim() : rawText;
        return data;
      }
      // Format: "II CSE A" or "III IT (A)" or "IV MECH B (B)" or "25-29 CSE-D (Already Open)" or "25-29 CSE-D (Substitution)"
      var classMatch = rawText.match(/^([^(]+)(?:\(([^)]+)\))?/);
      if (classMatch && classMatch[2]) {
        data.title = classMatch[1].trim();
        var secTxt = classMatch[2].trim();
        if (secTxt.toLowerCase().includes('open')) {
          data.badge = 'Tab Open';
        } else if (secTxt.toLowerCase().includes('substitut')) {
          data.badge = 'Substitution';
        } else {
          data.badge = secTxt.toLowerCase().startsWith('sec') ? secTxt : ('Sec ' + secTxt);
        }
      } else {
        var parts = rawText.trim().split(/\s+/);
        if (parts.length >= 3) {
          data.title = parts.slice(0, -1).join(' ');
          data.badge = 'Sec ' + parts[parts.length - 1];
        } else {
          data.title = rawText;
        }
      }
      if (opt && opt.getAttribute && opt.getAttribute('data-sub') === '1') {
        data.badge = 'Substitution';
      }
      return data;
    }

    // Batch parser
    if (kind === 'batch' || selectId.includes('batch')) {
      data.icon = 'calendar';
      data.title = rawText;
      if (rawText && !isPlaceholder) {
        var yearBadge = resolveBatchYear(rawText || val, opt);
        data.badge = yearBadge || 'Batch';
      }
      return data;
    }

    // Course Type parser
    if (kind === 'ct' || kind === 'courseType' || selectId.includes('ct')) {
      data.icon = 'award';
      data.title = rawText === 'UG' ? 'Undergraduate' : (rawText === 'PG' ? 'Postgraduate' : rawText);
      if (rawText && !isPlaceholder) {
        data.badge = rawText;
      }
      return data;
    }

    // Section parser
    if (kind === 'sec' || kind === 'section' || selectId.includes('sec')) {
      data.icon = 'layout-grid';
      data.title = (rawText && !rawText.toLowerCase().startsWith('sec')) ? ('Section ' + rawText) : rawText;
      if (rawText && !isPlaceholder) {
        data.badge = rawText.toLowerCase().startsWith('sec') ? rawText : ('Sec ' + rawText);
      }
      return data;
    }

    // Designation parser
    if (kind === 'desig' || selectId.includes('desig')) {
      data.icon = 'award';
      data.title = rawText;
      if (rawText && !isPlaceholder) {
        var lowerDesig = rawText.toLowerCase();
        if (lowerDesig.includes('assistant professor') || lowerDesig === 'asst prof' || lowerDesig === 'ap') {
          data.badge = 'Asst Prof';
        } else if (lowerDesig.includes('associate professor') || lowerDesig === 'assoc prof') {
          data.badge = 'Assoc Prof';
        } else if (lowerDesig === 'professor' || lowerDesig === 'prof') {
          data.badge = 'Prof';
        } else if (lowerDesig === 'hod' || lowerDesig.includes('head of')) {
          data.badge = 'HOD';
        } else if (lowerDesig.includes('lecturer')) {
          data.badge = 'Lecturer';
        } else {
          data.badge = rawText.length <= 10 ? rawText : rawText.slice(0, 8);
        }
      }
      return data;
    }

    // Teacher / Faculty / Advisor parser
    if (kind === 'teacher' || kind === 'advisor' || kind === 'faculty' ||
        selectId.includes('advisor') || selectId.includes('tch') || selectId.includes('teacher') || selectId.includes('prin')) {
      data.icon = 'teacher';

      // Clean Faculty Name on left
      var attrName = opt.dataset ? (opt.dataset.name || opt.dataset.fullname) : (opt.getAttribute('data-name') || opt.getAttribute('data-fullname'));
      var tchMatch = rawText.match(/^([^(]+)(?:\(([^)]+)\))?/);
      if (attrName && attrName.trim()) {
        data.title = attrName.trim();
      } else if (tchMatch && tchMatch[1] && tchMatch[2]) {
        data.title = tchMatch[1].trim();
      } else {
        data.title = rawText;
      }

      // Department Code (CSE, IT, ECE, etc.) on right in green badge
      var rawBadge = attrBadge ? attrBadge.trim() : '';
      if (!rawBadge && tchMatch && tchMatch[2]) {
        var paren = tchMatch[2].trim();
        if (!/^\d+$/.test(paren) && paren.length <= 6) {
          rawBadge = paren;
        } else {
          data.sub = paren;
        }
      }

      // Never duplicate the name into the badge
      if (rawBadge && rawBadge.toLowerCase() === data.title.toLowerCase()) {
        rawBadge = '';
      }

      if (rawBadge) {
        data.badge = normalizeDeptCode(rawBadge);
      } else {
        var lookedUpDept = lookupTeacherDeptCode(val);
        if (lookedUpDept) data.badge = lookedUpDept;
      }

      if (attrSub) data.sub = attrSub.trim();
      data.hideSub = true;
      return data;
    }

    // Subject parser
    if (kind === 'subject' || kind === 'subj' || selectId.includes('subj') || selectId.includes('subject') || selectId === 'attsub') {
      data.icon = 'book-open';
      if (attrBadge) {
        data.badge = attrBadge.trim();
        var sm = rawText.match(/^([^(]+)(?:\(([^)]+)\))?/);
        if (sm && sm[2] && sm[2].trim() === attrBadge.trim()) {
          data.title = sm[1].trim();
        } else if (rawText.includes(' - ')) {
          var sp = rawText.split(' - ');
          if (sp[0].trim() === attrBadge.trim()) {
            data.title = sp.slice(1).join(' - ').trim();
          } else {
            data.title = rawText;
          }
        } else {
          data.title = rawText;
        }
      } else {
        var subjMatch = rawText.match(/^([^(]+)(?:\(([^)]+)\))?/);
        if (subjMatch && subjMatch[2]) {
          data.title = subjMatch[1].trim();
          data.badge = subjMatch[2].trim();
        } else if (rawText.includes(' - ')) {
          var subParts = rawText.split(' - ');
          data.badge = subParts[0].trim();
          data.title = subParts.slice(1).join(' - ').trim();
        } else {
          data.title = rawText;
        }
      }
      if (opt && opt.getAttribute && opt.getAttribute('data-sub') === '1') {
        data.badge = 'Substitution';
      }
      return data;
    }

    // Status parser
    if (kind === 'status' || selectId.includes('status')) {
      var lowVal = (val || rawText).toLowerCase();
      if (lowVal === 'active') {
        data.icon = 'check-circle';
        data.badge = 'Active';
        data.title = 'Active';
      } else if (lowVal === 'inactive') {
        data.icon = 'pause';
        data.badge = 'Inactive';
        data.title = 'Inactive';
      } else if (lowVal === 'locked') {
        data.icon = 'lock';
        data.badge = 'Locked';
        data.title = 'Locked';
      } else {
        data.icon = 'activity';
        data.title = rawText;
        if (rawText.startsWith('All') || rawText === 'All') data.badge = 'All';
      }
      return data;
    }

    return data;
  }

  function SearchableDropdown(selectEl, config) {
    if (typeof selectEl === 'string') {
      selectEl = document.getElementById(selectEl);
    }
    if (!selectEl || selectEl.tagName !== 'SELECT') return null;

    if (instances.has(selectEl)) {
      var existing = instances.get(selectEl);
      if (config) {
        existing.config = Object.assign(existing.config || {}, config);
        if (config.placeholder) existing.placeholder = config.placeholder;
        if (config.searchPlaceholder) existing.searchPlaceholder = config.searchPlaceholder;
        if (config.kind) existing.kind = config.kind;
      }
      existing.rebuild();
      return existing;
    }

    this.selectEl = selectEl;
    this.config = config || {};
    this.hasSearch = this.config.search !== false && this.config.searchable !== false;
    this.kind = this.config.kind || (
      selectEl.id.includes('room') || selectEl.id.includes('hall') ? 'room' :
      selectEl.id.includes('dept') ? 'dept' :
      selectEl.id.includes('desig') ? 'desig' :
      selectEl.id.includes('status') ? 'status' :
      selectEl.id.includes('batch') ? 'batch' :
      selectEl.id.includes('ct') ? 'ct' :
      selectEl.id.includes('sec') ? 'sec' :
      selectEl.id.includes('advisor') ? 'advisor' :
      selectEl.id.includes('tch') || selectEl.id.includes('teacher') ? 'teacher' :
      selectEl.id.includes('subj') || selectEl.id.includes('subject') || selectEl.id === 'attsub' ? 'subject' :
      selectEl.id.includes('cls') || selectEl.id.includes('class') ? 'class' : 'auto'
    );
    this.placeholder = this.config.placeholder || (
      this.kind === 'room' ? '— Select Room / Hall —' :
      this.kind === 'dept' ? '— Select Department —' :
      this.kind === 'class' ? '— Select Class —' :
      this.kind === 'advisor' ? '— None (Unassigned) —' :
      this.kind === 'teacher' ? '— Select Teacher —' :
      this.kind === 'subject' ? '— Select Subject —' :
      this.kind === 'desig' ? 'All Designations' :
      this.kind === 'status' ? 'All Statuses' :
      this.kind === 'batch' ? 'All Batches' :
      (this.kind === 'courseType' || this.kind === 'ct') ? 'All' :
      (this.kind === 'section' || this.kind === 'sec') ? 'All' : '— Select —'
    );
    this.searchPlaceholder = this.config.searchPlaceholder || (
      this.kind === 'room' ? 'Search room, hall, building…' :
      this.kind === 'dept' ? 'Search department name, code…' :
      this.kind === 'class' ? 'Search class, section, batch…' :
      this.kind === 'status' ? 'Search status…' :
      this.kind === 'advisor' || this.kind === 'teacher' ? 'Search faculty name, emp ID, dept…' :
      this.kind === 'subject' ? 'Search subject name, code…' :
      this.kind === 'desig' ? 'Search designation…' : 'Search options…'
    );

    this.showIcon = this.config.showIcon !== undefined
      ? !!this.config.showIcon
      : (this.config.hideIcon ? false : (selectEl.id !== 'cd-advisor-select' && this.kind !== 'advisor'));

    this.items = [];
    this.isOpen = false;
    this.wrapper = null;
    this.triggerBtn = null;
    this.menuEl = null;
    this.searchInput = null;
    this.clearBtn = null;
    this.listEl = null;
    this.countEl = null;

    this.init();
    instances.set(selectEl, this);
  }

  SearchableDropdown.prototype.init = function () {
    var self = this;
    var sel = this.selectEl;

    // Keep native select in DOM but hidden
    sel.style.setProperty('position', 'absolute', 'important');
    sel.style.setProperty('opacity', '0', 'important');
    sel.style.setProperty('pointer-events', 'none', 'important');
    sel.style.setProperty('width', '0', 'important');
    sel.style.setProperty('height', '0', 'important');
    sel.style.setProperty('margin', '0', 'important');
    sel.style.setProperty('padding', '0', 'important');
    sel.style.setProperty('border', '0', 'important');
    sel.tabIndex = -1;

    // Create custom container
    var wrapper = document.createElement('div');
    wrapper.className = 'tt-custom-dropdown' + (this.hasSearch ? '' : ' no-search') + (this.config.compact ? ' is-compact' : '') + (!this.showIcon ? ' no-icon' : '');
    wrapper.id = 'cdd-' + sel.id;
    if (this.config.minWidth) wrapper.style.minWidth = this.config.minWidth;
    if (this.config.maxWidth) wrapper.style.maxWidth = this.config.maxWidth;
    if (this.config.width) wrapper.style.width = this.config.width;

    if (sel.style.display === 'none' || sel.hidden) {
      wrapper.style.display = 'none';
    }
    this.wrapper = wrapper;

    // Trigger button
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'tt-dropdown-trigger';
    trigger.id = 'cdd-trig-' + sel.id;
    if (this.config.width) {
      trigger.style.width = this.config.width;
      trigger.style.minWidth = '0';
    }
    trigger.innerHTML =
      '<div class="tt-dropdown-trigger-left">' +
        (self.showIcon ? '<span class="tt-dropdown-trigger-icon"><re-icon icon="search" size="14"></re-icon></span>' : '') +
        '<span class="tt-dropdown-trigger-text">' + escapeHtml(self.placeholder) + '</span>' +
      '</div>' +
      '<div class="tt-dropdown-trigger-right">' +
        '<span class="tt-dropdown-trigger-badge" style="display:none;"></span>' +
        '<span class="tt-dropdown-trigger-arrow">▾</span>' +
      '</div>';
    this.triggerBtn = trigger;
    wrapper.appendChild(trigger);

    // Menu Popover
    var menu = document.createElement('div');
    menu.className = 'tt-dropdown-menu';
    menu.id = 'cdd-menu-' + sel.id;
    menu.style.display = 'none';

    if (this.hasSearch) {
      var searchBox = document.createElement('div');
      searchBox.className = 'tt-dropdown-search-box';
      searchBox.innerHTML =
        '<span class="tt-dropdown-search-icon"><re-icon icon="search" size="13"></re-icon></span>' +
        '<input type="text" class="tt-dropdown-search-input" placeholder="' + escapeHtml(self.searchPlaceholder) + '" autocomplete="off">' +
        '<button type="button" class="tt-dropdown-search-clear" style="display:none;" title="Clear search">✕</button>';
      menu.appendChild(searchBox);

      var header = document.createElement('div');
      header.className = 'tt-dropdown-menu-header';
      header.innerHTML =
        '<span class="tt-dropdown-menu-header-title tt-dd-count">0 Options</span>' +
        '<span class="tt-dropdown-menu-header-hint">Type to filter</span>';
      menu.appendChild(header);

      this.searchInput = searchBox.querySelector('.tt-dropdown-search-input');
      this.clearBtn = searchBox.querySelector('.tt-dropdown-search-clear');
      this.countEl = header.querySelector('.tt-dd-count');
    }

    var list = document.createElement('div');
    list.className = 'tt-dropdown-list';
    menu.appendChild(list);

    wrapper.appendChild(menu);
    this.menuEl = menu;
    this.listEl = list;

    // Insert wrapper in DOM immediately after select
    if (sel.nextSibling) {
      sel.parentNode.insertBefore(wrapper, sel.nextSibling);
    } else {
      sel.parentNode.appendChild(wrapper);
    }

    // Attach event listeners
    this.triggerBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      self.toggle();
    });

    if (this.searchInput) {
      this.searchInput.addEventListener('input', function () {
        var query = self.searchInput.value;
        if (self.clearBtn) {
          self.clearBtn.style.display = query ? 'flex' : 'none';
        }
        self.filter(query);
      });

      this.searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          var firstItem = self.listEl ? self.listEl.querySelector('.tt-dropdown-item:not([style*="display: none"])') : null;
          if (firstItem) {
            var val = firstItem.getAttribute('data-val');
            self.select(val);
          }
        }
      });
    }

    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.searchInput.value = '';
        self.clearBtn.style.display = 'none';
        self.searchInput.focus();
        self.filter('');
      });
    }

    // Native select changes (external scripts updating value or change event)
    sel.addEventListener('change', function () {
      self.updateTriggerFromSelect();
    });

    // Intercept .value property mutations on the native select
    try {
      var proto = HTMLSelectElement.prototype;
      var descVal = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descVal && descVal.set) {
        var origSetVal = descVal.set;
        var origGetVal = descVal.get;
        Object.defineProperty(sel, 'value', {
          get: function () {
            return origGetVal.call(this);
          },
          set: function (newVal) {
            origSetVal.call(this, newVal);
            self.updateTriggerFromSelect();
          },
          configurable: true
        });
      }

      var descDis = Object.getOwnPropertyDescriptor(proto, 'disabled');
      if (descDis && descDis.set) {
        var origSetDis = descDis.set;
        var origGetDis = descDis.get;
        Object.defineProperty(sel, 'disabled', {
          get: function () {
            return origGetDis.call(this);
          },
          set: function (newDis) {
            origSetDis.call(this, newDis);
            if (self.triggerBtn) self.triggerBtn.disabled = !!newDis;
          },
          configurable: true
        });
      }
    } catch (e) {
      // Fallback
    }

    // MutationObserver to detect dynamically added/removed <option> elements or attribute changes
    if (window.MutationObserver) {
      this.observer = new MutationObserver(function (mutations) {
        var needsRebuild = false;
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i];
          if (m.type === 'childList') {
            needsRebuild = true;
          } else if (m.type === 'attributes') {
            if (m.attributeName === 'style' || m.attributeName === 'class' || m.attributeName === 'hidden') {
              self.syncVisibility();
            } else if (m.attributeName === 'disabled') {
              if (self.triggerBtn) self.triggerBtn.disabled = !!sel.disabled;
            }
          }
        }
        if (needsRebuild) self.rebuild();
      });
      this.observer.observe(sel, {
        childList: true,
        attributes: true,
        attributeFilter: ['disabled', 'style', 'class', 'hidden']
      });
    }

    // Build initial options
    this.rebuild();
  };

  SearchableDropdown.prototype.show = function () {
    if (this.wrapper) {
      this.wrapper.style.display = this.config.display || 'inline-block';
    }
  };

  SearchableDropdown.prototype.hide = function () {
    if (this.wrapper) {
      this.wrapper.style.display = 'none';
    }
    this.close();
  };

  SearchableDropdown.prototype.syncVisibility = function () {
    if (!this.wrapper || !this.selectEl) return;
    var isHidden = this.selectEl.style.display === 'none' || this.selectEl.hidden;
    if (isHidden) {
      this.hide();
    } else {
      this.show();
    }
  };

  SearchableDropdown.prototype.rebuild = function () {
    var self = this;
    var sel = this.selectEl;
    if (!sel) return;

    var options = Array.from(sel.options || []);
    this.items = options.map(function (opt) {
      return parseOptionData(opt, self.kind, sel.id);
    });

    // Update disabled state
    if (sel.disabled) {
      this.triggerBtn.disabled = true;
    } else {
      this.triggerBtn.disabled = false;
    }

    // Render items list
    this.filter(this.searchInput ? this.searchInput.value : '');
    this.updateTriggerFromSelect();
  };

  SearchableDropdown.prototype.filter = function (query) {
    var self = this;
    var q = (query || '').toLowerCase().trim();
    var list = this.listEl;
    if (!list) return;

    var filtered = this.items.filter(function (it) {
      if (!q) return true;
      var text = (it.rawText + ' ' + it.badge + ' ' + it.sub + ' ' + it.title).toLowerCase();
      return text.includes(q);
    });

    var selectableCount = filtered.filter(function (it) { return !it.isPlaceholder; }).length;
    if (this.countEl) {
      var labelUnit = self.kind === 'room' ? 'Rooms' :
                      self.kind === 'dept' ? 'Departments' :
                      self.kind === 'class' ? 'Classes' :
                      self.kind === 'desig' ? 'Designations' :
                      self.kind === 'status' ? 'Statuses' :
                      (self.kind === 'teacher' || self.kind === 'advisor' || self.kind === 'faculty') ? 'Faculty Members' :
                      (self.kind === 'subject' || self.kind === 'subj') ? 'Subjects' : 'Options';
      this.countEl.textContent = (selectableCount || filtered.length) + ' Available ' + labelUnit;
    }

    if (!filtered.length) {
      list.innerHTML =
        '<div class="tt-dropdown-empty">' +
          '<span class="tt-dropdown-empty-icon"><re-icon icon="search" size="18"></re-icon></span>' +
          '<div class="tt-dropdown-empty-title">No matching options found</div>' +
          '<div style="font-size:11px;color:var(--tmu);">Try adjusting your search terms</div>' +
        '</div>';
      return;
    }

    var selectedVal = self.selectEl.value;
    list.innerHTML = filtered.map(function (it) {
      var isSel = String(it.value) === String(selectedVal);
      var isClearOpt = it.isPlaceholder && !it.value;
      var isAllOption = it.rawText.startsWith('All ') || it.rawText === 'All';
      var optTitle = isClearOpt
        ? (isAllOption
            ? (it.rawText.startsWith('All ') ? it.rawText : '— All —')
            : (it.rawText || (self.kind === 'advisor' ? '— None (Unassigned) —' : '— All —')))
        : it.title;
      var optIcon = isClearOpt
        ? (isAllOption
            ? (self.kind === 'dept' ? 'building2' :
               self.kind === 'class' ? 'chalkboard' :
               self.kind === 'batch' ? 'calendar' :
               self.kind === 'desig' ? 'award' :
               (self.kind === 'courseType' || self.kind === 'ct') ? 'award' :
               (self.kind === 'section' || self.kind === 'sec') ? 'layout-grid' : 'search')
            : 'x'
          )
        : it.icon;

      return (
        '<div class="tt-dropdown-item' + (isSel ? ' selected is-selected' : '') + '" data-val="' + escapeHtml(it.value) + '" role="option" aria-selected="' + (isSel ? 'true' : 'false') + '" title="' + escapeHtml(it.rawText || optTitle) + '" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:nowrap;white-space:nowrap;">' +
          '<div class="tt-dropdown-item-left" style="display:flex;align-items:center;gap:8px;min-width:0;flex:1 1 auto;overflow:hidden;">' +
            '<span class="tt-dropdown-item-dot"></span>' +
            (self.showIcon && optIcon ? '<span class="tt-dd-item-icon"><re-icon icon="' + escapeHtml(optIcon) + '" size="14"></re-icon></span>' : '') +
            '<span class="tt-dropdown-item-text" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(optTitle) + '</span>' +
          '</div>' +
          '<div class="tt-dropdown-item-right" style="display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;flex-shrink:0;margin-left:auto;white-space:nowrap;">' +
            (it.badge ? '<span class="tt-dropdown-item-badge' + (it.isLab ? ' warn' : '') + '" title="' + escapeHtml(it.badge) + '">' + escapeHtml(it.badge) + '</span>' : '') +
            (it.sub && !it.hideSub ? '<span class="tt-dropdown-item-sub" title="' + escapeHtml(it.sub) + '">' + escapeHtml(it.sub) + '</span>' : '') +
            '<span class="tt-dropdown-item-check">' + (isSel ? '<re-icon icon="check" size="13"></re-icon>' : '') + '</span>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    // Attach click handlers
    list.querySelectorAll('.tt-dropdown-item').forEach(function (itemEl) {
      itemEl.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var val = itemEl.getAttribute('data-val');
        self.select(val);
      });
    });
  };

  SearchableDropdown.prototype.select = function (value) {
    var sel = this.selectEl;
    if (!sel) return;

    sel.value = value;
    // Dispatch native change event so all page listeners and inline handlers fire
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    this.updateTriggerFromSelect();
    this.close();
  };

  SearchableDropdown.prototype.updateTriggerFromSelect = function () {
    var sel = this.selectEl;
    if (!sel || !this.triggerBtn) return;

    var currentVal = sel.value;
    var selectedOpt = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex] : null;
    var textEl = this.triggerBtn.querySelector('.tt-dropdown-trigger-text');
    var iconEl = this.triggerBtn.querySelector('.tt-dropdown-trigger-icon');
    var badgeEl = this.triggerBtn.querySelector('.tt-dropdown-trigger-badge');

    if (sel.disabled) {
      this.triggerBtn.disabled = true;
    } else {
      this.triggerBtn.disabled = false;
    }

    if (!selectedOpt || !currentVal || currentVal === '') {
      var defaultPlaceholder = (selectedOpt && selectedOpt.textContent && !selectedOpt.textContent.startsWith('—'))
        ? selectedOpt.textContent.trim()
        : this.placeholder;

      if (textEl) textEl.textContent = defaultPlaceholder;
      if (iconEl) {
        if (!this.showIcon) {
          iconEl.style.display = 'none';
          iconEl.innerHTML = '';
        } else {
          iconEl.style.display = '';
          var defIcon = this.kind === 'room' ? 'arrow-door-in' :
                        this.kind === 'dept' ? 'building2' :
                        this.kind === 'class' ? 'chalkboard' :
                        this.kind === 'batch' ? 'calendar' :
                        (this.kind === 'desig') ? 'award' :
                        (this.kind === 'status') ? 'activity' :
                        (this.kind === 'courseType' || this.kind === 'ct') ? 'award' :
                        (this.kind === 'section' || this.kind === 'sec') ? 'layout-grid' :
                        (this.kind === 'advisor' || this.kind === 'teacher' || this.kind === 'faculty') ? 'teacher' :
                        (this.kind === 'subject' || this.kind === 'subj') ? 'book-open' : 'search';
          iconEl.innerHTML = '<re-icon icon="' + defIcon + '" size="14"></re-icon>';
        }
      }
      if (badgeEl) {
        if (selectedOpt && (selectedOpt.textContent.startsWith('All ') || selectedOpt.textContent === 'All')) {
          badgeEl.textContent = 'All';
          badgeEl.style.display = 'inline-flex';
        } else {
          var validCount = this.items.filter(function (it) { return !it.isPlaceholder; }).length;
          if (validCount > 0) {
            var countLabel = this.kind === 'room' ? (validCount + ' Rooms') :
                             this.kind === 'dept' ? (validCount + ' Depts') :
                             this.kind === 'class' ? (validCount + ' Classes') :
                             this.kind === 'desig' ? (validCount + ' Designations') :
                             this.kind === 'status' ? (validCount + ' Statuses') :
                             (this.kind === 'teacher' || this.kind === 'advisor') ? (validCount + ' Faculty') :
                             (this.kind === 'subject' || this.kind === 'subj') ? (validCount + ' Subjects') :
                             this.kind === 'batch' ? (validCount + ' Batches') :
                             (this.kind === 'courseType' || this.kind === 'ct') ? (validCount + ' Types') :
                             (this.kind === 'section' || this.kind === 'sec') ? (validCount + ' Secs') :
                             (validCount + ' Options');
            badgeEl.textContent = countLabel;
            badgeEl.style.display = 'inline-flex';
          } else {
            badgeEl.style.display = 'none';
          }
        }
      }
      return;
    }

    var item = parseOptionData(selectedOpt, this.kind, sel.id);
    if (textEl) textEl.textContent = item.title;
    if (iconEl) {
      if (!this.showIcon) {
        iconEl.style.display = 'none';
        iconEl.innerHTML = '';
      } else {
        iconEl.style.display = '';
        iconEl.innerHTML = '<re-icon icon="' + (item.icon || 'check') + '" size="14"></re-icon>';
      }
    }
    if (badgeEl) {
      if (item.badge || item.sub) {
        badgeEl.textContent = item.badge || item.sub;
        badgeEl.style.display = 'inline-flex';
      } else {
        badgeEl.style.display = 'none';
      }
    }
  };

  SearchableDropdown.prototype.toggle = function () {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  };

  SearchableDropdown.prototype.open = function () {
    var self = this;
    if (this.selectEl.disabled) return;

    // Close any other open searchable dropdowns
    SearchableDropdown.closeAll();

    this.isOpen = true;
    this.wrapper.classList.add('is-open');

    // Elevate parent card so dropdown is never clipped by overflow:hidden or covered by siblings
    var parentCard = this.wrapper.closest('.card, .panel, .asel, .att-selector-zone, .sa-table-wrap, .ca-table-wrap, .subj-modal-body, .modal-box, .modal-box-md');
    if (parentCard) {
      if (!parentCard.dataset.origOverflow) {
        parentCard.dataset.origOverflow = parentCard.style.overflow || '';
      }
      parentCard.style.overflow = 'visible';
      parentCard.style.position = 'relative';
      parentCard.style.zIndex = '60';
    }

    var modalEl = this.wrapper.closest('.modal, .modal-box, .modal-bg');
    if (modalEl) {
      if (!modalEl.dataset.origOverflow) {
        modalEl.dataset.origOverflow = modalEl.style.overflow || '';
      }
      modalEl.style.overflow = 'visible';
    }

    // Auto-detect if opening downwards would overflow window bottom or modal bottom
    var rect = this.wrapper.getBoundingClientRect();
    var spaceBelow = window.innerHeight - rect.bottom;
    var modalEl = this.wrapper.closest('.modal, .modal-box, .modal-bg');
    var shouldDropUp = false;
    if (modalEl) {
      var modalRect = modalEl.getBoundingClientRect();
      var spaceBelowModal = modalRect.bottom - rect.bottom;
      var spaceAboveModal = rect.top - modalRect.top;
      var estHeight = Math.min(240, 78 + (Math.max(1, self.items.length) * 34));
      if (spaceBelowModal < estHeight && spaceAboveModal > spaceBelowModal) {
        shouldDropUp = true;
      }
    }
    if (!shouldDropUp && spaceBelow < 250 && rect.top > 250 && rect.top > spaceBelow) {
      shouldDropUp = true;
    }

    if (shouldDropUp) {
      this.wrapper.classList.add('drop-up');
    } else {
      this.wrapper.classList.remove('drop-up');
    }

    var shouldDropRight = false;
    var menuWidth = self.hasSearch ? 340 : 220;
    if ((rect.left + menuWidth > (window.innerWidth - 30) && rect.right > menuWidth) || (rect.right > (window.innerWidth - 60) && rect.left > 160)) {
      shouldDropRight = true;
    } else if (modalEl) {
      var mRect = modalEl.getBoundingClientRect();
      var spaceRightModal = mRect.right - rect.right;
      if (spaceRightModal < 140 && (rect.right - mRect.left) > 300) {
        shouldDropRight = true;
      }
    }

    if (shouldDropRight) {
      this.wrapper.classList.add('drop-right');
    } else {
      this.wrapper.classList.remove('drop-right');
    }

    this.menuEl.style.display = 'block';

    // Reset search query and focus search box, or scroll to selected item
    if (this.hasSearch && this.searchInput) {
      this.searchInput.value = '';
      if (this.clearBtn) this.clearBtn.style.display = 'none';
      this.filter('');
      setTimeout(function () {
        self.searchInput.focus();
      }, 50);
    } else {
      this.filter('');
      var selItem = this.listEl ? this.listEl.querySelector('.tt-dropdown-item.is-selected') : null;
      if (selItem) {
        selItem.scrollIntoView({ block: 'nearest' });
      }
    }
  };

  SearchableDropdown.prototype.close = function () {
    this.isOpen = false;
    if (this.wrapper) {
      this.wrapper.classList.remove('is-open');
      this.wrapper.classList.remove('drop-up');
      this.wrapper.classList.remove('drop-right');
    }
    if (this.menuEl) {
      this.menuEl.style.display = 'none';
    }

    var parentCard = this.wrapper ? this.wrapper.closest('.card, .panel, .asel, .att-selector-zone, .sa-table-wrap, .ca-table-wrap, .subj-modal-body, .modal-box, .modal-box-md') : null;
    if (parentCard) {
      var otherOpen = parentCard.querySelector('.tt-custom-dropdown.is-open');
      if (!otherOpen && parentCard.dataset.keepVisible !== 'true') {
        parentCard.style.overflow = parentCard.dataset.origOverflow || '';
        delete parentCard.dataset.origOverflow;
        parentCard.style.zIndex = '';
      }
    }

    var modalEl = this.wrapper ? this.wrapper.closest('.modal, .modal-box, .modal-bg') : null;
    if (modalEl) {
      var otherModalOpen = modalEl.querySelector('.tt-custom-dropdown.is-open');
      if (!otherModalOpen) {
        modalEl.style.overflow = modalEl.dataset.origOverflow || '';
        delete modalEl.dataset.origOverflow;
      }
    }
  };

  SearchableDropdown.prototype.destroy = function () {
    if (this.observer) {
      this.observer.disconnect();
    }
    if (this.wrapper && this.wrapper.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
    }
    if (this.selectEl) {
      this.selectEl.style.removeProperty('position');
      this.selectEl.style.removeProperty('opacity');
      this.selectEl.style.removeProperty('pointer-events');
      this.selectEl.style.removeProperty('width');
      this.selectEl.style.removeProperty('height');
      this.selectEl.tabIndex = 0;
      instances.delete(this.selectEl);
    }
  };

  // Static Methods
  SearchableDropdown.attach = function (selectOrId, options) {
    var el = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
    if (!el) return null;
    return new SearchableDropdown(el, options);
  };

  SearchableDropdown.get = function (selectOrId) {
    var el = typeof selectOrId === 'string' ? document.getElementById(selectOrId) : selectOrId;
    return instances.get(el) || null;
  };

  SearchableDropdown.sync = function (selectOrId) {
    var inst = SearchableDropdown.get(selectOrId);
    if (inst) inst.rebuild();
  };

  SearchableDropdown.syncAll = function () {
    instances.forEach(function (inst) {
      inst.rebuild();
    });
  };

  SearchableDropdown.closeAll = function () {
    instances.forEach(function (inst) {
      if (inst.isOpen) inst.close();
    });
  };

  // Global document click listener to close open menus on outside click
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.tt-custom-dropdown')) {
      SearchableDropdown.closeAll();
    }
  });

  // Global Escape key listener
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      SearchableDropdown.closeAll();
    }
  });

  // Expose normalization helper
  SearchableDropdown.normalizeDeptCode = normalizeDeptCode;

  global.SearchableDropdown = SearchableDropdown;

})(window);
