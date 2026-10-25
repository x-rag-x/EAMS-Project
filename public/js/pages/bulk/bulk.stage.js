/**
 * public/js/pages/bulk/bulk.stage.js
 * Single status line component for parsing and validating workbook.
 * Features text swap transitions, animated trailing ellipsis, and segmented dot rails.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  var STAGE_LABELS = {
    receive:  'Uploading the file',
    drive:    'Saving to Drive',
    read:     'Reading spreadsheet',
    validate: 'Validating data',
    cleanup:  'Cleaning up',
    done:     'Done'
  };

  var STAGE_KEYS = ['receive', 'drive', 'read', 'validate', 'cleanup', 'done'];

  /**
   * Helper to format text label for stage
   */
  function textFor(keyOrStage) {
    if (!keyOrStage) return STAGE_LABELS.receive;
    if (typeof keyOrStage === 'object') {
      return keyOrStage.text || STAGE_LABELS[keyOrStage.key] || 'Processing…';
    }
    return STAGE_LABELS[keyOrStage] || String(keyOrStage);
  }

  /**
   * Mounts or updates live status line DOM elements
   * @param {HTMLElement} el
   * @param {Object} stageMeta { index, total, key, text }
   */
  function update(el, stageMeta) {
    if (!el) return;
    stageMeta = stageMeta || {};

    var textEl = el.querySelector('#bulk-stage-text');
    var barEl = el.querySelector('#bulk-stage-bar');
    var dots = el.querySelectorAll('.stage-dot');

    var nextText = textFor(stageMeta);
    var isDone = stageMeta.key === 'done' || nextText === 'Done';

    if (textEl) {
      if (textEl.textContent.trim() !== nextText) {
        textEl.classList.add('out');
        setTimeout(function () {
          textEl.textContent = nextText;
          if (isDone) {
            textEl.classList.add('done');
          } else {
            textEl.classList.remove('done');
          }
          textEl.classList.remove('out');
        }, 120);
      }
    }

    var idx = typeof stageMeta.index === 'number' ? stageMeta.index : 0;
    var total = stageMeta.total || 6;
    var pct = Math.min(100, Math.round(((idx + 1) / total) * 100));

    if (barEl) {
      barEl.style.width = pct + '%';
    }

    if (dots && dots.length) {
      for (var d = 0; d < dots.length; d++) {
        var dot = dots[d];
        if (d < idx) {
          dot.className = 'stage-dot done';
        } else if (d === idx) {
          dot.className = 'stage-dot active';
        } else {
          dot.className = 'stage-dot';
        }
      }
    }
  }

  /**
   * Render initial HTML for the single status line stage card
   * @param {Object} ctx
   * @returns {string}
   */
  function render(ctx) {
    var stage = (ctx && ctx.progress && ctx.progress.stage) || {};
    var idx = typeof stage.index === 'number' ? stage.index : 0;
    var isDone = stage.key === 'done';
    var text = textFor(stage);

    var settingsSvg = (typeof root.getIconSvg === 'function')
      ? root.getIconSvg('settings', { size: 16 })
      : '<re-icon icon="settings" size="16"></re-icon>';

    var html = '<div class="bulk-stage-box" id="bulk-stage-box" data-stage-idx="' + idx + '">' +
      '<div class="bulk-stage-header">' +
        '<span class="stage-spin-wrap" style="display:inline-flex;align-items:center;animation:spin 2s linear infinite;">' + settingsSvg + '</span>' +
        '<div id="bulk-stage-text" class="' + (isDone ? 'done' : '') + '" role="status">' + text + '</div>' +
      '</div>' +
    '</div>';
    return html;
  }

  /**
   * Render collapsed one-line chip when stage validation is complete
   * @param {number|Object} batchOrCount
   * @returns {string}
   */
  function renderDoneChip(batchOrCount) {
    var count = 0;
    if (typeof batchOrCount === 'number') {
      count = batchOrCount;
    } else if (batchOrCount && typeof batchOrCount === 'object') {
      var elRows = batchOrCount.eligibleRows ? batchOrCount.eligibleRows.length : (batchOrCount.eligibleCount || 0);
      var skRows = batchOrCount.skippedRows ? batchOrCount.skippedRows.length : (batchOrCount.skippedCount || 0);
      count = elRows + skRows;
    }

    var checkSvg = (typeof root.getIconSvg === 'function')
      ? root.getIconSvg('check', { size: 13 })
      : '<re-icon icon="check" size="13"></re-icon>';

    return '<div class="chip-stage-done" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#eef7ee;color:var(--gD);border-radius:16px;font-size:12px;font-weight:600;">' +
      checkSvg +
      '<span>Validated ' + (count || 0) + ' rows</span>' +
    '</div>';
  }

  root.Bulk.stage = {
    STAGE_LABELS: STAGE_LABELS,
    STAGE_KEYS: STAGE_KEYS,
    textFor: textFor,
    render: render,
    renderDoneChip: renderDoneChip,
    update: update
  };

})(typeof window !== 'undefined' ? window : global);
