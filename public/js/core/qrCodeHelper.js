/**
 * QR Code Helper for EAMS Live Attendance
 * Uses backend QR generation endpoint for reliable, scannable QR codes
 */
(function (global) {
  'use strict';

  var retryCount = 0;
  var maxRetries = 3;
  var retryDelay = 1000;

  /**
   * Render a high-contrast, Google Lens-scannable QR code using backend API
   * @param {HTMLElement|string} target - Container element or element ID
   * @param {string} text - URL or text payload to encode
   * @param {number} size - Pixel size (default: 300)
   * @param {Function} onSuccess - Callback when QR loads successfully
   */
  global.renderQrToCanvas = function (target, text, size, onSuccess) {
    if (!target || !text) return;
    size = size || 300;

    var el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;

    // Show small loading spinner
    el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:' + size + 'px;height:' + size + 'px;"><div style="width:40px;height:40px;border:4px solid var(--gLr, #a5d6a7);border-top-color:var(--gD, #1b5e20);border-radius:50%;animation:spin 0.8s linear infinite;"></div></div>';

    // Generate QR code using backend endpoint
    generateQrCode(el, text, size, 0, onSuccess);
  };

  function generateQrCode(el, text, size, attempt, onSuccess) {
    try {
      var img = new Image();
      var encodedData = encodeURIComponent(text);
      var encodedSize = encodeURIComponent(size);

      // Use backend QR generation endpoint
      var qrUrl = '/api/qr-attendance/generate-qr?data=' + encodedData + '&size=' + encodedSize;

      img.onload = function() {
        el.innerHTML = '';
        img.style.display = 'block';
        img.style.width = size + 'px';
        img.style.height = size + 'px';
        img.style.margin = '0 auto';
        img.style.borderRadius = '12px';
        img.style.border = '2px solid var(--gLr, #a5d6a7)';
        img.style.background = '#ffffff';
        img.alt = 'QR Code';
        el.appendChild(img);
        retryCount = 0; // Reset on success

        // Call success callback if provided
        if (typeof onSuccess === 'function') {
          onSuccess({ loadedAt: new Date(), el: el });
        }
      };

      img.onerror = function() {
        console.error('[QR Generation] Attempt ' + (attempt + 1) + ' failed');

        if (attempt < maxRetries) {
          // Retry with exponential backoff
          setTimeout(function() {
            generateQrCode(el, text, size, attempt + 1, onSuccess);
          }, retryDelay * (attempt + 1));
        } else {
          // All retries failed - show error with copyable URL
          console.error('[QR Generation] All attempts failed. Showing fallback.');
          showQrError(el, text, size);
        }
      };

      img.src = qrUrl;

    } catch (err) {
      console.error('[renderQrToCanvas] Error generating QR code:', err);
      showQrError(el, text, size);
    }
  }

  function showQrError(el, text, size) {
    el.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:' + size + 'px;height:' + size + 'px;padding:20px;text-align:center;background:var(--gLt, #e8f5e9);border:2px dashed var(--gLr, #a5d6a7);border-radius:12px;">' +
        '<div style="font-size:48px;margin-bottom:10px;">⚠️</div>' +
        '<div style="font-size:14px;font-weight:600;color:var(--td, #1a2e1a);margin-bottom:8px;">QR Generation Failed</div>' +
        '<div style="font-size:11px;color:var(--tmu, #5a7a5a);margin-bottom:12px;">Unable to generate QR code. Students can use the link below:</div>' +
        '<input type="text" value="' + text + '" readonly onclick="this.select()" style="width:100%;padding:8px;font-size:10px;border:1px solid var(--br, #ddd);border-radius:6px;text-align:center;cursor:pointer;" />' +
        '<div style="font-size:10px;color:var(--tdi, #8aab8a);margin-top:8px;">Click to copy link</div>' +
      '</div>';
  }

  // Add spin animation to document if not exists
  if (!document.getElementById('qr-loader-style')) {
    var style = document.createElement('style');
    style.id = 'qr-loader-style';
    style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

})(window);
