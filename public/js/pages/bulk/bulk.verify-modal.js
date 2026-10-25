/**
 * bulk.verify-modal.js
 * Universal Verification modal handler with live dry-run checks, copy-to-all,
 * mail credentials setting awareness, and keyboard shortcuts (P5).
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var util = root.Bulk.util;
  var api = root.Bulk.api;
  var store = root.Bulk.store;

  var checkDebounceTimer = null;
  var lastCheckValid = false;

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

  function gatherFormData() {
    var state = store.getState();
    var batch = state.batch;
    if (!batch) return {};

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

      var rawName = (document.getElementById('vedit-name') ? document.getElementById('vedit-name').value : '') || '';
      var cleanFullName = util.sanitizeFullName(rawName);
      var split = util.splitFirstLastName(cleanFullName);
      var fn = (document.getElementById('vedit-firstName') ? util.sanitizeFullName(document.getElementById('vedit-firstName').value) : '') || split.firstName;
      var ln = (document.getElementById('vedit-lastName') ? util.sanitizeFullName(document.getElementById('vedit-lastName').value) : '') || split.lastName;

      updatedData = {
        fullName: cleanFullName,
        registerNo: (document.getElementById('vedit-regNo') ? document.getElementById('vedit-regNo').value : '').trim(),
        firstName: fn,
        lastName: ln,
        department: deptName,
        deptId: deptId || undefined,
        courseType: (document.getElementById('vedit-courseType') ? document.getElementById('vedit-courseType').value : '').trim(),
        branch: (document.getElementById('vedit-branch') ? document.getElementById('vedit-branch').value : '').trim(),
        trackId: (document.getElementById('vedit-trackId') ? document.getElementById('vedit-trackId').value : '').trim(),
        academicYear: (document.getElementById('vedit-year') ? document.getElementById('vedit-year').value : '').trim(),
        batch: (document.getElementById('vedit-batch') ? document.getElementById('vedit-batch').value : '').trim(),
        class: className,
        gender: (document.getElementById('vedit-gender') ? document.getElementById('vedit-gender').value : 'Male'),
        residency: (document.getElementById('vedit-residency') ? document.getElementById('vedit-residency').value : 'dayscholar'),
        email: (document.getElementById('vedit-email') ? document.getElementById('vedit-email').value : '').trim(),
        username: (document.getElementById('vedit-username') ? document.getElementById('vedit-username').value : '').trim()
      };
      var stuPw = (document.getElementById('vedit-password') ? document.getElementById('vedit-password').value : '').trim();
      if (stuPw) updatedData.password = stuPw;
    } else if (isTeacher) {
      var rawTName = (document.getElementById('vedit-t-name') ? document.getElementById('vedit-t-name').value : '') || '';
      var cleanTFullName = util.sanitizeFullName(rawTName);
      var splitT = util.splitFirstLastName(cleanTFullName);
      var tFn = (document.getElementById('vedit-t-firstName') ? util.sanitizeFullName(document.getElementById('vedit-t-firstName').value) : '') || splitT.firstName;
      var tLn = (document.getElementById('vedit-t-lastName') ? util.sanitizeFullName(document.getElementById('vedit-t-lastName').value) : '') || splitT.lastName;

      updatedData = {
        fullName: cleanTFullName,
        employeeNo: (document.getElementById('vedit-t-empId') ? document.getElementById('vedit-t-empId').value : '').trim(),
        firstName: tFn,
        lastName: tLn,
        trackId: (document.getElementById('vedit-t-trackId') ? document.getElementById('vedit-t-trackId').value : '').trim(),
        department: (document.getElementById('vedit-t-dept') ? document.getElementById('vedit-t-dept').value : '').trim(),
        designation: (document.getElementById('vedit-t-desig') ? document.getElementById('vedit-t-desig').value : '').trim(),
        gender: (document.getElementById('vedit-t-gender') ? document.getElementById('vedit-t-gender').value : 'unspecified'),
        email: (document.getElementById('vedit-t-email') ? document.getElementById('vedit-t-email').value : '').trim(),
        username: (document.getElementById('vedit-t-username') ? document.getElementById('vedit-t-username').value : '').trim()
      };
      var tchPw = (document.getElementById('vedit-t-password') ? document.getElementById('vedit-t-password').value : '').trim();
      if (tchPw) updatedData.password = tchPw;
    } else if (batch.type === 'class') {
      var cDeptEl = document.getElementById('vedit-class-dept');
      var cBatchEl = document.getElementById('vedit-class-batch');
      var cSemEl = document.getElementById('vedit-class-sem');
      var cHallEl = document.getElementById('vedit-class-hall');
      var cNameEl = document.getElementById('vedit-class-name');
      var cYearEl = document.getElementById('vedit-class-year');
      var cAdvEl = document.getElementById('vedit-class-advisor');

      var deptVal = cDeptEl ? cDeptEl.value.trim() : '';
      var batchVal = cBatchEl ? cBatchEl.value.trim() : '';
      var semVal = cSemEl ? cSemEl.value.trim() : 'I';
      var hallVal = cHallEl ? cHallEl.value.trim() : '';
      var yearVal = cYearEl ? cYearEl.value.trim() : 'I Year';
      var explicitName = cNameEl ? cNameEl.value.trim() : '';

      var cache = (store.getState() && store.getState().cache) || {};
      var matchedDept = (cache.depts || []).find(function (d) {
        return (d.code && d.code.toLowerCase() === deptVal.toLowerCase()) ||
               (d.name && d.name.toLowerCase() === deptVal.toLowerCase()) ||
               (d._id && String(d._id) === String(deptVal));
      });

      var shortBatch = '';
      if (batchVal && batchVal.includes('-')) {
        var parts = batchVal.split('-');
        shortBatch = parts[0].slice(-2) + '-' + parts[1].slice(-2);
      }
      var autoClassName = explicitName || (shortBatch ? (shortBatch + ' ' + (matchedDept ? matchedDept.code : deptVal)) : deptVal);

      updatedData = {
        department: matchedDept ? matchedDept.name : deptVal,
        deptName: matchedDept ? matchedDept.name : deptVal,
        deptCode: matchedDept ? matchedDept.code : deptVal,
        deptId: matchedDept ? matchedDept._id : undefined,
        batch: batchVal,
        sem: semVal,
        semester: semVal,
        hallNo: hallVal,
        name: autoClassName,
        className: autoClassName,
        year: yearVal,
        advisor: cAdvEl ? cAdvEl.value.trim() : ''
      };
    } else if (batch.type === 'dept') {
      var dNameEl = document.getElementById('vedit-dept-name');
      var dCodeEl = document.getElementById('vedit-dept-code');
      var dNumEl = document.getElementById('vedit-dept-number');
      var dCtEl = document.getElementById('vedit-dept-courseType');
      var dBrEl = document.getElementById('vedit-dept-branch');
      var dCatEl = document.getElementById('vedit-dept-category');

      updatedData = {
        name: dNameEl ? dNameEl.value.trim() : '',
        code: dCodeEl ? dCodeEl.value.trim().toUpperCase() : '',
        number: dNumEl ? dNumEl.value.trim() : '',
        courseType: dCtEl ? dCtEl.value.trim() : 'UG',
        branch: dBrEl ? dBrEl.value.trim() : 'B.E',
        category: dCatEl ? dCatEl.value.trim() : 'programme'
      };
    } else {
      var genWrap = document.getElementById('vedit-generic-fields');
      if (genWrap) {
        var fields = genWrap.querySelectorAll('input, select');
        fields.forEach(function (f) {
          if (f.name) updatedData[f.name] = f.value.trim();
        });
      }
    }

    return updatedData;
  }

  function runDryRunCheck() {
    var state = store.getState();
    var batch = state.batch;
    if (!batch) return;

    var rowNumEl = document.getElementById('vedit-row-number');
    var rowNumber = rowNumEl ? parseInt(rowNumEl.value, 10) : NaN;
    if (isNaN(rowNumber)) return;

    var badge = document.getElementById('vedit-checks-badge');
    if (badge) {
      badge.textContent = 'Checking…';
      badge.className = 'vedit-checks-badge checking';
    }

    var updatedData = gatherFormData();

    if (!api || typeof api.checkVerifyEntry !== 'function') {
      lastCheckValid = true;
      updateSubmitButtonState();
      return;
    }

    api.checkVerifyEntry(batch._id, rowNumber, updatedData).then(function (res) {
      lastCheckValid = Boolean(res.valid);

      var listEl = document.getElementById('vedit-checks-list');
      if (listEl) {
        if (Array.isArray(res.checks) && res.checks.length > 0) {
          listEl.innerHTML = res.checks.map(function (c) {
            var icon = c.valid ? (c.issue === 'typo' ? '⚠' : '✓') : '✗';
            var cls = c.valid ? (c.issue === 'typo' ? 'typo' : 'ok') : 'bad';
            return '<div class="vedit-check-item ' + cls + '">' +
              '<span class="vedit-check-icon">' + icon + '</span>' +
              '<span>' + util.esc(c.message) + '</span>' +
            '</div>';
          }).join('');
        } else {
          listEl.innerHTML = '<div class="vedit-check-item ok"><span class="vedit-check-icon">✓</span> <span>All fields valid</span></div>';
        }
      }

      var diffSec = document.getElementById('vedit-diffs-section');
      var diffList = document.getElementById('vedit-diffs-list');
      if (diffSec && diffList) {
        if (Array.isArray(res.diffs) && res.diffs.length > 0) {
          diffSec.style.display = 'block';
          diffList.innerHTML = res.diffs.map(function (d) {
            return '<span class="vedit-diff-chip">✎ ' + util.esc(d.field) + ': ' + util.esc(d.oldVal || 'empty') + ' &rarr; ' + util.esc(d.newVal) + '</span>';
          }).join(' ');
        } else {
          diffSec.style.display = 'none';
          diffList.innerHTML = '';
        }
      }

      if (badge) {
        if (res.valid) {
          badge.textContent = 'Valid';
          badge.className = 'vedit-checks-badge ok';
        } else {
          badge.textContent = 'Issues found';
          badge.className = 'vedit-checks-badge bad';
        }
      }

      updateSubmitButtonState();
    }).catch(function (err) {
      if (badge) {
        badge.textContent = 'Error';
        badge.className = 'vedit-checks-badge bad';
      }
    });
  }

  function updateSubmitButtonState() {
    var btn = document.getElementById('btn-submit-verify');
    if (!btn) return;
    btn.disabled = !lastCheckValid;
  }

  function scheduleDryRunCheck() {
    if (checkDebounceTimer) clearTimeout(checkDebounceTimer);
    checkDebounceTimer = setTimeout(runDryRunCheck, 220);
  }

  function openVerifyEditModal(rowNumber) {
    var state = store.getState();
    var batch = state.batch;
    var cache = state.cache || {};
    var caps = root.Bulk.caps || state.caps || {};
    var flags = caps.flags || {};
    var mailCredentials = flags.mailCredentials !== false;

    if (!batch || !batch.eligibleRows) return;

    var entry = batch.eligibleRows.find(function (r) { return r.rowNumber === rowNumber; });
    if (!entry) return;

    var isTeacher = batch.type === 'teacher';
    var isStudent = batch.type === 'student';
    var isUserType = isTeacher || isStudent;
    var d = entry.data || {};

    var rowNumEl = document.getElementById('vedit-row-number');
    if (rowNumEl) rowNumEl.value = rowNumber;

    // Subtitle computation
    var doneCount = (batch.eligibleRows || []).filter(function (r) { return r.isVerified; }).length;
    var pendingRows = (batch.eligibleRows || []).filter(function (r) { return !r.isVerified; });
    var pendingIdx = pendingRows.findIndex(function (r) { return r.rowNumber === rowNumber; });
    var subText = 'Row ' + (pendingIdx >= 0 ? (pendingIdx + 1) : 1) + ' of ' + pendingRows.length + ' pending · ' + doneCount + ' done';

    var stuSection = document.getElementById('vedit-student-section');
    var tchSection = document.getElementById('vedit-teacher-section');
    var genSection = document.getElementById('vedit-generic-section');
    var titleEl = document.getElementById('verify-edit-title');
    var subEl = document.getElementById('verify-edit-subtitle');
    var submitLabelEl = document.getElementById('vedit-submit-label');
    var mailNotice = document.getElementById('vedit-mail-notice');
    var mailNoticeText = document.getElementById('vedit-mail-notice-text');
    var confirmTick = document.getElementById('vedit-confirm-tick');
    var confirmText = document.getElementById('vedit-confirm-text');

    if (subEl) subEl.textContent = subText;
    if (confirmTick) confirmTick.checked = false;

    // Configure labels & notices per setting
    if (isUserType) {
      if (mailNotice) mailNotice.style.display = 'flex';
      if (mailCredentials) {
        if (submitLabelEl) submitLabelEl.textContent = 'Verify & Mail Credentials  ⏎';
        if (mailNoticeText) {
          mailNoticeText.innerHTML = '<b>Automated Credential Email:</b> Clicking "Verify &amp; Mail Credentials" confirms this record and dispatches credentials to their registered email address.';
        }
      } else {
        if (submitLabelEl) submitLabelEl.textContent = 'Verify Details  ⏎';
        if (mailNoticeText) {
          mailNoticeText.innerHTML = '<b>Credentials Mailing Disabled:</b> In accordance with system settings, no email will be dispatched. You must set or keep a password for this record.';
        }
      }
    } else {
      if (mailNotice) mailNotice.style.display = 'none';
      if (submitLabelEl) submitLabelEl.textContent = 'Save Details  ⏎';
    }

    if (confirmText) {
      if (isStudent) {
        confirmText.textContent = 'I have checked name, register number, department, class and credentials';
      } else if (isTeacher) {
        confirmText.textContent = 'I have checked name, employee ID, department and credentials';
      } else {
        confirmText.textContent = 'I have checked all details for this ' + (batch.type || 'record');
      }
    }

    if (isStudent) {
      if (stuSection) stuSection.style.display = 'block';
      if (tchSection) tchSection.style.display = 'none';
      if (genSection) genSection.style.display = 'none';

      if (titleEl) titleEl.innerHTML = '<re-icon icon="graduation-cap" size="18"></re-icon> Student Details Verification';

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
      var pwLabel = document.getElementById('vedit-pw-label');
      if (passEl) {
        passEl.value = '';
        passEl.placeholder = mailCredentials ? 'Keep uploaded password (or auto-generate)' : 'Enter password (Required)';
      }
      if (pwLabel) {
        pwLabel.textContent = mailCredentials ? 'Initial Password' : 'Set Password *';
      }

    } else if (isTeacher) {
      if (stuSection) stuSection.style.display = 'none';
      if (tchSection) tchSection.style.display = 'block';
      if (genSection) genSection.style.display = 'none';

      if (titleEl) titleEl.innerHTML = '<re-icon icon="teacher" size="18"></re-icon> Teacher Details Verification';

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
      var tPwLabel = document.getElementById('vedit-t-pw-label');
      if (tPassEl) {
        tPassEl.value = '';
        tPassEl.placeholder = mailCredentials ? 'Keep uploaded password (or auto-generate)' : 'Enter password (Required)';
      }
      if (tPwLabel) {
        tPwLabel.textContent = mailCredentials ? 'Password' : 'Set Password *';
      }

    } else if (batch.type === 'dept') {
      if (stuSection) stuSection.style.display = 'none';
      if (tchSection) tchSection.style.display = 'none';
      if (genSection) genSection.style.display = 'block';

      if (titleEl) titleEl.innerHTML = '<re-icon icon="building2" size="18"></re-icon> Department Details Verification';

      var genWrap = document.getElementById('vedit-generic-fields');
      if (genWrap) {
        var standardDepts = [
          'Computer Science & Engineering',
          'Electronics & Communication Engineering',
          'Electrical & Electronics Engineering',
          'Mechanical Engineering',
          'Civil Engineering',
          'Information Technology',
          'Artificial Intelligence & Data Science',
          'Science & Humanities',
          'Biomedical Engineering',
          'Chemical Engineering',
          'Biotechnology',
          'Aeronautical Engineering',
          'Mechatronics Engineering',
          'Master of Business Administration',
          'Master of Computer Applications'
        ];
        (cache.depts || []).forEach(function (dept) {
          if (dept.name && !standardDepts.some(function (s) { return s.toLowerCase() === dept.name.toLowerCase(); })) {
            standardDepts.push(dept.name);
          }
        });
        var curName = (d.name || d.deptName || '').trim();
        if (curName && !standardDepts.some(function (s) { return s.toLowerCase() === curName.toLowerCase(); })) {
          standardDepts.unshift(curName);
        }

        var curCourseType = (d.courseType || 'UG').toUpperCase();
        var curBranch = (d.branch || 'B.E').toUpperCase();
        var curCat = String(d.category || '').toLowerCase().includes('supp') ? 'supporting' : 'programme';
        var curCode = (d.code || d.deptCode || '').toUpperCase();
        var curNum = d.number || d.deptNumber || '';

        var html = '';
        // Row 1: Name only (full width)
        html += '<div class="fg" style="grid-column: 1 / -1;">' +
          '<label class="fl">Department Name <span style="color:var(--red);">*</span></label>' +
          '<select class="fc2" name="name" id="vedit-dept-name">' +
            '<option value="">— Select Department Name —</option>' +
            standardDepts.map(function (nm) {
              var isSel = curName && nm.toLowerCase() === curName.toLowerCase();
              return '<option value="' + util.esc(nm) + '"' + (isSel ? ' selected' : '') + '>' + util.esc(nm) + '</option>';
            }).join('') +
          '</select>' +
        '</div>';

        // Row 2: Code & Number
        html += '<div class="fg">' +
          '<label class="fl">Department Code <span style="color:var(--red);">*</span></label>' +
          '<input type="text" class="fc2" name="code" id="vedit-dept-code" value="' + util.esc(curCode) + '" placeholder="e.g. CSE" maxlength="10" style="text-transform:uppercase;">' +
        '</div>' +
        '<div class="fg">' +
          '<label class="fl">Department Number <span style="color:var(--red);">*</span></label>' +
          '<input type="text" class="fc2" name="number" id="vedit-dept-number" value="' + util.esc(curNum) + '" placeholder="e.g. 104">' +
        '</div>';

        // Row 3: Course Type & Branch (with copy-to-all)
        html += '<div class="fg">' +
          '<div class="fl-row" style="display:flex;justify-content:space-between;align-items:center;">' +
            '<label class="fl" style="margin-bottom:0;">Course Type <span style="color:var(--red);">*</span></label>' +
            '<button type="button" class="btn-copy-all" data-field="courseType" title="Copy course type to all unverified rows">⧉ Copy to all</button>' +
          '</div>' +
          '<select class="fc2" name="courseType" id="vedit-dept-courseType" style="margin-top:4px;">' +
            '<option value="UG"' + (curCourseType === 'UG' ? ' selected' : '') + '>UG</option>' +
            '<option value="PG"' + (curCourseType === 'PG' ? ' selected' : '') + '>PG</option>' +
            '<option value="None"' + (curCourseType === 'None' ? ' selected' : '') + '>None (Supporting Dept)</option>' +
          '</select>' +
        '</div>' +
        '<div class="fg">' +
          '<div class="fl-row" style="display:flex;justify-content:space-between;align-items:center;">' +
            '<label class="fl" style="margin-bottom:0;">Branch <span style="color:var(--red);">*</span></label>' +
            '<button type="button" class="btn-copy-all" data-field="branch" title="Copy branch to all unverified rows">⧉ Copy to all</button>' +
          '</div>' +
          '<select class="fc2" name="branch" id="vedit-dept-branch" style="margin-top:4px;">' +
            ['B.E', 'B.TECH', 'M.E', 'M.TECH', 'None', 'N/A'].map(function (br) {
              return '<option value="' + br + '"' + (br === curBranch ? ' selected' : '') + '>' + br + '</option>';
            }).join('') +
          '</select>' +
        '</div>';

        // Row 4: Category (with copy-to-all)
        html += '<div class="fg">' +
          '<div class="fl-row" style="display:flex;justify-content:space-between;align-items:center;">' +
            '<label class="fl" style="margin-bottom:0;">Category <span style="color:var(--red);">*</span></label>' +
            '<button type="button" class="btn-copy-all" data-field="category" title="Copy category to all unverified rows">⧉ Copy to all</button>' +
          '</div>' +
          '<select class="fc2" name="category" id="vedit-dept-category" style="margin-top:4px;">' +
            '<option value="programme"' + (curCat === 'programme' ? ' selected' : '') + '>Programme</option>' +
            '<option value="supporting"' + (curCat === 'supporting' ? ' selected' : '') + '>Supporting</option>' +
          '</select>' +
        '</div>';

        genWrap.innerHTML = html;

        // Auto-uppercase code on input
        var codeInp = document.getElementById('vedit-dept-code');
        if (codeInp) {
          codeInp.addEventListener('input', function () {
            codeInp.value = codeInp.value.toUpperCase().replace(/[^A-Z0-9&_-]/g, '');
          });
        }

        // Auto-abbreviation map for dept name selection
        var nameSel = document.getElementById('vedit-dept-name');
        if (nameSel) {
          nameSel.addEventListener('change', function () {
            var selectedVal = nameSel.value;
            var cInp = document.getElementById('vedit-dept-code');
            if (cInp && !cInp.value.trim() && selectedVal) {
              var abbrMap = {
                'computer science & engineering': 'CSE',
                'electronics & communication engineering': 'ECE',
                'electrical & electronics engineering': 'EEE',
                'mechanical engineering': 'MECH',
                'civil engineering': 'CIVIL',
                'information technology': 'IT',
                'artificial intelligence & data science': 'AIDS',
                'science & humanities': 'S&H',
                'biomedical engineering': 'BME',
                'chemical engineering': 'CHEM',
                'biotechnology': 'BIOTECH',
                'aeronautical engineering': 'AERO',
                'mechatronics engineering': 'MCT',
                'master of business administration': 'MBA',
                'master of computer applications': 'MCA'
              };
              var match = abbrMap[selectedVal.toLowerCase()];
              if (match) cInp.value = match;
            }
          });
        }

        // CourseType to branch sync helper
        var ctSel = document.getElementById('vedit-dept-courseType');
        var brSel = document.getElementById('vedit-dept-branch');
        if (ctSel && brSel) {
          ctSel.addEventListener('change', function () {
            var ct = ctSel.value;
            if (ct === 'PG' && (brSel.value === 'B.E' || brSel.value === 'B.TECH')) {
              brSel.value = 'M.E';
            } else if (ct === 'None') {
              brSel.value = 'None';
            } else if (ct === 'UG' && (brSel.value === 'M.E' || brSel.value === 'M.TECH' || brSel.value === 'None')) {
              brSel.value = 'B.E';
            }
          });
        }
      }
    } else if (batch.type === 'class') {
      if (stuSection) stuSection.style.display = 'none';
      if (tchSection) tchSection.style.display = 'none';
      if (genSection) genSection.style.display = 'block';

      if (titleEl) titleEl.innerHTML = '<re-icon icon="book" size="18"></re-icon> Class Details Verification';

      var genWrap = document.getElementById('vedit-generic-fields');
      if (genWrap) {
        var curDept = (d.department || d.deptName || d.deptCode || d.dept || '').trim();
        var curBatch = (d.batch || '').trim();
        var curSem = (d.sem || d.semester || 'I').trim();
        var curHall = (d.hallNo || d.hall || d.room || '').trim();
        var curYear = (d.year || 'I Year').trim();
        var curName = (d.name || d.className || '').trim();
        var curAdvisor = (d.advisor || d.advisorTeacherName || '').trim();

        var html = '';
        // Row 1: Department & Batch
        html += '<div class="fg">' +
          '<div class="fl-row" style="display:flex;justify-content:space-between;align-items:center;">' +
            '<label class="fl" style="margin-bottom:0;">Department <span style="color:var(--red);">*</span></label>' +
            '<button type="button" class="btn-copy-all" data-field="department" title="Copy department to all unverified rows">⧉ Copy to all</button>' +
          '</div>' +
          '<select class="fc2" name="department" id="vedit-class-dept" style="margin-top:4px;">' +
            '<option value="">— Select Department —</option>' +
            (cache.depts || []).map(function(dept) {
              var isSel = (curDept && (dept.name.toLowerCase() === curDept.toLowerCase() || dept.code.toLowerCase() === curDept.toLowerCase()));
              return '<option value="' + util.esc(dept.name) + '"' + (isSel ? ' selected' : '') + '>' + util.esc(dept.name) + ' (' + util.esc(dept.code) + ')</option>';
            }).join('') +
            (curDept && !(cache.depts || []).some(function(dept){ return dept.name.toLowerCase() === curDept.toLowerCase() || dept.code.toLowerCase() === curDept.toLowerCase(); }) ? '<option value="' + util.esc(curDept) + '" selected>' + util.esc(curDept) + '</option>' : '') +
          '</select>' +
        '</div>';

        html += '<div class="fg">' +
          '<div class="fl-row" style="display:flex;justify-content:space-between;align-items:center;">' +
            '<label class="fl" style="margin-bottom:0;">Batch <span style="color:var(--red);">*</span></label>' +
            '<button type="button" class="btn-copy-all" data-field="batch" title="Copy batch to all unverified rows">⧉ Copy to all</button>' +
          '</div>' +
          '<select class="fc2" name="batch" id="vedit-class-batch" style="margin-top:4px;">' +
            '<option value="">— Select Batch —</option>' +
            (cache.batches || []).map(function(b) {
              return '<option value="' + util.esc(b) + '"' + (curBatch === b ? ' selected' : '') + '>' + util.esc(b) + '</option>';
            }).join('') +
            (curBatch && !(cache.batches || []).includes(curBatch) ? '<option value="' + util.esc(curBatch) + '" selected>' + util.esc(curBatch) + '</option>' : '') +
          '</select>' +
        '</div>';

        // Row 2: Semester & Hall
        html += '<div class="fg">' +
          '<div class="fl-row" style="display:flex;justify-content:space-between;align-items:center;">' +
            '<label class="fl" style="margin-bottom:0;">Semester <span style="color:var(--red);">*</span></label>' +
            '<button type="button" class="btn-copy-all" data-field="sem" title="Copy semester to all unverified rows">⧉ Copy to all</button>' +
          '</div>' +
          '<select class="fc2" name="sem" id="vedit-class-sem" style="margin-top:4px;">' +
            ['I','II','III','IV','V','VI','VII','VIII'].map(function(s) {
              return '<option value="' + s + '"' + (curSem.toUpperCase() === s ? ' selected' : '') + '>Semester ' + s + '</option>';
            }).join('') +
          '</select>' +
        '</div>';

        html += '<div class="fg">' +
          '<div class="fl-row" style="display:flex;justify-content:space-between;align-items:center;">' +
            '<label class="fl" style="margin-bottom:0;">Hall / Room No <span style="color:var(--red);">*</span></label>' +
            '<button type="button" class="btn-copy-all" data-field="hallNo" title="Copy hall number to all unverified rows">⧉ Copy to all</button>' +
          '</div>' +
          '<input type="text" class="fc2" name="hallNo" id="vedit-class-hall" value="' + util.esc(curHall) + '" placeholder="e.g. LH-301" style="margin-top:4px;">' +
        '</div>';

        // Row 3: Class Name & Year
        html += '<div class="fg">' +
          '<label class="fl">Class Name <span class="auto-txt">(optional)</span></label>' +
          '<input type="text" class="fc2" name="name" id="vedit-class-name" value="' + util.esc(curName) + '" placeholder="e.g. 25-29 CSE or CSE-A">' +
        '</div>';

        html += '<div class="fg">' +
          '<div class="fl-row" style="display:flex;justify-content:space-between;align-items:center;">' +
            '<label class="fl" style="margin-bottom:0;">Student Year</label>' +
            '<button type="button" class="btn-copy-all" data-field="year" title="Copy year to all unverified rows">⧉ Copy to all</button>' +
          '</div>' +
          '<select class="fc2" name="year" id="vedit-class-year" style="margin-top:4px;">' +
            ['I Year', 'II Year', 'III Year', 'IV Year'].map(function(y) {
              return '<option value="' + y + '"' + (curYear.toLowerCase() === y.toLowerCase() ? ' selected' : '') + '>' + y + '</option>';
            }).join('') +
          '</select>' +
        '</div>';

        // Row 4: Advisor
        html += '<div class="fg" style="grid-column: 1 / -1;">' +
          '<div class="fl-row" style="display:flex;justify-content:space-between;align-items:center;">' +
            '<label class="fl" style="margin-bottom:0;">Class Advisor Teacher <span class="auto-txt">(optional)</span></label>' +
            '<button type="button" class="btn-copy-all" data-field="advisor" title="Copy advisor to all unverified rows">⧉ Copy to all</button>' +
          '</div>' +
          '<input type="text" class="fc2" name="advisor" id="vedit-class-advisor" value="' + util.esc(curAdvisor) + '" placeholder="Teacher name or Employee ID" style="margin-top:4px;">' +
        '</div>';

        genWrap.innerHTML = html;
      }
    } else {
      // Generic fallback (dept / class / subject)
      if (stuSection) stuSection.style.display = 'none';
      if (tchSection) tchSection.style.display = 'none';
      if (genSection) genSection.style.display = 'block';

      if (titleEl) titleEl.innerHTML = '<re-icon icon="edit-3" size="18"></re-icon> ' + (batch.type ? batch.type.toUpperCase() : 'RECORD') + ' Details Verification';

      var genWrap = document.getElementById('vedit-generic-fields');
      if (genWrap) {
        genWrap.innerHTML = Object.keys(d).map(function (k) {
          return '<div class="fg"><label class="fl">' + util.esc(k) + '</label><input type="text" class="fc2" name="' + util.esc(k) + '" value="' + util.esc(d[k] || '') + '"></div>';
        }).join('');
      }
    }

    // Navigation buttons state
    var curIdx = (batch.eligibleRows || []).findIndex(function (r) { return r.rowNumber === rowNumber; });
    var btnPrev = document.getElementById('btn-verify-prev');
    var btnSkip = document.getElementById('btn-verify-skip');
    if (btnPrev) btnPrev.disabled = curIdx <= 0;
    if (btnSkip) btnSkip.disabled = curIdx >= (batch.eligibleRows.length - 1);

    var modal = document.getElementById('bulk-verify-edit-modal');
    if (modal) modal.classList.add('open');

    // Run initial dry-run check
    runDryRunCheck();
  }

  function closeVerifyEditModal() {
    var modal = document.getElementById('bulk-verify-edit-modal');
    if (modal) modal.classList.remove('open');
  }

  function navVerifyRow(delta) {
    var state = store.getState();
    var batch = state.batch;
    if (!batch || !batch.eligibleRows) return;

    var rowNumEl = document.getElementById('vedit-row-number');
    var curRowNumber = rowNumEl ? parseInt(rowNumEl.value, 10) : NaN;
    var curIdx = batch.eligibleRows.findIndex(function (r) { return r.rowNumber === curRowNumber; });
    if (curIdx === -1) return;

    var targetIdx = curIdx + delta;
    if (targetIdx >= 0 && targetIdx < batch.eligibleRows.length) {
      openVerifyEditModal(batch.eligibleRows[targetIdx].rowNumber);
    }
  }

  function submitVerifyEntry() {
    var rowNumber = parseInt(document.getElementById('vedit-row-number').value, 10);
    if (isNaN(rowNumber)) return;

    var state = store.getState();
    var batch = state.batch;
    if (!batch) return;

    var updatedData = gatherFormData();

    var btnSubmit = document.getElementById('btn-submit-verify');
    if (btnSubmit) btnSubmit.disabled = true;

    if (typeof root.showToast === 'function') root.showToast('Verifying and saving record details…');

    api.verifyEntry(batch._id, rowNumber, updatedData).then(function (res) {
      var isMailed = res.mail && res.mail.mode === 'sent';
      var toastMsg = 'Row ' + rowNumber + ' verified!' + (isMailed ? ' Credentials mailed to ' + res.mail.to : '');
      if (typeof root.showToast === 'function') root.showToast(toastMsg);

      // Update state batch row
      var updatedRows = (batch.eligibleRows || []).map(function (r) {
        if (r.rowNumber === rowNumber) {
          return Object.assign({}, r, { isVerified: true, data: Object.assign({}, r.data, updatedData) });
        }
        return r;
      });
      var updatedBatch = Object.assign({}, batch, {
        eligibleRows: updatedRows,
        verifiedCount: res.verifiedCount || updatedRows.filter(function (r) { return r.isVerified; }).length
      });
      store.setState({ batch: updatedBatch });

      // Auto-advance to next pending row
      var nextPending = updatedRows.find(function (r) { return r.rowNumber > rowNumber && !r.isVerified; }) ||
                        updatedRows.find(function (r) { return !r.isVerified; });

      if (nextPending) {
        openVerifyEditModal(nextPending.rowNumber);
      } else {
        closeVerifyEditModal();
        if (typeof root.showToast === 'function') root.showToast('All records verified!');
        if (typeof root.Bulk.openChat === 'function') root.Bulk.openChat(batch._id);
      }
    }).catch(function (err) {
      if (btnSubmit) btnSubmit.disabled = false;
      if (typeof root.showToast === 'function') root.showToast('Verification failed: ' + err.message, 'warn');
    });
  }

  function initInputs() {
    var modal = document.getElementById('bulk-verify-edit-modal');
    if (!modal) return;

    // Listen for form changes to trigger debounced dry-run checks
    modal.addEventListener('input', function (e) {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
        scheduleDryRunCheck();
      }
    });

    modal.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'vedit-confirm-tick') {
        updateSubmitButtonState();
      } else if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
        scheduleDryRunCheck();
      }
    });

    // Copy to all delegation
    modal.addEventListener('click', function (e) {
      var copyBtn = e.target.closest('.btn-copy-all');
      if (!copyBtn) return;
      e.preventDefault();

      var field = copyBtn.getAttribute('data-field');
      var state = store.getState();
      var batch = state.batch;
      if (!batch || !field) return;

      var rowNumEl = document.getElementById('vedit-row-number');
      var rowNumber = rowNumEl ? parseInt(rowNumEl.value, 10) : NaN;

      var formData = gatherFormData();
      var val = formData[field];
      if (val === undefined || val === null || String(val).trim() === '') {
        if (typeof root.showToast === 'function') root.showToast('Please select or enter a value for ' + field + ' first.', 'warn');
        return;
      }

      var confFn = (typeof root.Bulk?.util?.safeConfirm === 'function') ? root.Bulk.util.safeConfirm :
                   (typeof root.confirmModal === 'function') ? root.confirmModal : window.confirm;

      var promptMsg = 'Apply ' + field + ' = "' + val + '" to all remaining unverified records?';
      Promise.resolve(confFn(promptMsg)).then(function (ok) {
        if (!ok) return;
        copyBtn.disabled = true;

        api.copyToAll(batch._id, field, val, rowNumber).then(function (res) {
          copyBtn.disabled = false;
          var msg = 'Copied ' + field + ' to ' + res.changed + ' records.';
          if (res.skipped && res.skipped.length > 0) {
            msg += ' (' + res.skipped.length + ' skipped)';
          }
          if (typeof root.showToast === 'function') root.showToast(msg);

          // Update in store state
          var updatedRows = (batch.eligibleRows || []).map(function (r) {
            if (!r.isVerified && r.rowNumber !== rowNumber) {
              return Object.assign({}, r, { data: Object.assign({}, r.data, { [field]: val }) });
            }
            return r;
          });
          store.setState({ batch: Object.assign({}, batch, { eligibleRows: updatedRows }) });
          scheduleDryRunCheck();
        }).catch(function (err) {
          copyBtn.disabled = false;
          if (typeof root.showToast === 'function') root.showToast('Copy failed: ' + err.message, 'warn');
        });
      });
    });

    // Keyboard navigation (Enter = verify & next, Esc = close)
    window.addEventListener('keydown', function (e) {
      var m = document.getElementById('bulk-verify-edit-modal');
      if (!m || !m.classList.contains('open')) return;

      if (e.key === 'Escape') {
        closeVerifyEditModal();
      } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
        var activeTag = document.activeElement ? document.activeElement.tagName : '';
        if (activeTag === 'TEXTAREA') return;
        var btnSubmit = document.getElementById('btn-submit-verify');
        if (btnSubmit && !btnSubmit.disabled) {
          e.preventDefault();
          submitVerifyEntry();
        }
      }
    });

    // Name sanitization & split listeners
    var nameEl = document.getElementById('vedit-name');
    if (nameEl) {
      nameEl.addEventListener('input', function () {
        var raw = nameEl.value;
        var stripped = raw.replace(/[.,/\;:_]+/g, ' ');
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
        var stripped = raw.replace(/[.,/\;:_]+/g, ' ');
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
  root.Bulk.navVerifyRow = navVerifyRow;
  root.Bulk.submitVerifyEntry = submitVerifyEntry;
  root.Bulk.initVerifyModal = initInputs;
  root.Bulk.togglePwField = togglePwField;

  // Global exports for inline HTML onclick handlers
  root.openVerifyEditModal = openVerifyEditModal;
  root.closeVerifyEditModal = closeVerifyEditModal;
  root.submitVerifyEntry = submitVerifyEntry;
  root.togglePwField = togglePwField;
})(window);
