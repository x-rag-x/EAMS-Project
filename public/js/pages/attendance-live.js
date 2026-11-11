var currentMode = 'quick-pass';

    var sessionTrackId = '';

    var qrTrackId = '';

    var encryptedSid = '';

    var encryptedQid = '';

    var encryptedTime = '';

    var loginTime = null;

    var countdownTimer = null;



    function getDeviceId() {

      if (window.DeviceKey && typeof window.DeviceKey.getInstallId === 'function') {

        return window.DeviceKey.getInstallId();

      }

      var id = localStorage.getItem('eams_device_id');

      if (!id) {

        id = 'DEV_' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substring(2, 9)));

        localStorage.setItem('eams_device_id', id);

      }

      return id;

    }



    function getStudentToken() {

      return sessionStorage.getItem('eams_token') || '';

    }



    function getStudentUser() {

      try {

        var raw = sessionStorage.getItem('eams_user') || sessionStorage.getItem('user');

        return raw ? JSON.parse(raw) : null;

      } catch (e) {

        return null;

      }

    }





    function showView(viewId) {

      document.querySelectorAll('.view-panel').forEach(function (el) {

        el.classList.remove('active');

      });

      var target = document.getElementById(viewId);

      if (target) target.classList.add('active');

    }



    function switchAttMode(mode) {

      currentMode = mode;

      var qpBtn = document.getElementById('btn-mode-qp');

      var qrBtn = document.getElementById('btn-mode-qr');

      if (mode === 'quick-pass') {

        if (qpBtn) qpBtn.classList.add('active');

        if (qrBtn) qrBtn.classList.remove('active');

        showQuickPassView();

      } else {

        if (qrBtn) qrBtn.classList.add('active');

        if (qpBtn) qpBtn.classList.remove('active');

        if (encryptedSid && encryptedQid) {

          initQrFlow();

        } else {

          showView('view-qr-prompt');

        }

      }

    }



    function showQuickPassView() {

      var user = getStudentUser();

      var token = getStudentToken();

      if (!token || !user || user.role !== 'student') {

        showView('view-login');

        return;

      }

      var pill = document.getElementById('student-pill-qp');

      var nameSpan = document.getElementById('student-name-qp');

      if (pill && nameSpan) {

        nameSpan.textContent = user.name + (user.regNo ? ' (' + user.regNo + ')' : '');

        pill.style.display = 'inline-flex';

      }

      showView('view-quick-pass');

      var firstBox = document.querySelector('.otp-box[data-idx="0"]');

      if (firstBox) firstBox.focus();

    }



    function setupOtpInputs() {

      var inputs = document.querySelectorAll('.otp-box');

      inputs.forEach(function(input, idx) {

        input.addEventListener('paste', function(e) {

          e.preventDefault();

          return false;

        });



        input.addEventListener('input', function() {

          var val = input.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

          input.value = val ? val.slice(-1) : '';

          if (input.value) {

            input.classList.add('filled');

            if (idx < inputs.length - 1) {

              inputs[idx + 1].focus();

            }

          } else {

            input.classList.remove('filled');

          }

        });



        input.addEventListener('keydown', function(e) {

          if (e.key === 'Backspace') {

            if (!input.value && idx > 0) {

              inputs[idx - 1].focus();

              inputs[idx - 1].value = '';

              inputs[idx - 1].classList.remove('filled');

              e.preventDefault();

            } else {

              input.value = '';

              input.classList.remove('filled');

            }

          } else if (e.key === 'ArrowLeft' && idx > 0) {

            inputs[idx - 1].focus();

          } else if (e.key === 'ArrowRight' && idx < inputs.length - 1) {

            inputs[idx + 1].focus();

          } else if (e.key === 'Enter') {

            submitQuickPassCode();

          }

        });

      });

    }



    function submitQuickPassCode() {

      var inputs = document.querySelectorAll('.otp-box');

      var code = '';

      inputs.forEach(function(inp) { code += inp.value.trim().toUpperCase(); });



      var errBox = document.getElementById('qp-input-error');

      if (code.length !== 12) {

        if (errBox) {

          errBox.textContent = 'Please fill all 12 characters of the Quick Pass code (' + code.length + '/12 entered)';

          errBox.style.display = 'block';

        }

        return;

      }

      if (errBox) errBox.style.display = 'none';



      var token = getStudentToken();

      var user = getStudentUser();

      if (!token || !user || user.role !== 'student') {

        showView('view-login');

        return;

      }



      showView('view-verifying');

      var btn = document.getElementById('btn-submit-qp');

      if (btn) btn.disabled = true;



      function doSubmit(locationCoords) {

        var devId = getDeviceId();

        var payload = { code: code, deviceId: devId };

        if (locationCoords) {

          payload.latitude = locationCoords.latitude;

          payload.longitude = locationCoords.longitude;

          payload.locationAccuracy = locationCoords.accuracy;

        }



        var proofPromise = Promise.resolve(null);

        if (window.DeviceKey && typeof window.DeviceKey.createDeviceProof === 'function') {

          proofPromise = DeviceKey.createDeviceProof({ sessionTrackId: '', code: code }, (user && (user.trackId || user._id)) || '')

            .catch(function() { return null; });

        }



        proofPromise.then(function(deviceProof) {

          if (deviceProof) payload.deviceProof = deviceProof;



          return fetch('/api/quick-pass/mark', {

            method: 'POST',

            headers: {

              'Content-Type': 'application/json',

              'Authorization': 'Bearer ' + token,

              'x-device-id': devId

            },

            body: JSON.stringify(payload)

          });

        })

        .then(function(r) {

          return r.json().then(function(data) {

            data._httpStatus = r.status;

            return data;

          });

        })

        .then(function(data) {

          if (btn) btn.disabled = false;

          if (data._httpStatus === 401) {

            showView('view-login');

            return;

          }

          if (data._httpStatus === 403) {

            showErrorView(data.error || 'Self-attendance is locked or restricted for your account.');

            return;

          }

          if (data.ok) {

            if (data.status === 'pending' || data.requiresTeacherVerification) {

              showPendingView(data.failReason || data.message || 'Marked! Teacher verification required.');

            } else {

              showCompletedView();

            }

          } else {

            showErrorView(data.error || 'Failed to mark Quick Pass attendance');

          }

        })

        .catch(function(err) {

          if (btn) btn.disabled = false;

          showErrorView('Connection error marking attendance. Please retry.');

        });

      }



      if (navigator.geolocation) {

        navigator.geolocation.getCurrentPosition(

          function(pos) {

            doSubmit({

              latitude: pos.coords.latitude,

              longitude: pos.coords.longitude,

              accuracy: pos.coords.accuracy

            });

          },

          function() { doSubmit(null); },

          { enableHighAccuracy: true, timeout: 3500, maximumAge: 60000 }

        );

      } else {

        doSubmit(null);

      }

    }



    function handleStudentLogin(e) {

      if (e) e.preventDefault();

      var u = document.getElementById('username').value.trim();

      var p = document.getElementById('password').value;

      var errBox = document.getElementById('login-error');

      if (!u || !p) {

        if (errBox) { errBox.textContent = 'Enter username and password'; errBox.style.display = 'block'; }

        return;

      }

      if (errBox) errBox.style.display = 'none';

      var btn = document.getElementById('btn-login');

      if (btn) btn.disabled = true;



      fetch('/api/auth/login', {

        method: 'POST',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ username: u, password: p })

      })

      .then(function(r) { return r.json(); })

      .then(function(data) {

        if (btn) btn.disabled = false;

        if (data.token && data.user) {

          if (data.user.role !== 'student') {

            if (errBox) { errBox.textContent = 'Only students can mark attendance here'; errBox.style.display = 'block'; }

            return;

          }

          sessionStorage.setItem('eams_token', data.token);

          sessionStorage.setItem('eams_user', JSON.stringify(data.user));



          if (currentMode === 'qr' && encryptedSid && encryptedQid) {

            initQrFlow();

          } else {

            showQuickPassView();

          }

        } else {

          if (errBox) { errBox.textContent = data.error || 'Login failed'; errBox.style.display = 'block'; }

        }

      })

      .catch(function(err) {

        if (btn) btn.disabled = false;

        if (errBox) { errBox.textContent = 'Connection error'; errBox.style.display = 'block'; }

      });

    }



    function parseQrUrlParams() {

      var search = new URLSearchParams(window.location.search);

      encryptedSid = search.get('sid') || search.get('s') || search.get('sessionTrackId') || '';

      encryptedQid = search.get('qid') || search.get('q') || search.get('qrTrackId') || '';

      encryptedTime = search.get('t') || '';

    }



    function executeVerificationFlow(token, studentData) {

      showView('view-verifying');



      if (studentData && studentData.name) {

        var pill = document.getElementById('student-pill-verifying');

        var nameSpan = document.getElementById('student-name-verifying');

        if (pill && nameSpan) {

          nameSpan.textContent = studentData.name + (studentData.regNo ? ' (' + studentData.regNo + ')' : '');

          pill.style.display = 'inline-flex';

        }

      }



      var deviceId = getDeviceId();



      function performSubmit(locationCoords) {

        var payload = {

          sessionTrackId: sessionTrackId,

          qrTrackId: qrTrackId,

          deviceId: deviceId,

          loginTime: loginTime,

          t: encryptedTime

        };

        if (locationCoords) {

          payload.latitude = locationCoords.latitude;

          payload.longitude = locationCoords.longitude;

          payload.accuracy = locationCoords.accuracy;

        }



        var proofPromise = Promise.resolve(null);

        if (window.DeviceKey && typeof window.DeviceKey.createDeviceProof === 'function') {

          proofPromise = DeviceKey.createDeviceProof(

            { sessionTrackId: sessionTrackId, qrTrackId: qrTrackId },

            (studentData && (studentData.trackId || studentData._id)) || ''

          ).catch(function() { return null; });

        }



        proofPromise.then(function(deviceProof) {

          if (deviceProof) payload.deviceProof = deviceProof;



          return fetch('/api/qr-attendance/submit', {

            method: 'POST',

            headers: {

              'Content-Type': 'application/json',

              'Authorization': 'Bearer ' + token

            },

            body: JSON.stringify(payload)

          });

        })

        .then(function (r) {

          return r.json().then(function (data) {

            data._httpStatus = r.status;

            return data;

          });

        })

        .then(function (res) {

          if (res._httpStatus === 401) {

            showView('view-login');

            return;

          }

          if (res._httpStatus === 403) {

            showErrorView(res.error || 'Self-attendance is locked or restricted for your account.');

            return;

          }



          if (res.status === 'completed') {

            showCompletedView();

          } else if (res.status === 'pending') {

            showPendingView(res.failReason || res.message);

          } else {

            showErrorView(res.error || res.message || 'Verification could not be processed.');

          }

        })

        .catch(function () {

          showPendingView('Connection timed out or weak signal. Stored as pending for teacher review.');

        });

      }



      if (navigator.geolocation) {

        navigator.geolocation.getCurrentPosition(

          function (pos) {

            performSubmit({

              latitude: pos.coords.latitude,

              longitude: pos.coords.longitude,

              accuracy: pos.coords.accuracy

            });

          },

          function () { performSubmit(null); },

          { enableHighAccuracy: true, timeout: 3500, maximumAge: 60000 }

        );

      } else {

        performSubmit(null);

      }

    }



    function initQrFlow() {

      var token = getStudentToken();

      var user = getStudentUser();



      if (!token || !user || user.role !== 'student') {

        showView('view-login');

        return;

      }



      showView('view-verifying');

      fetch('/api/qr-attendance/decrypt-params', {

        method: 'POST',

        headers: {

          'Content-Type': 'application/json',

          'Authorization': 'Bearer ' + token

        },

        body: JSON.stringify({

          sid: encryptedSid,

          qid: encryptedQid,

          t: encryptedTime

        })

      })

      .then(function (r) {

        return r.json().then(function (d) {

          d._httpStatus = r.status;

          return d;

        });

      })

      .then(function (res) {

        if (res._httpStatus === 401) {

          showView('view-login');

          return;

        }



        if (res.error || !res.sessionTrackId || !res.qrTrackId) {

          showErrorView(res.error || 'Failed to decrypt QR attendance parameters.');

          return;

        }



        sessionTrackId = res.sessionTrackId;

        qrTrackId = res.qrTrackId;

        loginTime = res.loginTime;



        executeVerificationFlow(token, user);

      })

      .catch(function () {

        showErrorView('Connection error decrypting attendance parameters. Please retry.');

      });

    }



    function startAutoCloseTimer(seconds, counterElId) {

      if (countdownTimer) clearInterval(countdownTimer);

      var remaining = seconds || 12;

      var counterEl = document.getElementById(counterElId || 'countdown-num');

      if (counterEl) counterEl.textContent = remaining;



      countdownTimer = setInterval(function () {

        remaining--;

        if (counterEl) counterEl.textContent = remaining;

        if (remaining <= 0) {

          clearInterval(countdownTimer);

          try { window.close(); } catch (e) {}

          var fallback = document.getElementById('close-fallback-msg');

          if (fallback) fallback.style.display = 'block';

        }

      }, 1000);

    }



    function showCompletedView() {

      showView('view-completed');

      startAutoCloseTimer(10, 'countdown-num');

    }



    function showPendingView(reason) {

      showView('view-pending');

      var reasonTxt = document.getElementById('pending-reason-txt');

      if (reasonTxt) reasonTxt.textContent = reason || 'Awaiting teacher review.';

      startAutoCloseTimer(15, 'pending-countdown-num');

    }



    function showErrorView(msg) {

      showView('view-error');

      var desc = document.getElementById('error-desc-txt');

      if (desc) desc.textContent = msg || 'Attendance verification failed.';

    }



    function retryVerification() {

      if (currentMode === 'qr' && encryptedSid && encryptedQid) {

        initQrFlow();

      } else {

        showQuickPassView();

      }

    }



    // Initialization

    window.addEventListener('DOMContentLoaded', function () {

      setupOtpInputs();

      parseQrUrlParams();



      if (encryptedSid && encryptedQid) {

        // QR flow triggered by camera scan

        switchAttMode('qr');

      } else {

        // Default to Quick Pass mode

        switchAttMode('quick-pass');

      }

    });

