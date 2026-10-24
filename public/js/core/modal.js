/**
 * public/js/core/modal.js
 * Electronic Attendance Management System (EAMS)
 * Core Modal Subsystem
 */

function openModal(id) {
  var el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) {
    el.style.display = 'flex';
    el.classList.add('open');
  }
}
var om = openModal;

function closeModal(id) {
  var el = typeof id === 'string' ? document.getElementById(id) : id;
  if (el) {
    el.classList.remove('open');
    if (el.style.display && el.style.display !== 'none') {
      el.style.display = 'none';
    }
  }
}

function openModalBg(id) {
  openModal(id);
}

function closeModalBg(id) {
  closeModal(id);
}

(function(global) {
  'use strict';

  function handleModalBgClick(e) {
    if (e.target.classList.contains('modal-bg') && !e.target.classList.contains('no-backdrop-close')) {
      var modalId = e.target.id;
      if (typeof global.closeModalBg === 'function') {
        global.closeModalBg(modalId || e.target);
      } else if (typeof closeModalBg === 'function') {
        closeModalBg(modalId || e.target);
      } else {
        closeModal(e.target);
      }
    }
  }

  function handleModalKeyDown(e) {
    if (e.key === 'Escape') {
      var openModals = Array.from(document.querySelectorAll('.modal-bg')).filter(function(m) {
        return m.classList.contains('open') || (m.style.display && m.style.display !== 'none');
      });
      if (openModals.length > 0) {
        var topModal = openModals[openModals.length - 1];
        if (!topModal.classList.contains('no-backdrop-close') && !topModal.classList.contains('no-escape-close')) {
          var modalId = topModal.id;
          if (typeof global.closeModalBg === 'function') {
            global.closeModalBg(modalId || topModal);
          } else if (typeof closeModalBg === 'function') {
            closeModalBg(modalId || topModal);
          } else {
            closeModal(topModal);
          }
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

  // Export modal helpers to global scope
  global.openModal = openModal;
  global.closeModal = closeModal;
  global.openModalBg = openModalBg;
  global.closeModalBg = closeModalBg;
  global.om = openModal;
})(typeof window !== 'undefined' ? window : this);
