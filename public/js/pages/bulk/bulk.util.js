/**
 * bulk.util.js
 * Utility functions for EAMS Bulk Operations Chat Interface.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatBytes(bytes, decimals) {
    if (!+bytes) return '0 Bytes';
    var k = 1024;
    var dm = decimals < 0 ? 0 : (decimals || 2);
    var sizes = ['Bytes', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  function fmtDate(d) {
    if (!d) return '';
    var date = new Date(d);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function timeAgo(date) {
    if (!date) return '';
    var d = new Date(date);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var diffMs = now - d;
    var diffSec = Math.floor(diffMs / 1000);
    var diffMin = Math.floor(diffSec / 60);
    var diffHr = Math.floor(diffMin / 60);
    var diffDays = Math.floor(diffHr / 24);

    if (diffSec < 45) return 'just now';
    if (diffMin < 60) return diffMin + 'm ago';
    if (diffHr < 24) return diffHr + 'h ago';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function debounce(func, wait) {
    var timeout;
    return function executedFunction() {
      var context = this;
      var args = arguments;
      var later = function () {
        timeout = null;
        func.apply(context, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function sanitizeFullName(raw) {
    if (!raw) return '';
    return String(raw)
      .replace(/[.,\/\\;:_]+/g, ' ')
      .replace(/[^A-Za-z0-9\s'-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitFirstLastName(rawName) {
    var clean = sanitizeFullName(rawName);
    var parts = clean.split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
      return { firstName: '', lastName: '', fullName: '' };
    }
    if (parts.length === 1) {
      return { firstName: parts[0], lastName: '', fullName: parts[0] };
    }
    if (parts.length === 2) {
      var firstIsInit = /^[A-Za-z]{1,2}$/.test(parts[0]);
      var lastIsInit = /^[A-Za-z]{1,2}$/.test(parts[1]);
      if (firstIsInit && !lastIsInit) {
        return { firstName: parts[1], lastName: parts[0], fullName: clean };
      }
      return { firstName: parts[0], lastName: parts[1], fullName: clean };
    }

    var last = parts[parts.length - 1];
    var secondLast = parts[parts.length - 2];
    var first = parts[0];

    var lastTwoInitials = /^[A-Za-z]{1,2}$/.test(last) && /^[A-Za-z]{1,2}$/.test(secondLast);
    var lastIsInitial = /^[A-Za-z]{1,2}$/.test(last);
    var firstIsInitial = /^[A-Za-z]{1,2}$/.test(first);

    if (lastTwoInitials) {
      return {
        firstName: parts.slice(0, -2).join(' '),
        lastName: parts.slice(-2).join(' '),
        fullName: clean
      };
    }
    if (lastIsInitial) {
      return {
        firstName: parts.slice(0, -1).join(' '),
        lastName: last,
        fullName: clean
      };
    }
    if (firstIsInitial) {
      return {
        firstName: parts.slice(1).join(' '),
        lastName: first,
        fullName: clean
      };
    }

    return {
      firstName: parts.slice(0, -1).join(' '),
      lastName: last,
      fullName: clean
    };
  }

  function computeStudentTrackId(regNo, deptIdOrObj, batchVal, deptsList) {
    var reg = String(regNo || '').replace(/\D/g, '');
    var yearCode = '';
    var deptNum = '';
    var roll = '';

    if (reg.length >= 12) {
      yearCode = reg.substring(4, 6);
      deptNum = reg.substring(6, 9);
      roll = reg.substring(9, 12);
    } else {
      var bParts = String(batchVal || '').split('-')[0].trim();
      yearCode = bParts ? bParts.slice(-2) : String(new Date().getFullYear()).slice(-2);
      roll = reg.slice(-3);
    }

    var matched = null;
    var depts = deptsList || [];
    if (deptIdOrObj && typeof deptIdOrObj === 'object') {
      matched = deptIdOrObj;
    } else if (deptIdOrObj) {
      var search = String(deptIdOrObj).toLowerCase().trim();
      matched = depts.find(function (d) {
        return (d._id && String(d._id) === String(deptIdOrObj)) ||
               (d.name && d.name.toLowerCase() === search) ||
               (d.code && d.code.toLowerCase() === search);
      });
    }
    if (!matched && deptNum) {
      matched = depts.find(function (d) { return d.number === deptNum; });
    }

    var twoCode = matched
      ? (matched.twoLetterCode || (matched.code ? matched.code.slice(0, 2) : ''))
      : '';
    if (!twoCode && deptNum) {
      var dByNum = depts.find(function (d) { return d.number === deptNum; });
      if (dByNum) twoCode = dByNum.twoLetterCode || (dByNum.code ? dByNum.code.slice(0, 2) : '');
    }

    if (!twoCode) {
      if (typeof deptIdOrObj === 'string' && deptIdOrObj.trim()) {
        twoCode = deptIdOrObj.trim().slice(0, 2);
      } else {
        twoCode = 'ST';
      }
    }

    if (yearCode && roll) {
      return 'TR' + yearCode + twoCode.toUpperCase() + String(roll).padStart(3, '0').slice(-3);
    }
    return reg ? ('TRSTU' + reg.slice(-6)) : '';
  }

  function computeTeacherTrackId(empId) {
    var raw = String(empId || '').replace(/[^A-Za-z0-9]/g, '');
    return raw ? ('TRTCH' + raw) : '';
  }

  root.Bulk.util = {
    esc: esc,
    escapeHtml: esc,
    formatBytes: formatBytes,
    fmtDate: fmtDate,
    timeAgo: timeAgo,
    debounce: debounce,
    sanitizeFullName: sanitizeFullName,
    splitFirstLastName: splitFirstLastName,
    computeStudentTrackId: computeStudentTrackId,
    computeTeacherTrackId: computeTeacherTrackId
  };

  // Global esc helper if missing
  if (typeof root.esc !== 'function') {
    root.esc = esc;
  }
})(window);
