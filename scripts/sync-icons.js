/**
 * scripts/sync-icons.js
 * Fetches the curated icon definitions from Reicon CDN/catalog
 * and generates public/js/core/icons.js with zero dependencies.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ICON_LIST = [
  // Sidebar navigation
  'grid', 'building2', 'chalkboard', 'graduation-cap', 'teacher', 'users', 'calendar-days',
  'tv', 'upload', 'trend-up', 'clipboard-list', 'settings', 'bell', 'book-open',
  'monitor', 'bullhorn', 'trash2', 'archive', 'undo', 'sledgehammer', 'file-text',
  'user-x', 'calendar', 'building', 'package', 'history', 'crown', 'microchip',
  'shield-lock', 'globe', 'puzzle', 'scroll', 'flask', 'user', 'bolt', 'edit', 'download',
  // Toggle pairs
  'menu', 'x', 'eye-off', 'eye', 'lock', 'lock-open', 'list', 'bell-off', 'check',
  // Buttons & actions
  'save', 'plus', 'search', 'refresh', 'printer', 'fullscreen', 'scissors', 'key',
  'arrow-right', 'arrow-left', 'rocket', 'eraser', 'forbidden-circle', 'pause',
  // Status, alerts & empty states
  'check-circle', 'x-circle', 'alert-triangle', 'info-circle', 'confetti', 'inbox',
  'siren', 'lightbulb', 'hourglass', 'traffic', 'ban', 'help-circle', 'flag',
  // Content-type, domain & role badges
  'pin', 'radio', 'wifi', 'home', 'arrow-door-in', 'armchair', 'microscope',
  'layout', 'folder', 'tag', 'trophy', 'personalcard', 'message-square',
  'envelope', 'cloud', 'plug', 'scale', 'shield', 'sparkles', 'wand2',
  'wand-sparkle', 'ticket',
  // Attendance & Timetable
  'tree', 'plane', 'coffee', 'fork-knife', 'camera', 'hashtag', 'timer',
  // Departments
  'laptop', 'palette', 'tower'
];

function toPascalCase(str) {
  return str.split('-').map(part => {
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join('');
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchUrl(res.headers.location));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}, status: ${res.statusCode}`));
      }
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function extractIconData(kebabName) {
  const pascalName = toPascalCase(kebabName);
  const url = `https://cdn.jsdelivr.net/npm/reicon/icons/${pascalName}.js`;
  const code = await fetchUrl(url);

  let outline = '';
  let filled = '';

  const oMatch = code.match(/O:\s*`([^`]+)`/);
  if (oMatch) outline = oMatch[1].trim();

  const fMatch = code.match(/F:\s*`([^`]+)`/);
  if (fMatch) filled = fMatch[1].trim();

  if (!outline && !filled) {
    throw new Error(`Could not parse O or F paths for ${kebabName} (${pascalName})`);
  }

  return { O: outline, F: filled || outline };
}

async function main() {
  console.log(`Starting extraction for ${ICON_LIST.length} icons...`);
  const dictionary = {};

  // Fetch with concurrency control
  const concurrency = 10;
  for (let i = 0; i < ICON_LIST.length; i += concurrency) {
    const chunk = ICON_LIST.slice(i, i + concurrency);
    await Promise.all(chunk.map(async (name) => {
      try {
        const data = await extractIconData(name);
        dictionary[name] = data;
        process.stdout.write('.');
      } catch (err) {
        console.error(`\nError fetching ${name}:`, err.message);
      }
    }));
  }

  console.log(`\nSuccessfully loaded ${Object.keys(dictionary).length} icons.`);

  const outputPath = path.join(__dirname, '..', 'public', 'js', 'core', 'icons.js');

  const fileContent = `/**
 * public/js/core/icons.js
 * Electronic Attendance Management System (EAMS) Icon Subsystem
 * Native <re-icon> Web Component & SVG Helper
 * 
 * Contains 100% offline, zero-dependency, curated Reicon SVG paths (24x24)
 * with dual-path rendering support for 60fps CSS hover/active weight transitions.
 */
