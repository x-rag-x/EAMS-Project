/**
 * public/js/core/popup.js
 * Electronic Attendance Management System (EAMS)
 * Special Module Popup Window & Modal Dialog Subsystem
 *
 * 100% offline, zero-dependency, non-blocking modal popup window.
 * Replaces native browser alert(), confirm(), and prompt() with themed EAMS modal dialogs.
 */
(function (global) {
  'use strict';

  var _activePopup = null;
  var _activeResolve = null;

  function _getIconForType(type, iconOverride) {
    if (iconOverride) return iconOverride;
    switch ((type || '').toLowerCase()) {
      case 'success':
        return 'check';
      case 'warn':
      case 'warning':
        return 'alert-triangle';
      case 'error':
      case 'danger':
        return 'x-circle';
      case 'shield':
        return 'shield-halved';
      case 'lock':
        return 'lock';
      case 'phone':
        return 'smartphone';
      case 'info':
      default:
        return 'info-circle';
    }
  }

  function _ensurePopupDom() {
    var bg = document.getElementById('eams-popup-window-bg');
    if (!bg && document.body) {
      bg = document.createElement('div');
      bg.id = 'eams-popup-window-bg';
      bg.className = 'modal-bg eams-popup-bg';
      bg.style.zIndex = '12000';
      bg.setAttribute('role', 'dialog');
      bg.setAttribute('aria-modal', 'true');
      bg.innerHTML =
        '<div class="modal modal-popup" id="eams-popup-window-card">' +
          '<div class="modal-hd" style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">' +
            '<div id="eams-popup-icon-badge" class="popup-icon-badge info">' +
              '<re-icon id="eams-popup-icon" icon="info-circle" size="20"></re-icon>' +
            '</div>' +
            '<div style="flex:1;min-width:0;">' +
              '<div class="modal-title" id="eams-popup-title" style="font-size:17px;font-weight:700;line-height:1.3;">Notification</div>' +
              '<div class="modal-sub" id="eams-popup-sub" style="display:none;font-size:11.5px;color:var(--tmu);margin-top:2px;"></div>' +
            '</div>' +
            '<div class="modal-close" id="eams-popup-close-btn" title="Close">' +
              '<re-icon icon="x" size="14"></re-icon>' +
            '</div>' +
          '</div>' +
          '<div class="modal-body mbody" id="eams-popup-message" style="font-size:13.5px;color:var(--td);line-height:1.6;margin-bottom:16px;white-space:pre-line;word-break:break-word;"></div>' +
          '<div id="eams-popup-input-wrap" style="display:none;margin-bottom:18px;">' +
            '<label id="eams-popup-input-label" class="fl" style="display:none;margin-bottom:6px;font-size:11px;"></label>' +
            '<input type="text" class="fc" id="eams-popup-input" style="width:100%;box-sizing:border-box;font-size:13px;padding:8px 12px;border-radius:10px;">' +
            '<textarea class="fc2" id="eams-popup-textarea" style="width:100%;box-sizing:border-box;font-size:13px;padding:8px 12px;border-radius:10px;display:none;min-height:75px;resize:vertical;"></textarea>' +
          '</div>' +
          '<div class="modal-ft" id="eams-popup-ft" style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:16px;">' +
            '<button type="button" class="btn-out" id="eams-popup-cancel-btn" style="display:none;">Cancel</button>' +
            '<button type="button" class="btn-pri" id="eams-popup-confirm-btn">OK</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(bg);

      // Event listeners
      var closeBtn = document.getElementById('eams-popup-close-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', function () {
          closePopup(false);
        });
      }

      bg.addEventListener('click', function (e) {
        if (e.target === bg && _activePopup && _activePopup.backdropClose !== false) {
          closePopup(false);
        }
      });

      document.addEventListener('keydown', function (e) {
        if (!bg.classList.contains('open')) return;
        if (e.key === 'Escape' && _activePopup && _activePopup.backdropClose !== false) {
          e.preventDefault();
          closePopup(false);
        } else if (e.key === 'Enter') {
          if (e.target && e.target.tagName === 'TEXTAREA') {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              closePopup(true);
            }
            return;
          }
          if (document.activeElement === document.getElementById('eams-popup-cancel-btn')) {
            return;
          }
          e.preventDefault();
          closePopup(true);
        }
      });
    }
    return bg;
  }

  /**
   * Close currently open popup window
   * @param {boolean} result - true if confirmed, false if cancelled/dismissed
   */
  function closePopup(result) {
    var bg = document.getElementById('eams-popup-window-bg');
    if (bg) {
      bg.classList.remove('open');
    }

    var popup = _activePopup;
    var resFn = _activeResolve;
    _activePopup = null;
    _activeResolve = null;

    var val = null;
    if (popup && popup.isPrompt) {
      if (result) {
        var inputEl = document.getElementById('eams-popup-input');
        var textEl = document.getElementById('eams-popup-textarea');
        var isMultiline = popup.multiline || popup.inputType === 'textarea';
        val = isMultiline && textEl ? textEl.value : (inputEl ? inputEl.value : '');
      } else {
        val = null;
      }
    } else {
      val = Boolean(result);
    }

    if (popup) {
      if (result && typeof popup.onConfirm === 'function') {
        try { popup.onConfirm(val); } catch (e) { console.error(e); }
      } else if (!result && typeof popup.onCancel === 'function') {
        try { popup.onCancel(); } catch (e) { console.error(e); }
      }
    }

    if (typeof resFn === 'function') {
      resFn(val);
    }
  }

  /**
   * Show a special popup window
   * @param {string|Object} optsOrMsg - message string or configuration options
   * @param {string} [title='Notification'] - modal title if first argument is string
   * @param {string} [type='info'] - 'info' | 'success' | 'warn' | 'error' | 'danger'
   * @returns {Promise<any>}
   */
  function showPopup(optsOrMsg, title, type) {
    return new Promise(function (resolve) {
      var opts = {};
      if (typeof optsOrMsg === 'string') {
        opts = {
          message: optsOrMsg,
          title: title || 'Notification',
          type: type || 'info'
        };
      } else if (optsOrMsg && typeof optsOrMsg === 'object') {
        opts = Object.assign({}, optsOrMsg);
      }

      var bg = _ensurePopupDom();
      if (!bg) {
        console.warn('[EAMS Popup]: Document body not ready. Message:', opts.message);
        resolve(opts.isPrompt ? null : true);
        return;
      }

      _activePopup = opts;
      _activeResolve = resolve;

      var cardTitle = document.getElementById('eams-popup-title');
      var cardSub = document.getElementById('eams-popup-sub');
      var cardMsg = document.getElementById('eams-popup-message');
      var badgeEl = document.getElementById('eams-popup-icon-badge');
      var iconEl = document.getElementById('eams-popup-icon');
      var inputWrap = document.getElementById('eams-popup-input-wrap');
      var inputLabel = document.getElementById('eams-popup-input-label');
      var inputEl = document.getElementById('eams-popup-input');
      var textEl = document.getElementById('eams-popup-textarea');
      var cancelBtn = document.getElementById('eams-popup-cancel-btn');
      var confirmBtn = document.getElementById('eams-popup-confirm-btn');

      // Title & Subtitle
      if (cardTitle) {
        cardTitle.textContent = opts.title || (opts.isPrompt ? 'Input Required' : 'Notification');
      }
      if (cardSub) {
        if (opts.subtitle) {
          cardSub.textContent = opts.subtitle;
          cardSub.style.display = 'block';
        } else {
          cardSub.style.display = 'none';
        }
      }

      // Message (supports HTML if marked or plain text)
      if (cardMsg) {
        var msg = opts.html || opts.message || '';
        if (opts.html || (typeof msg === 'string' && msg.includes('<'))) {
          cardMsg.innerHTML = msg;
        } else {
          cardMsg.textContent = msg;
        }
      }

      // Prompt Input Fields
      if (inputWrap) {
        if (opts.isPrompt) {
          inputWrap.style.display = 'block';
          if (inputLabel) {
            if (opts.inputLabel) {
              inputLabel.textContent = opts.inputLabel;
              inputLabel.style.display = 'block';
            } else {
              inputLabel.style.display = 'none';
            }
          }
          var isMultiline = opts.multiline || opts.inputType === 'textarea';
          if (isMultiline) {
            if (inputEl) inputEl.style.display = 'none';
            if (textEl) {
              textEl.style.display = 'block';
              textEl.value = opts.defaultValue !== undefined ? String(opts.defaultValue) : '';
              textEl.placeholder = opts.placeholder || '';
            }
          } else {
            if (textEl) textEl.style.display = 'none';
            if (inputEl) {
              inputEl.style.display = 'block';
              inputEl.type = opts.inputType || (opts.type === 'password' ? 'password' : 'text');
              inputEl.value = opts.defaultValue !== undefined ? String(opts.defaultValue) : '';
              inputEl.placeholder = opts.placeholder || '';
            }
          }
        } else {
          inputWrap.style.display = 'none';
        }
      }

      // Icon & Badge Theme
      var pType = (opts.type || (opts.isPrompt ? 'info' : (opts.isConfirm ? 'warn' : 'info'))).toLowerCase();
      if (pType === 'error') pType = 'danger';
      if (badgeEl) {
        badgeEl.className = 'popup-icon-badge ' + pType;
      }
      var iconName = _getIconForType(pType, opts.icon);
      if (iconEl) {
        iconEl.setAttribute('icon', iconName);
      }

      // Confirm Button
      if (confirmBtn) {
        confirmBtn.textContent = opts.confirmText || (opts.isPrompt ? 'OK' : (opts.isConfirm ? 'Confirm' : 'OK'));
        confirmBtn.className = (pType === 'danger' || opts.danger) ? 'btn btn-pri btn-danger' : 'btn btn-pri';
        if (pType === 'success') {
          confirmBtn.style.background = '#16a34a';
          confirmBtn.style.borderColor = '#15803d';
          confirmBtn.style.color = '#ffffff';
        } else if (pType === 'danger') {
          confirmBtn.style.background = '#dc2626';
          confirmBtn.style.borderColor = '#b91c1c';
          confirmBtn.style.color = '#ffffff';
        } else {
          confirmBtn.style.background = '';
          confirmBtn.style.borderColor = '';
          confirmBtn.style.color = '';
        }
        confirmBtn.onclick = function () {
          closePopup(true);
        };
      }

      // Cancel Button (for confirm / prompt dialogs)
      if (cancelBtn) {
        if (opts.showCancel || opts.cancelText || opts.isConfirm || opts.isPrompt) {
          cancelBtn.textContent = opts.cancelText || 'Cancel';
          cancelBtn.style.display = 'inline-flex';
          cancelBtn.onclick = function () {
            closePopup(false);
          };
        } else {
          cancelBtn.style.display = 'none';
        }
      }

      // Open Modal
      bg.classList.add('open');

      // Autofocus
      setTimeout(function () {
        if (opts.isPrompt) {
          var targetInp = (opts.multiline || opts.inputType === 'textarea')
            ? document.getElementById('eams-popup-textarea')
            : document.getElementById('eams-popup-input');
          if (targetInp) {
            targetInp.focus();
            if (typeof targetInp.select === 'function') targetInp.select();
          }
        } else if (confirmBtn) {
          confirmBtn.focus();
        }
      }, 50);
    });
  }

  /**
   * Confirmation Dialog Popup
   * @param {string|Object} message
   * @param {string} [title='Confirm Action']
   * @param {Function} [onConfirm]
   * @param {Function} [onCancel]
   * @param {Object} [extraOpts]
   * @returns {Promise<boolean>}
   */
  function showConfirm(message, title, onConfirm, onCancel, extraOpts) {
    var opts = {};
    if (typeof message === 'object' && message !== null) {
      opts = Object.assign({}, message);
    } else {
      opts = Object.assign({
        message: message,
        title: title || 'Confirm Action',
        type: 'warn',
        isConfirm: true,
        confirmText: 'Confirm',
        cancelText: 'Cancel',
        onConfirm: onConfirm,
        onCancel: onCancel
      }, extraOpts || {});
    }
    opts.isConfirm = true;
    opts.showCancel = true;

    // Smart UX inference: if type was left as default 'warn' but action is affirmative (e.g. approve, permit, publish)
    if (!opts.type || opts.type === 'warn') {
      var strCheck = (opts.title || '') + ' ' + (typeof opts.message === 'string' ? opts.message : '') + ' ' + (opts.confirmText || '');
      if (/\b(approve|publish|endorse|grant|permit|accept)\b/i.test(strCheck)) {
        opts.type = 'success';
        if (!opts.confirmText || opts.confirmText === 'Confirm') {
          opts.confirmText = 'Approve';
        }
      }
    }

    return showPopup(opts);
  }

  /**
   * Prompt Dialog Popup
   * @param {string|Object} message
   * @param {string} [defaultValue='']
   * @param {string} [title='Input Required']
   * @param {Object|string} [optsOrType]
   * @returns {Promise<string|null>}
   */
  function showPrompt(message, defaultValue, title, optsOrType) {
    var opts = {};
    if (typeof message === 'object' && message !== null) {
      opts = Object.assign({}, message);
    } else {
      if (typeof optsOrType === 'string') {
        opts = { type: optsOrType };
      } else if (optsOrType && typeof optsOrType === 'object') {
        opts = Object.assign({}, optsOrType);
      }
      opts.message = message || '';
      opts.defaultValue = defaultValue !== undefined ? defaultValue : '';
      opts.title = title || opts.title || 'Input Required';
    }
    opts.isPrompt = true;
    opts.showCancel = true;
    opts.confirmText = opts.confirmText || 'OK';
    opts.cancelText = opts.cancelText || 'Cancel';
    return showPopup(opts);
  }

  /**
   * Alert Popup Helper (Drop-in replacement for alert)
   * @param {string} message
   * @param {string} [title='Notification']
   * @param {string} [type='info']
   * @returns {Promise<boolean>}
   */
  function showModalAlert(message, title, type) {
    return showPopup(message, title || 'Notification', type || 'info');
  }

  // ── Native Browser Dialog Interceptors Invariant ──
  // Permanently prevents ugly native browser alert(), confirm(), prompt() dialogs
  // across the entire application, redirecting all calls to EAMS Special Modal Popups.
  global.alert = function (message, title) {
    console.warn('[EAMS UI]: Native alert() intercepted. Displaying special popup window.');
    return (global.showPopup || showPopup)(String(message), title || 'Notification', 'info');
  };

  global.confirm = function (message, title) {
    console.warn('[EAMS UI]: Native confirm() intercepted. Displaying special popup confirmation window.');
    return (global.showConfirm || showConfirm)(String(message), title || 'Confirm Action');
  };

  global.prompt = function (message, defaultValue, title) {
    console.warn('[EAMS UI]: Native prompt() intercepted. Displaying special popup prompt window.');
    return (global.showPrompt || showPrompt)(String(message), defaultValue, title || 'Input Required');
  };

  // Export to global window
  global.showPopup = showPopup;
  global.showModalAlert = showModalAlert;
  global.customAlert = showModalAlert;
  global.openAlert = showModalAlert;

  global.showConfirm = showConfirm;
  global.customConfirm = showConfirm;
  global.openConfirm = showConfirm;

  global.showPrompt = showPrompt;
  global.customPrompt = showPrompt;
  global.openPrompt = showPrompt;

  global.closePopup = closePopup;

  global.EAMSPopup = {
    show: showPopup,
    alert: showModalAlert,
    confirm: showConfirm,
    prompt: showPrompt,
    close: closePopup
  };

})(typeof window !== 'undefined' ? window : this);