// ── Delegated & Direct Event Listeners (Invariant S7: Zero Inline Handlers) ──
document.addEventListener('DOMContentLoaded', function () {
  // 1. Prevent paste on OTP inputs
  document.querySelectorAll('.otp-input').forEach(function (inp) {
    inp.addEventListener('paste', function (e) {
      e.preventDefault();
    });
  });

  // 2. Mode buttons
  var qpBtn = document.getElementById('btn-mode-qp');
  if (qpBtn) {
    qpBtn.addEventListener('click', function () { switchAttMode('quick-pass'); });
  }
  var qrBtn = document.getElementById('btn-mode-qr');
  if (qrBtn) {
    qrBtn.addEventListener('click', function () { switchAttMode('qr'); });
  }

  // 3. Submit Quick Pass button
  var submitQpBtn = document.getElementById('btn-submit-qp');
  if (submitQpBtn) {
    submitQpBtn.addEventListener('click', function () { submitQuickPassCode(); });
  }

  // 4. Student login form
  var loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', function (e) { handleStudentLogin(e); });
  }

  // 5. Delegated clicks for actions
  document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'switch-quick-pass') {
      switchAttMode('quick-pass');
    } else if (action === 'switch-qr') {
      switchAttMode('qr');
    } else if (action === 'retry') {
      retryVerification();
    }
  });
});