(function (global) {
  'use strict';

  var ICONS = ${JSON.stringify(dictionary, null, 2)};

  var DEPT_MAP = {
    'cs': 'laptop',
    'cse': 'laptop',
    'ece': 'radio',
    'mech': 'settings',
    'me': 'settings',
    'eee': 'bolt',
    'ee': 'bolt',
    'civil': 'tower',
    'ce': 'tower',
    'it': 'monitor',
    'aiml': 'microchip',
    'ai': 'microchip',
    'csd': 'palette',
    'default': 'building2'
  };

  /**
   * Resolve an icon name from department code or fallback
   */
  function getDeptIconName(deptCodeOrIcon) {
    if (!deptCodeOrIcon) return 'building2';
    var lower = String(deptCodeOrIcon).toLowerCase().trim();
    if (ICONS[lower]) return lower;
    if (DEPT_MAP[lower]) return DEPT_MAP[lower];
    return 'building2';
  }

  if (typeof window !== 'undefined' && typeof customElements !== 'undefined' && typeof HTMLElement !== 'undefined') {
    class ReIconElement extends HTMLElement {
      static get observedAttributes() {
        return ['icon', 'weight', 'size', 'color'];
      }

      connectedCallback() {
        this._render();
      }

      attributeChangedCallback(name, oldVal, newVal) {
        if (oldVal !== newVal) {
          this._render();
        }
      }

      _render() {
        var iconName = (this.getAttribute('icon') || '').toLowerCase().trim();
        var size = this.getAttribute('size');
        var color = this.getAttribute('color');

        if (size) {
          this.style.setProperty('--ri-size', isNaN(size) ? size : size + 'px');
        }
        if (color) {
          this.style.color = color;
        }

        var iconData = ICONS[iconName] || ICONS['help-circle'] || { O: '', F: '' };
        var oPath = iconData.O || '';
        var fPath = iconData.F || oPath;

        this.innerHTML = '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" style="display:block;">' +
          '<g class="reicon-o">' + oPath + '</g>' +
          '<g class="reicon-f">' + fPath + '</g>' +
          '</svg>';
      }
    }

    if (!customElements.get('re-icon')) {
      customElements.define('re-icon', ReIconElement);
    }
  }

  /**
   * Generate raw SVG HTML string for templates and innerHTML
   * @param {string} iconName
   * @param {Object} [opts] { weight, size, color, class }
   * @returns {string}
   */
  function getIconSvg(iconName, opts) {
    opts = opts || {};
    var name = (iconName || '').toLowerCase().trim();
    var iconData = ICONS[name] || ICONS['help-circle'] || { O: '', F: '' };
    var weight = (opts.weight || 'outline').toLowerCase();
    var inner = weight === 'filled' ? (iconData.F || iconData.O || '') : (iconData.O || '');

    var sizeStyle = opts.size ? ' style="--ri-size:' + (isNaN(opts.size) ? opts.size : opts.size + 'px') + ';"' : '';
    var colorStyle = opts.color ? ' style="color:' + opts.color + ';"' : '';
    var combinedStyle = (opts.size || opts.color) 
      ? ' style="' + (opts.size ? '--ri-size:' + (isNaN(opts.size) ? opts.size : opts.size + 'px') + ';' : '') + (opts.color ? 'color:' + opts.color + ';' : '') + '"'
      : '';
    var cls = 'reicon-wrap' + (opts.class ? ' ' + opts.class : '');

    return '<span class="' + cls + '"' + combinedStyle + ' aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" style="display:inline-block;vertical-align:middle;">' +
      inner +
      '</svg></span>';
  }

  /**
   * Helper to render department icon SVG
   */
  function getDeptIconSvg(deptCodeOrIcon, opts) {
    var name = getDeptIconName(deptCodeOrIcon);
    return getIconSvg(name, opts);
  }

  // Export to window
  global.EAMSIcons = {
    dictionary: ICONS,
    getDeptIconName: getDeptIconName,
    getIconSvg: getIconSvg,
    getDeptIconSvg: getDeptIconSvg
  };
  global.getIconSvg = getIconSvg;
  global.getDeptIconSvg = getDeptIconSvg;
  global.getDeptIconName = getDeptIconName;

})(typeof window !== 'undefined' ? window : global);
`;

  fs.writeFileSync(outputPath, fileContent, 'utf8');
  console.log(`Wrote ${outputPath} successfully (${(fileContent.length / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error('Fatal error syncing icons:', err);
  process.exit(1);
});
