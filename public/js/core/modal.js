/**
 * public/js/core/modal.js
 * Electronic Attendance Management System (EAMS)
 * Core Modal Subsystem - Accessible, Focus-Trapped, Scroll-Locked & Animated (C10)
 */

var _modalStack = [];

function isModalDirty(modalEl) {
  return false;
}

function openModal(id, openerEl) {
  var el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;

  // Save previous active element for focus restoration (C10)
  el._prevActiveElement = openerEl || document.activeElement;

  // Accessibility attributes
  var dialogBox = el.querySelector('.modal') || el;
  if (!dialogBox.getAttribute('role')) dialogBox.setAttribute('role', 'dialog');
  dialogBox.setAttribute('aria-modal', 'true');

  var titleEl = el.querySelector('.modal-title') || el.querySelector('.modal-hd');
  if (titleEl) {
    if (!titleEl.id) titleEl.id = 'modal-title-' + (el.id || Math.random().toString(36).slice(2, 7));
    if (!dialogBox.getAttribute('aria-labelledby')) dialogBox.setAttribute('aria-labelledby', titleEl.id);
  }

  el.style.display = 'flex';
  requestAnimationFrame(function () {
    el.classList.add('open');
  });

  // Body scroll lock
  if (document.body) {
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
  }

  if (!_modalStack.includes(el)) {
    _modalStack.push(el);
  }

  // Focus trap: auto-focus first focusable element
  setTimeout(function () {
    var focusable = el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (focusable.length > 0) {
      var firstInput = el.querySelector('input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
      if (firstInput && !firstInput.readOnly) {
        firstInput.focus();
      } else {
        focusable[0].focus();
      }
    }
  }, 60);
}
var om = openModal;

function closeModal(id, force) {
  var el = typeof id === 'string' ? document.getElementById(id) : id;
  if (!el) return;

  el.classList.remove('open');
  el.style.display = 'none';

  // Remove from stack
  _modalStack = _modalStack.filter(function (m) { return m !== el; });

  // Unlock scroll if no more open modals
  var remainingOpen = Array.from(document.querySelectorAll('.modal-bg')).filter(function (m) {
    return m.classList.contains('open') || (m.style.display && m.style.display !== 'none');
  });
  if (remainingOpen.length === 0 && document.body) {
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
  }

  // Restore focus to opener element (C10)
  if (el._prevActiveElement && typeof el._prevActiveElement.focus === 'function') {
    try {
      el._prevActiveElement.focus();
    } catch (_) {}
  }

  return true;
}

function openModalBg(id) { openModal(id); }
function openModal_(id) { openModal(id); }
function closeModalBg(id, force) { return closeModal(id, force); }

(function(global) {
  'use strict';

  function handleModalBgClick(e) {
    if (e.target.classList.contains('modal-bg') && !e.target.classList.contains('no-backdrop-close')) {
      closeModal(e.target);
    }
  }

  function handleModalKeyDown(e) {
    var openModals = Array.from(document.querySelectorAll('.modal-bg')).filter(function(m) {
      return m.classList.contains('open') || (m.style.display && m.style.display !== 'none');
    });
    if (openModals.length === 0) return;
    var topModal = openModals[openModals.length - 1];

    if (e.key === 'Escape') {
      if (!topModal.classList.contains('no-backdrop-close') && !topModal.classList.contains('no-escape-close')) {
        closeModal(topModal);
      }
    } else if (e.key === 'Tab') {
      // Focus Trap within top modal (C10)
      var focusables = Array.from(topModal.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(function (node) {
        return node.offsetParent !== null;
      });

      if (focusables.length === 0) return;

      var firstEl = focusables[0];
      var lastEl = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  }

  if (document.body) {
    document.body.addEventListener('click', handleModalBgClick);
    document.addEventListener('keydown', handleModalKeyDown);
  } else {
    document.addEventListener('DOMContentLoaded', function() {
      document.body.addEventListener('click', handleModalBgClick);
      document.addEventListener('keydown', handleModalKeyDown);
    });
  }

  global.openModal = openModal;
  global.openModal_ = openModal_;
  global.closeModal = closeModal;
  global.openModalBg = openModalBg;
  global.closeModalBg = closeModalBg;
  global.isModalDirty = isModalDirty;
  global.om = openModal;
})(typeof window !== 'undefined' ? window : this);
