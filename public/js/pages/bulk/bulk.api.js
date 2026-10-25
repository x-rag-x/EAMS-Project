/**
 * bulk.api.js
 * API client for Bulk Chat operations with XHR upload, SSE streaming & fallback polling.
 */
(function (root) {
  'use strict';
  root.Bulk = root.Bulk || {};

  function getToken() {
    return sessionStorage.getItem('eams_token') || (typeof root.TOKEN !== 'undefined' ? root.TOKEN : '');
  }

  function req(method, path, body, options) {
    options = options || {};
    var headers = Object.assign({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken()
    }, options.headers || {});

    var config = {
      method: method,
      headers: headers,
      signal: options.signal
    };

    if (body !== undefined && body !== null) {
      config.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    function unwrap(res) {
      return res && res.data && typeof res.data === 'object' ? Object.assign({}, res, res.data) : res;
    }

    return fetch(path, config).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || data.message || ('HTTP ' + res.status));
          err.status = res.status;
          err.details = data.details || data;
          throw err;
        }
        return unwrap(data);
      });
    });
  }

  function upload(batchId, file, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/bulk/batches/' + batchId + '/upload');
      xhr.setRequestHeader('Authorization', 'Bearer ' + getToken());

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            onProgress(e.loaded, e.total);
          }
        };
      }

      xhr.onload = function () {
        var resp;
        try {
          resp = JSON.parse(xhr.responseText || '{}');
        } catch (e) {
          resp = { error: 'Invalid response from server' };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(resp);
        } else {
          var err = new Error(resp.error || ('Upload failed with status ' + xhr.status));
          err.status = xhr.status;
          reject(err);
        }
      };

      xhr.onerror = function () {
        reject(new Error('Network error during upload'));
      };

      var fd = new FormData();
      fd.append('file', file);
      xhr.send(fd);
    });
  }

  function parseFrame(frame) {
    var lines = frame.split('\n');
    var eventType = 'message';
    var dataStr = '';
    var idStr = '';

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.startsWith(':')) continue; // comment/heartbeat
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        var val = line.slice(5).trim();
        dataStr = dataStr ? (dataStr + '\n' + val) : val;
      } else if (line.startsWith('id:')) {
        idStr = line.slice(3).trim();
      }
    }

    var parsedData = dataStr;
    try {
      parsedData = JSON.parse(dataStr);
    } catch (e) {}

    return { type: eventType, data: parsedData, id: idStr };
  }

  function streamEvents(batchId, onEvent, signal) {
    var failCount = 0;
    var stopped = false;
    var pollTimer = null;
    var currentReader = null;

    if (signal) {
      signal.addEventListener('abort', function () {
        stopped = true;
        if (pollTimer) clearInterval(pollTimer);
        if (currentReader) {
          try { currentReader.cancel(); } catch (e) {}
          currentReader = null;
        }
      });
    }

    function startPollingFallback() {
      if (stopped) return;
      pollTimer = setInterval(function () {
        if (stopped) {
          clearInterval(pollTimer);
          return;
        }
        req('GET', '/api/bulk/batches/' + batchId + '/progress')
          .then(function (res) {
            if (!res) return;
            var prog = res.progress || res.data || null;
            if (prog) {
              onEvent({ type: 'progress', data: prog });
            }
            if (res.status) {
              onEvent({ type: 'status', data: { status: res.status } });
            }
            if (res.lastSeq) {
              onEvent({ type: 'snapshot', data: { status: res.status, progress: prog, lastSeq: res.lastSeq } });
            }
          })
          .catch(function () {});
      }, 1500);
    }

    function connect() {
      if (stopped) return;
      fetch('/api/bulk/batches/' + batchId + '/events', {
        headers: {
          'Authorization': 'Bearer ' + getToken()
        },
        signal: signal
      }).then(function (response) {
        if (!response.ok || !response.body) {
          throw new Error('SSE not available: ' + response.status);
        }
        failCount = 0;
        var reader = response.body.getReader();
        currentReader = reader;
        var decoder = new TextDecoder();
        var buffer = '';

        function readNext() {
          if (stopped) return;
          reader.read().then(function (result) {
            if (result.done) {
              reconnect();
              return;
            }
            buffer += decoder.decode(result.value, { stream: true });
            var idx;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              var frameStr = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              if (frameStr.trim()) {
                var ev = parseFrame(frameStr);
                if (ev && ev.type) onEvent(ev);
              }
            }
            readNext();
          }).catch(function (err) {
            if (!stopped) reconnect();
          });
        }

        readNext();
      }).catch(function (err) {
        if (stopped) return;
        reconnect();
      });
    }

    function reconnect() {
      if (stopped) return;
      failCount++;
      if (failCount >= 3) {
        console.warn('SSE stream failed 3 times. Falling back to active polling.');
        startPollingFallback();
        return;
      }
      var delay = Math.min(1000 * Math.pow(2, failCount), 8000);
      setTimeout(connect, delay);
    }

    connect();

    return function cleanup() {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }

  root.Bulk.api = {
    getToken: getToken,
    request: req,
    upload: upload,
    stream: streamEvents,
    getCapabilities: function () {
      return req('GET', '/api/bulk/capabilities');
    },
    getSchema: function (type) {
      return req('GET', '/api/bulk/schema' + (type ? ('?type=' + encodeURIComponent(type)) : ''));
    },
    getBatches: function (params) {
      var qs = '';
      if (params) {
        var parts = [];
        Object.keys(params).forEach(function (k) {
          if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
          }
        });
        if (parts.length) qs = '?' + parts.join('&');
      }
      return req('GET', '/api/bulk/batches' + qs);
    },
    getBatch: function (id, options) {
      return req('GET', '/api/bulk/batches/' + id, null, options);
    },
    getRows: function (id, params, options) {
      var qs = '';
      if (params) {
        var parts = [];
        Object.keys(params).forEach(function (k) {
          if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
            parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
          }
        });
        if (parts.length) qs = '?' + parts.join('&');
      }
      return req('GET', '/api/bulk/batches/' + id + '/rows' + qs, null, options);
    },
    createBatch: function (type, title, options) {
      return req('POST', '/api/bulk/batches', { type: type, title: title }, options);
    },
    renameBatch: function (id, title) {
      return req('PATCH', '/api/bulk/batches/' + id, { title: title });
    },
    archiveBatch: function (id, archived) {
      return req('POST', '/api/bulk/batches/' + id + '/archive', { archived: archived !== false });
    },
    getMessages: function (id, afterSeq, options) {
      var seqVal = (afterSeq !== undefined && afterSeq !== null) ? afterSeq : '';
      var qs = seqVal !== '' ? ('?afterSeq=' + encodeURIComponent(seqVal)) : '';
      return req('GET', '/api/bulk/batches/' + id + '/messages' + qs, null, options);
    },
    postComment: function (id, text) {
      return req('POST', '/api/bulk/batches/' + id + '/comments', { text: text });
    },
    resolveSkipped: function (id, resolvedKeys) {
      return req('POST', '/api/bulk/batches/' + id + '/resolve-skipped', { resolved: resolvedKeys });
    },
    forwardSudo: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/forward-sudo');
    },
    approveInitial: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/approve-initial');
    },
    rejectInitial: function (id, reason) {
      return req('POST', '/api/bulk/batches/' + id + '/reject-initial', { reason: reason });
    },
    checkVerifyEntry: function (id, rowNumber, updatedData) {
      return req('POST', '/api/bulk/batches/' + id + '/verify-entry/check', {
        rowNumber: rowNumber,
        updatedData: updatedData
      });
    },
    copyToAll: function (id, field, value, rowNumber) {
      return req('POST', '/api/bulk/batches/' + id + '/copy-to-all', {
        field: field,
        value: value,
        rowNumber: rowNumber
      });
    },
    verifyEntry: function (id, rowNumber, updatedData) {
      return req('POST', '/api/bulk/batches/' + id + '/verify-entry', {
        rowNumber: rowNumber,
        updatedData: updatedData
      });
    },
    verifyAll: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/verify-all');
    },
    devBypassVerify: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/dev-bypass-verify');
    },
    editReviewRow: function (id, rowNumber, updatedData) {
      return req('POST', '/api/bulk/batches/' + id + '/review/edit-row', {
        rowNumber: rowNumber,
        updatedData: updatedData
      });
    },
    removeReviewRow: function (id, rowNumber, reason) {
      return req('POST', '/api/bulk/batches/' + id + '/review/remove-row', {
        rowNumber: rowNumber,
        reason: reason
      });
    },
    removeRow: function (id, rowNumber, reason) {
      return req('POST', '/api/bulk/batches/' + id + '/remove-row', {
        rowNumber: rowNumber,
        reason: reason || 'Skipped from importing'
      });
    },
    clearReviewField: function (id, field) {
      return req('POST', '/api/bulk/batches/' + id + '/review/clear-field', {
        field: field
      });
    },
    confirmReview: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/review/confirm');
    },
    submitFinal: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/submit-final');
    },
    approveFinal: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/approve-final');
    },
    retryDrive: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/retry-drive');
    },
    retryBackup: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/retry-backup');
    },
    retryJob: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/retry');
    },
    rescanBatch: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/rescan');
    },
    cloneBatch: function (id) {
      return req('POST', '/api/bulk/batches/' + id + '/clone');
    },
    markSeen: function (id, seq) {
      return req('POST', '/api/bulk/batches/' + id + '/seen', { seq: seq });
    },
    getProgress: function (id) {
      return req('GET', '/api/bulk/batches/' + id + '/progress');
    },
    submitGrievance: function (id, data) {
      return req('POST', '/api/bulk/batches/' + id + '/grievances', data);
    },
    resolveGrievance: function (id, msgId, replyNote) {
      return req('PATCH', '/api/bulk/batches/' + id + '/grievances/' + msgId, { replyNote: replyNote });
    },
    getGrievances: function (id) {
      return req('GET', '/api/bulk/batches/' + id + '/grievances');
    },
    downloadSkippedCsv: function (id) {
      window.location.href = '/api/bulk/batches/' + id + '/skipped-report.csv';
    },
    searchUsers: function (q) {
      return req('GET', '/api/bulk/users/search?q=' + encodeURIComponent(q || ''));
    },
    addParticipant: function (id, userId, level) {
      return req('POST', '/api/bulk/batches/' + id + '/participants', {
        userId: userId,
        level: level
      });
    },
    updateParticipantLevel: function (id, userId, level) {
      return req('PATCH', '/api/bulk/batches/' + id + '/participants/' + userId, {
        level: level
      });
    },
    removeParticipant: function (id, userId) {
      return req('DELETE', '/api/bulk/batches/' + id + '/participants/' + userId);
    },
    deleteChat: function (id, scope) {
      return req('POST', '/api/bulk/batches/' + id + '/delete', { scope: scope || 'me' });
    },
    restoreChat: function (id, scope) {
      return req('POST', '/api/bulk/batches/' + id + '/restore', { scope: scope || 'me' });
    },
    undoBatch: function (id, confirm) {
      return req('POST', '/api/bulk/batches/' + id + '/undo', { confirm: confirm !== false });
    },
    restageBatch: function (id, uploadIndex) {
      return req('POST', '/api/bulk/batches/' + id + '/restage', { uploadIndex: uploadIndex || 0 });
    }
  };
})(window);
