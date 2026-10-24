/**
 * bulk.verify-modal.js
 * Verification modal handler for individual student, teacher, or generic records.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util;
  var api = root.Bulk.api;
  var store = root.Bulk.store;

  function updateVEditClassList(targetClassIdOrName) {
    var state = store.getState();
    var cache = state.cache || {};
    var deptSel = document.getElementById('vedit-dept');
    var batchSel = document.getElementById('vedit-batch');
    var classSel = document.getElementById('vedit-class');
    if (!classSel) return;

    var deptId = deptSel ? deptSel.value : '';
    var deptName = deptSel && deptSel.selectedIndex >= 0 ? deptSel.options[deptSel.selectedIndex].text : '';
    var batchVal = batchSel ? batchSel.value : '';

    var matchingClasses = (cache.classes || []).filter(function (c) {
      var matchDept = !deptId || String(c.deptId) === String(deptId) || (c.deptName && c.deptName.toLowerCase() === deptName.toLowerCase());
      var matchBatch = !batchVal || (c.batch && c.batch.toLowerCase() === batchVal.toLowerCase());
      return matchDept && matchBatch;
    });

    if (matchingClasses.length === 0) {
      matchingClasses = (cache.classes || []).slice();
    }

    var currentClass = targetClassIdOrName || classSel.value;
    var found = matchingClasses.some(function (c) { return c.name === currentClass || c._id === currentClass; });
    if (currentClass && !found) {
      matchingClasses.unshift({ _id: currentClass, name: currentClass });
    }

    classSel.innerHTML = '<option value="">— Select Class —</option>' + matchingClasses.map(function (c) {
      var sel = (currentClass && (c.name === currentClass || c._id === currentClass)) ? ' selected' : '';
      return '<option value="' + util.esc(c.name || c._id) + '"' + sel + '>' + util.esc(c.name) + '</option>';
    }).join('');
  }

  function openVerifyEditModal(rowNumber) {
    var state = store.getState();
    var batch = state.batch;
    var cache = state.cache || {};
    if (!batch || !batch.eligibleRows) return;

    var entry = batch.eligibleRows.find(function (r) { return r.rowNumber === rowNumber; });
    if (!entry) return;

    var isTeacher = batch.type === 'teacher';
    var isStudent = batch.type === 'student';
    var d = entry.data || {};

    var rowNumEl = document.getElementById('vedit-row-number');
    if (rowNumEl) rowNumEl.value = rowNumber;

    var stuSection = document.getElementById('vedit-student-section');
    var tchSection = document.getElementById('vedit-teacher-section');
    var genSection = document.getElementById('vedit-generic-section');
    var titleEl = document.getElementById('verify-edit-title');
    var subEl = document.getElementById('verify-edit-subtitle');

    if (isStudent) {
      if (stuSection) stuSection.style.display = 'block';
      if (tchSection) tchSection.style.display = 'none';
      if (genSection) genSection.style.display = 'none';

      if (titleEl) titleEl.innerHTML = '<re-icon icon="graduation-cap" size="18"></re-icon> Student Details Verification';
      if (subEl) subEl.textContent = (d.registerNo || '') + (d.registerNo && (d.class || d.department) ? ' · ' : '') + (d.class || d.department || ('Row ' + rowNumber));

      var rawName = d.fullName || d.name || '';
      var cleanName = util.sanitizeFullName(rawName);
      var nameEl = document.getElementById('vedit-name');
      if (nameEl) nameEl.value = cleanName;

      var split = util.splitFirstLastName(cleanName);
      var fn = util.sanitizeFullName(d.firstName || '') || split.firstName;
      var ln = util.sanitizeFullName(d.lastName || '') || split.lastName;
      var fnEl = document.getElementById('vedit-firstName');
      var lnEl = document.getElementById('vedit-lastName');
      if (fnEl) fnEl.value = fn;
      if (lnEl) lnEl.value = ln;

      // Departments
      var deptVal = d.department || d.deptName || d.deptCode || d.dept || '';
      var matchedDept = (cache.depts || []).find(function (dept) {
        return (dept._id && String(dept._id) === String(d.deptId)) ||
               (dept.name && dept.name.toLowerCase() === deptVal.toLowerCase()) ||
               (dept.code && dept.code.toLowerCase() === deptVal.toLowerCase());
      });
      var deptSel = document.getElementById('vedit-dept');
      if (deptSel) {
        deptSel.innerHTML = '<option value="">— Select —</option>' + (cache.depts || []).map(function (dept) {
          var isSelected = (matchedDept && String(dept._id) === String(matchedDept._id)) ||
                           (deptVal && dept.name.toLowerCase() === deptVal.toLowerCase()) ||
                           (deptVal && dept.code.toLowerCase() === deptVal.toLowerCase());
          var label = util.esc(dept.name) + (dept.code ? ' (' + util.esc(dept.code) + ')' : '');
          return '<option value="' + util.esc(dept._id) + '" data-name="' + util.esc(dept.name) + '" data-code="' + util.esc(dept.code || '') + '" data-course-type="' + util.esc(dept.courseType || '') + '" data-branch="' + util.esc(dept.branch || '') + '"' + (isSelected ? ' selected' : '') + '>' + label + '</option>';
        }).join('');
        if (!matchedDept && deptVal) {
          deptSel.insertAdjacentHTML('beforeend', '<option value="' + util.esc(deptVal) + '" selected data-name="' + util.esc(deptVal) + '">' + util.esc(deptVal) + '</option>');
        }
      }

      // Register No & Track ID
      var regEl = document.getElementById('vedit-regNo');
      var regVal = d.registerNo || d.regNo || '';
      if (regEl) regEl.value = regVal;
      var trackEl = document.getElementById('vedit-trackId');
      if (trackEl) {
        var curTrack = d.trackId;
        if (!curTrack || curTrack.startsWith('TRSTU_') || curTrack.startsWith('STU')) {
          curTrack = util.computeStudentTrackId(regVal, matchedDept || deptVal, d.batch, cache.depts);
        }
        trackEl.value = curTrack;
      }

      // Course Type & Branch
      var ctEl = document.getElementById('vedit-courseType');
      var brEl = document.getElementById('vedit-branch');
      if (ctEl) ctEl.value = d.courseType || (matchedDept ? matchedDept.courseType || '' : 'UG');
      if (brEl) brEl.value = d.branch || (matchedDept ? (matchedDept.branch || matchedDept.name || '') : deptVal);

      // Academic Year
      var yearSel = document.getElementById('vedit-year');
      if (yearSel) {
        var yearList = (cache.years && cache.years.length)
          ? cache.years.map(function (y) { return y.academicYear || y.name || y; })
          : [];
        var curY = d.academicYear || '';
        if (!curY && d.batch) {
          var bParts = d.batch.split('-');
          if (bParts.length === 2) {
            var yStart = parseInt(bParts[0], 10);
            if (!isNaN(yStart)) curY = yStart + '-' + (yStart + 1);
          }
        }
        if (!curY) {
          var thisYear = new Date().getFullYear();
          curY = thisYear + '-' + (thisYear + 1);
        }
        if (curY && yearList.indexOf(curY) === -1) yearList.unshift(curY);
        yearSel.innerHTML = yearList.map(function (y) {
          return '<option value="' + util.esc(y) + '"' + (y === curY ? ' selected' : '') + '>' + util.esc(y) + '</option>';
        }).join('');
      }

      // Batch
      var batchSel = document.getElementById('vedit-batch');
      if (batchSel) {
        var batchList = (cache.batches && cache.batches.length) ? cache.batches.slice() : [];
        if (d.batch && batchList.indexOf(d.batch) === -1) batchList.unshift(d.batch);
        batchSel.innerHTML = batchList.map(function (b) {
          return '<option value="' + util.esc(b) + '"' + (b === d.batch ? ' selected' : '') + '>' + util.esc(b) + '</option>';
        }).join('') || '<option value="' + util.esc(d.batch || '') + '">' + util.esc(d.batch || '—') + '</option>';
      }

      // Class
      updateVEditClassList(d.class);

      // Gender
      var gSel = document.getElementById('vedit-gender');
      if (gSel && d.gender) {
        for (var gi = 0; gi < gSel.options.length; gi++) {
          if (gSel.options[gi].value.toLowerCase() === d.gender.toLowerCase()) {
            gSel.selectedIndex = gi;
            break;
          }
        }
      }

      // Residency
      var resSel = document.getElementById('vedit-residency');
      if (resSel) {
        resSel.value = (d.residency && String(d.residency).toLowerCase().includes('hostel')) ? 'hostel' : 'dayscholar';
      }

      // Login details
      var emailEl = document.getElementById('vedit-email');
      if (emailEl) emailEl.value = d.email || '';
      var userEl = document.getElementById('vedit-username');
      if (userEl) userEl.value = d.username || (d.email ? d.email.split('@')[0].toLowerCase() : '');
      var passEl = document.getElementById('vedit-password');
      if (passEl) {
        passEl.value = '';
        passEl.placeholder = 'Keep uploaded password (or enter new)';
      }

    } else if (isTeacher) {
      if (stuSection) stuSection.style.display = 'none';
      if (tchSection) tchSection.style.display = 'block';
      if (genSection) genSection.style.display = 'none';

      if (titleEl) titleEl.innerHTML = '<re-icon icon="teacher" size="18"></re-icon> Teacher Details Verification';
      if (subEl) subEl.textContent = (d.employeeNo || '') + (d.employeeNo && d.department ? ' · ' : '') + (d.department || ('Row ' + rowNumber));

      var rawTName = d.fullName || d.name || '';
      var cleanTName = util.sanitizeFullName(rawTName);
      var tNameEl = document.getElementById('vedit-t-name');
      if (tNameEl) tNameEl.value = cleanTName;
      var splitT = util.splitFirstLastName(cleanTName);
      var tFn = util.sanitizeFullName(d.firstName || '') || splitT.firstName;
      var tLn = util.sanitizeFullName(d.lastName || '') || splitT.lastName;
      var tFnEl = document.getElementById('vedit-t-firstName');
      var tLnEl = document.getElementById('vedit-t-lastName');
      if (tFnEl) tFnEl.value = tFn;
      if (tLnEl) tLnEl.value = tLn;

      var tEmpEl = document.getElementById('vedit-t-empId');
      if (tEmpEl) tEmpEl.value = d.employeeNo || d.empId || '';
      var tTrkEl = document.getElementById('vedit-t-trackId');
      if (tTrkEl) tTrkEl.value = d.trackId || util.computeTeacherTrackId(tEmpEl ? tEmpEl.value : '');

      var tDeptSel = document.getElementById('vedit-t-dept');
      if (tDeptSel) {
        tDeptSel.innerHTML = '<option value="">— Select —</option>' + (cache.depts || []).map(function (dept) {
          var isSel = (d.department && (dept.name.toLowerCase() === d.department.toLowerCase() || dept.code.toLowerCase() === d.department.toLowerCase()));
          var label = util.esc(dept.name) + (dept.code ? ' (' + util.esc(dept.code) + ')' : '');
          return '<option value="' + util.esc(dept.name) + '"' + (isSel ? ' selected' : '') + '>' + label + '</option>';
        }).join('');
        if (d.department && !(cache.depts || []).some(function (x) { return x.name.toLowerCase() === d.department.toLowerCase(); })) {
          tDeptSel.insertAdjacentHTML('beforeend', '<option value="' + util.esc(d.department) + '" selected>' + util.esc(d.department) + '</option>');
        }
      }

      var tDesigSel = document.getElementById('vedit-t-desig');
      if (tDesigSel && d.designation) {
        tDesigSel.value = d.designation;
      }

      var tGenSel = document.getElementById('vedit-t-gender');
      if (tGenSel && d.gender) {
        tGenSel.value = d.gender;
      }

      var tEmailEl = document.getElementById('vedit-t-email');
      if (tEmailEl) tEmailEl.value = d.email || '';
      var tUserEl = document.getElementById('vedit-t-username');
      if (tUserEl) tUserEl.value = d.username || (d.email ? d.email.split('@')[0].toLowerCase() : '');
      var tPassEl = document.getElementById('vedit-t-password');
      if (tPassEl) {
        tPassEl.value = '';
        tPassEl.placeholder = 'Keep uploaded password (or enter new)';
      }

    } else {
      // Generic fallback
      if (stuSection) stuSection.style.display = 'none';
      if (tchSection) tchSection.style.display = 'none';
      if (genSection) genSection.style.display = 'block';

      if (titleEl) titleEl.innerHTML = '<re-icon icon="edit-3" size="18"></re-icon> ' + (batch.type.toUpperCase()) + ' Verification';
      if (subEl) subEl.textContent = 'Review record details for Row ' + rowNumber;

      var genWrap = document.getElementById('vedit-generic-fields');
      if (genWrap) {
        genWrap.innerHTML = Object.keys(d).map(function (k) {
          return '<div class="fg"><label class="fl">' + util.esc(k) + '</label><input type="text" class="fc2" name="' + util.esc(k) + '" value="' + util.esc(d[k] || '') + '"></div>';
        }).join('');
      }
    }

    var modal = document.getElementById('bulk-verify-edit-modal');
    if (modal) modal.classList.add('open');
  }

  function closeVerifyEditModal() {
    var modal = document.getElementById('bulk-verify-edit-modal');
    if (modal) modal.classList.remove('open');
  }

  function submitVerifyEntry() {
    var rowNumber = parseInt(document.getElementById('vedit-row-number').value, 10);
    if (isNaN(rowNumber)) return;

    var state = store.getState();
    var batch = state.batch;
    if (!batch) return;

    var isStudent = batch.type === 'student';
    var isTeacher = batch.type === 'teacher';
    var updatedData = {};

    if (isStudent) {
      var deptSel = document.getElementById('vedit-dept');
      var selectedDeptOpt = deptSel && deptSel.selectedIndex >= 0 ? deptSel.options[deptSel.selectedIndex] : null;
      var deptName = selectedDeptOpt ? (selectedDeptOpt.getAttribute('data-name') || selectedDeptOpt.text || selectedDeptOpt.value) : '';
      var deptId = selectedDeptOpt ? selectedDeptOpt.value : '';

      var classSel = document.getElementById('vedit-class');
      var className = classSel ? classSel.value : '';

      var rawName = document.getElementById('vedit-name').value || '';
      var cleanFullName = util.sanitizeFullName(rawName);
      var split = util.splitFirstLastName(cleanFullName);
      var fn = util.sanitizeFullName(document.getElementById('vedit-firstName').value) || split.firstName;
      var ln = util.sanitizeFullName(document.getElementById('vedit-lastName').value) || split.lastName;

      updatedData = {
        fullName: cleanFullName,
        registerNo: (document.getElementById('vedit-regNo').value || '').trim(),
        firstName: fn,
        lastName: ln,
        department: deptName,
        deptId: deptId || undefined,
        courseType: (document.getElementById('vedit-courseType').value || '').trim(),
        branch: (document.getElementById('vedit-branch').value || '').trim(),
        trackId: (document.getElementById('vedit-trackId').value || '').trim(),
        academicYear: (document.getElementById('vedit-year').value || '').trim(),
        batch: (document.getElementById('vedit-batch').value || '').trim(),
        class: className,
        gender: (document.getElementById('vedit-gender').value || 'Male'),
        residency: (document.getElementById('vedit-residency') ? document.getElementById('vedit-residency').value : 'dayscholar'),
        email: (document.getElementById('vedit-email').value || '').trim(),
        username: (document.getElementById('vedit-username').value || '').trim()
      };
      var stuPw = (document.getElementById('vedit-password').value || '').trim();
      if (stuPw) updatedData.password = stuPw;
    } else if (isTeacher) {
      var rawTName = document.getElementById('vedit-t-name').value || '';
      var cleanTFullName = util.sanitizeFullName(rawTName);
      var splitT = util.splitFirstLastName(cleanTFullName);
      var tFn = util.sanitizeFullName(document.getElementById('vedit-t-firstName').value) || splitT.firstName;
      var tLn = util.sanitizeFullName(document.getElementById('vedit-t-lastName').value) || splitT.lastName;

      updatedData = {
        fullName: cleanTFullName,
        employeeNo: (document.getElementById('vedit-t-empId').value || '').trim(),
        firstName: tFn,
        lastName: tLn,
        trackId: (document.getElementById('vedit-t-trackId').value || '').trim(),
        department: (document.getElementById('vedit-t-dept').value || '').trim(),
        designation: (document.getElementById('vedit-t-desig').value || '').trim(),
        gender: (document.getElementById('vedit-t-gender').value || 'unspecified'),
        email: (document.getElementById('vedit-t-email').value || '').trim(),
        username: (document.getElementById('vedit-t-username').value || '').trim()
      };
      var tchPw = (document.getElementById('vedit-t-password').value || '').trim();
      if (tchPw) updatedData.password = tchPw;
    } else {
      var genWrap = document.getElementById('vedit-generic-fields');
      if (genWrap) {
        var inputs = genWrap.querySelectorAll('input');
        inputs.forEach(function (inp) {
          if (inp.name) updatedData[inp.name] = inp.value.trim();
        });
      }
    }

    if (typeof root.showToast === 'function') root.showToast('Verifying and saving record details…');

    api.verifyEntry(batch._id, rowNumber, updatedData).then(function (res) {
      closeVerifyEditModal();
      if (typeof root.showToast === 'function') root.showToast('Row ' + rowNumber + ' verified!');

      // Update state batch row
      if (res.data && res.data.batch) {
        store.setState({ batch: res.data.batch });
      } else {
        var updatedRows = (batch.eligibleRows || []).map(function (r) {
          if (r.rowNumber === rowNumber) {
            return Object.assign({}, r, { isVerified: true, data: Object.assign({}, r.data, updatedData) });
          }
          return r;
        });
        store.setState({ batch: Object.assign({}, batch, { eligibleRows: updatedRows }) });
      }
    }).catch(function (err) {
      if (typeof root.showToast === 'function') root.showToast('Verification failed: ' + err.message, 'warn');
    });
  }

  function initInputs() {
    var nameEl = document.getElementById('vedit-name');
    if (nameEl) {
      nameEl.addEventListener('input', function () {
        var raw = nameEl.value;
        var stripped = raw.replace(/[.,\/\\;:_]+/g, ' ');
        if (stripped !== raw) {
          var cursor = nameEl.selectionStart;
          nameEl.value = stripped;
          if (cursor !== null) nameEl.setSelectionRange(cursor, cursor);
        }
        var clean = util.sanitizeFullName(stripped);
        var split = util.splitFirstLastName(clean);
        var fnEl = document.getElementById('vedit-firstName');
        var lnEl = document.getElementById('vedit-lastName');
        if (fnEl) fnEl.value = split.firstName;
        if (lnEl) lnEl.value = split.lastName;
      });
    }

    var regEl = document.getElementById('vedit-regNo');
    if (regEl) {
      regEl.addEventListener('input', function () {
        var regVal = regEl.value.trim();
        var deptSel = document.getElementById('vedit-dept');
        var deptId = deptSel ? deptSel.value : '';
        var batchSel = document.getElementById('vedit-batch');
        var batchVal = batchSel ? batchSel.value : '';
        var trackEl = document.getElementById('vedit-trackId');
        if (trackEl) {
          trackEl.value = util.computeStudentTrackId(regVal, deptId, batchVal, store.getState().cache.depts);
        }
      });
    }

    var deptSel = document.getElementById('vedit-dept');
    if (deptSel) {
      deptSel.addEventListener('change', function () {
        var opt = deptSel.options[deptSel.selectedIndex];
        var ctEl = document.getElementById('vedit-courseType');
        var brEl = document.getElementById('vedit-branch');
        if (opt) {
          if (ctEl) ctEl.value = opt.getAttribute('data-course-type') || 'UG';
          if (brEl) brEl.value = opt.getAttribute('data-branch') || opt.getAttribute('data-name') || '';
        }
        updateVEditClassList();
        var regVal = (document.getElementById('vedit-regNo').value || '').trim();
        var batchSel = document.getElementById('vedit-batch');
        var batchVal = batchSel ? batchSel.value : '';
        var trackEl = document.getElementById('vedit-trackId');
        if (trackEl && regVal) {
          trackEl.value = util.computeStudentTrackId(regVal, deptSel.value, batchVal, store.getState().cache.depts);
        }
      });
    }

    var batchSel = document.getElementById('vedit-batch');
    if (batchSel) {
      batchSel.addEventListener('change', function () {
        updateVEditClassList();
        var regVal = (document.getElementById('vedit-regNo').value || '').trim();
        var deptSel = document.getElementById('vedit-dept');
        var deptId = deptSel ? deptSel.value : '';
        var trackEl = document.getElementById('vedit-trackId');
        if (trackEl && regVal) {
          trackEl.value = util.computeStudentTrackId(regVal, deptId, batchSel.value, store.getState().cache.depts);
        }
      });
    }

    var emailEl = document.getElementById('vedit-email');
    if (emailEl) {
      emailEl.addEventListener('input', function () {
        var em = emailEl.value.trim();
        var uEl = document.getElementById('vedit-username');
        if (uEl) uEl.value = em ? em.split('@')[0].toLowerCase() : '';
      });
    }

    // Teacher listeners
    var tNameEl = document.getElementById('vedit-t-name');
    if (tNameEl) {
      tNameEl.addEventListener('input', function () {
        var raw = tNameEl.value;
        var stripped = raw.replace(/[.,\/\\;:_]+/g, ' ');
        if (stripped !== raw) {
          var cursor = tNameEl.selectionStart;
          tNameEl.value = stripped;
          if (cursor !== null) tNameEl.setSelectionRange(cursor, cursor);
        }
        var clean = util.sanitizeFullName(stripped);
        var split = util.splitFirstLastName(clean);
        var fnEl = document.getElementById('vedit-t-firstName');
        var lnEl = document.getElementById('vedit-t-lastName');
        if (fnEl) fnEl.value = split.firstName;
        if (lnEl) lnEl.value = split.lastName;
      });
    }

    var tEmpEl = document.getElementById('vedit-t-empId');
    if (tEmpEl) {
      tEmpEl.addEventListener('input', function () {
        var emp = tEmpEl.value.trim();
        var trackEl = document.getElementById('vedit-t-trackId');
        if (trackEl) trackEl.value = util.computeTeacherTrackId(emp);
      });
    }

    var tEmailEl = document.getElementById('vedit-t-email');
    if (tEmailEl) {
      tEmailEl.addEventListener('input', function () {
        var em = tEmailEl.value.trim();
        var uEl = document.getElementById('vedit-t-username');
        if (uEl) uEl.value = em ? em.split('@')[0].toLowerCase() : '';
      });
    }
  }

  function togglePwField(inputId, btn) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    if (btn) {
      btn.innerHTML = '<re-icon icon="' + (isPw ? 'eye-off' : 'eye') + '" size="16"></re-icon>';
      btn.title = isPw ? 'Hide password' : 'Show password';
    }
  }

  root.Bulk.openVerifyEditModal = openVerifyEditModal;
  root.Bulk.closeVerifyEditModal = closeVerifyEditModal;
  root.Bulk.submitVerifyEntry = submitVerifyEntry;
  root.Bulk.initVerifyModal = initInputs;
  root.Bulk.togglePwField = togglePwField;

  // Global functions for inline HTML handlers
  root.openVerifyEditModal = openVerifyEditModal;
  root.closeVerifyEditModal = closeVerifyEditModal;
  root.submitVerifyEntry = submitVerifyEntry;
  root.togglePwField = togglePwField;
})(window);
