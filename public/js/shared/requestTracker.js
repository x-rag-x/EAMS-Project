/**
 * EAMS Request Tracker - Frontend Component
 * Renders approval workflow tracker for leave/OD requests
 * Reusable across student and teacher portals
 */

(function(window) {
  'use strict';

  function esc(v) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(v);
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  const EamsTracker = {
    /**
     * Extracts normalized nodes from tracker object (supports both `tracker.nodes` and `tracker.steps`)
     * @param {Object} tracker
     * @returns {Array|null}
     */
    _getNodes(tracker) {
      if (!tracker) return null;
      const raw = tracker.nodes || tracker.steps;
      if (!Array.isArray(raw) || !raw.length) return null;
      return raw.map(function(n) {
        return {
          key: n.key || '',
          state: n.state || 'upcoming',
          label: n.label || n.key || '',
          actor: n.actor || '',
          timestamp: n.timestamp || n.at || null,
          remarks: n.remarks || n.remark || '',
          auto: !!n.auto
        };
      });
    },

    /**
     * Render full tracker panel
     * @param {Object} tracker - Tracker data from server ({ nodes: [...] } or { steps: [...] })
     * @param {String|HTMLElement|Object} [containerIdOrOpts] - DOM element ID, element, or options object
     * @returns {String} Rendered HTML string
     */
    render(tracker, containerIdOrOpts) {
      let container = null;
      let opts = {};
      if (typeof containerIdOrOpts === 'string') {
        container = document.getElementById(containerIdOrOpts);
      } else if (containerIdOrOpts && containerIdOrOpts.nodeType === 1) {
        container = containerIdOrOpts;
      } else if (containerIdOrOpts && typeof containerIdOrOpts === 'object') {
        opts = containerIdOrOpts;
      }

      const nodes = this._getNodes(tracker);
      if (!nodes || !nodes.length) {
        const errorHtml = '<p class="trk-error">Tracker data unavailable</p>';
        if (container) {
          container.innerHTML = errorHtml;
        }
        return errorHtml;
      }

      const html = this._buildPanelHTML(nodes, tracker, opts);
      if (container) {
        container.innerHTML = html;
      }
      return html;
    },

    /**
     * Render mini tracker (compact dots version for history rows / pending cards)
     * @param {Object} tracker - Tracker data from server
     * @param {String|HTMLElement} [containerId] - DOM element ID or element to render into
     * @returns {String} HTML string
     */
    mini(tracker, containerId) {
      let container = null;
      if (typeof containerId === 'string') {
        container = document.getElementById(containerId);
      } else if (containerId && containerId.nodeType === 1) {
        container = containerId;
      }

      const nodes = this._getNodes(tracker);
      if (!nodes || !nodes.length) {
        if (container) {
          container.innerHTML = '';
        }
        return '';
      }

      const html = this._buildMiniHTML(nodes, tracker);
      if (container) {
        container.innerHTML = html;
      }
      return html;
    },

    /**
     * Render pill status (single-line summary)
     * @param {Object} tracker - Tracker data from server
     * @returns {String} HTML string
     */
    pill(tracker) {
      const nodes = this._getNodes(tracker);
      if (!tracker || (!nodes && !tracker.headline)) {
        return '<span class="trk-pill trk-pill--unknown">Status Unknown</span>';
      }

      // If server provided headline and outcome, use it
      if (tracker.headline) {
        let pillClass = 'trk-pill--pending';
        if (tracker.outcome === 'approved') {
          pillClass = 'trk-pill--approved';
        } else if (tracker.outcome === 'rejected' || tracker.outcome === 'cancelled') {
          pillClass = 'trk-pill--rejected';
        }
        return '<span class="trk-pill ' + pillClass + '">' + esc(tracker.headline) + '</span>';
      }

      if (!nodes) {
        return '<span class="trk-pill trk-pill--unknown">Status Unknown</span>';
      }

      const rejectedNode = nodes.find(n => n.state === 'rejected');
      const allDone = nodes.every(n => n.state === 'done' || n.state === 'skipped');
      const currentNode = nodes.find(n => n.state === 'current');

      if (rejectedNode) {
        return '<span class="trk-pill trk-pill--rejected">Rejected at ' + esc(rejectedNode.label) + '</span>';
      } else if (allDone) {
        return '<span class="trk-pill trk-pill--approved">Approved</span>';
      } else if (currentNode) {
        return '<span class="trk-pill trk-pill--pending">Pending at ' + esc(currentNode.label) + '</span>';
      } else {
        return '<span class="trk-pill trk-pill--unknown">Status Unknown</span>';
      }
    },

    /**
     * Render card panel with header title and pill
     * @param {Object} tracker
     * @param {Object} [opts] - { title, compact }
     * @returns {String} HTML string
     */
    panel(tracker, opts) {
      if (!tracker) return '';
      const o = opts || {};
      const nodes = this._getNodes(tracker);
      if (!nodes || !nodes.length) return '';
      return '<div class="trk-panel">'
        + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
        + '<span style="font-size:13px;font-weight:700;color:var(--td);">' + esc(o.title || 'Approval Progress') + '</span>'
        + this.pill(tracker)
        + '</div>'
        + this._buildNodesHTML(nodes)
        + '</div>';
    },

    /**
     * Build nodes list HTML
     * @private
     */
    _buildNodesHTML(nodes) {
      let html = '';
      nodes.forEach((node, index) => {
        const stateClass = `trk-node--${node.state}`;
        const glyph = this._getGlyph(node.state);
        const timestamp = node.timestamp ? this._formatTimestamp(node.timestamp) : '';
        const showConnector = index < nodes.length - 1;

        let actorDisplay = '';
        if (node.auto) {
          actorDisplay = 'Auto-approved (same approver)';
        } else if (node.actor) {
          actorDisplay = node.actor;
        } else if (node.state === 'current') {
          actorDisplay = 'Waiting for review';
        }

        html += `
          <div class="trk-node ${stateClass}">
            <div class="trk-node__icon" aria-label="${node.state}">
              ${glyph}
            </div>
            <div class="trk-node__content">
              <div class="trk-node__label">${esc(node.label)}</div>
              ${actorDisplay ? `<div class="trk-node__actor">${esc(actorDisplay)}</div>` : ''}
              ${timestamp ? `<div class="trk-node__time">${timestamp}</div>` : ''}
              ${node.remarks ? `<div class="trk-node__remarks">${esc(node.remarks)}</div>` : ''}
            </div>
          </div>
        `;

        if (showConnector) {
          html += '<div class="trk-connector"></div>';
        }
      });
      return html;
    },

    /**
     * Build full panel HTML
     * @private
     */
    _buildPanelHTML(nodes, tracker, opts) {
      return '<div class="trk-panel">' + this._buildNodesHTML(nodes) + '</div>';
    },

    /**
     * Build mini tracker HTML (dots only)
     * @private
     */
    _buildMiniHTML(nodes, tracker) {
      let html = '<div class="trk-mini">';

      nodes.forEach((node, index) => {
        const stateClass = `trk-dot--${node.state}`;
        const title = `${node.label}: ${node.state}${node.remarks ? ' - ' + node.remarks : ''}`;

        html += `<span class="trk-dot ${stateClass}" title="${esc(title)}"></span>`;

        if (index < nodes.length - 1) {
          html += '<span class="trk-dot-connector"></span>';
        }
      });

      html += '</div>';
      return html;
    },

    /**
     * Get visual glyph for each state
     * @private
     */
    _getGlyph(state) {
      const glyphs = {
        done: '✓',
        current: '○',
        rejected: '✕',
        returned: '↩',
        skipped: '−',
        upcoming: '○'
      };
      return glyphs[state] || '?';
    },

    /**
     * Format timestamp
     * @private
     */
    _formatTimestamp(timestamp) {
      try {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return '';

        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMs < 60000) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;

        // Format as "29-10-2026" (DD-MM-YYYY)
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
      } catch (e) {
        return '';
      }
    },

    /**
     * Escape HTML helper
     */
    _escapeHtml: esc
  };

  // Expose to global scope
  window.EamsTracker = EamsTracker;

})(typeof window !== 'undefined' ? window : globalThis);
