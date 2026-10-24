/**
 * public/js/core/deviceKey.js
 *
 * EAMS Client-Side Device Trust & Hardware Key Helper (§2, §4, T1.2).
 *
 * Features:
 * 1. Generates non-extractable WebCrypto ECDSA P-256 signing keys stored safely in IndexedDB.
 * 2. Computes canonical SHA-256 JWK thumbprints.
 * 3. Gathers descriptive device info and stable hardware fingerprint signals.
 * 4. Checks iOS Safari PWA installation (preventing 7-day Safari storage wipe).
 * 5. Requests persistent storage quota via navigator.storage.persist().
 * 6. Enumerates stored key thumbprints for friend-marking / shared-phone detection.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DeviceKey = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB_NAME = 'EAMS_DEVICE_KEY_DB';
  var DB_VERSION = 1;
  var STORE_NAME = 'keys';

  // Open or initialize IndexedDB for non-extractable CryptoKey storage
  function openKeyDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        return reject(new Error('IndexedDB is not supported on this device/browser'));
      }
      var request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'studentTrackId' });
        }
      };
      request.onsuccess = function (event) {
        resolve(event.target.result);
      };
      request.onerror = function (event) {
        reject(event.target.error || new Error('Failed to open device key database'));
      };
    });
  }

  // SHA-256 helper returning lowercase hex string
  async function sha256Hex(strOrBuffer) {
    var data;
    if (typeof strOrBuffer === 'string') {
      data = new TextEncoder().encode(strOrBuffer);
    } else {
      data = strOrBuffer;
    }
    var hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // Canonical JWK thumbprint computation (RFC 7638 for EC keys)
  async function computeJwkThumbprint(jwk) {
    var canonical = JSON.stringify({
      crv: jwk.crv,
      kty: jwk.kty,
      x: jwk.x,
      y: jwk.y
    });
    return sha256Hex(canonical);
  }

  // Install ID management (persisted in localStorage, shared with attendance)
  function getOrCreateInstallId() {
    try {
      var id = localStorage.getItem('eams_device_id') || localStorage.getItem('eams_device_install_id');
      if (!id) {
        if (window.crypto && window.crypto.randomUUID) {
          id = window.crypto.randomUUID();
        } else {
          id = 'dev_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        }
        localStorage.setItem('eams_device_id', id);
        localStorage.setItem('eams_device_install_id', id);
      } else {
        localStorage.setItem('eams_device_id', id);
        localStorage.setItem('eams_device_install_id', id);
      }
      return id;
    } catch (e) {
      return 'dev_ephemeral_' + Date.now();
    }
  }

  // Request persistent storage on modern browsers
  async function requestStoragePersistence() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        var isPersisted = await navigator.storage.persist();
        return isPersisted;
      }
    } catch (e) {
      console.warn('[DeviceKey] storage.persist error:', e);
    }
    return false;
  }

  // Detect iOS Safari PWA status (Home Screen app retains data beyond 7 days)
  function checkIosPwaStatus() {
    var ua = navigator.userAgent || '';
    var isIos = /iPhone|iPad|iPod/i.test(ua) && !window.MSStream;
    var isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;
    return {
      isIos: isIos,
      isPwa: isStandalone,
      needsHomeScreen: isIos && !isStandalone
    };
  }

  // Gather WebGL GPU renderer string safely
  function getGpuRenderer() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
        }
      }
    } catch (e) {}
    return '';
  }

  // Stable hardware fingerprint signals
  async function getFingerprintHash() {
    var signals = {
      platform: navigator.platform || '',
      screen: window.screen ? (screen.width + 'x' + screen.height + 'x' + screen.colorDepth) : '',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      lang: navigator.language || (navigator.languages && navigator.languages[0]) || '',
      cores: navigator.hardwareConcurrency || 1,
      gpu: getGpuRenderer()
    };

    // Client hints if available
    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      try {
        var hints = await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']);
        if (hints.model) signals.model = hints.model;
        if (hints.platformVersion) signals.platformVersion = hints.platformVersion;
      } catch (e) {}
    }

    var signalStr = JSON.stringify(signals);
    return sha256Hex(signalStr);
  }

  // Descriptive device info object (§4)
  async function getDeviceInfo() {
    var ua = navigator.userAgent || '';
    var isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);
    var pwa = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

    var browser = 'Unknown';
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/Chrome\//i.test(ua)) browser = 'Chrome';
    else if (/Safari\//i.test(ua)) browser = 'Safari';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';

    var os = 'Unknown';
    if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    var model = '';
    var osVersion = '';

    if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
      try {
        var hints = await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']);
        if (hints.model) model = hints.model;
        if (hints.platformVersion) osVersion = hints.platformVersion;
      } catch (e) {}
    }

    return {
      ua: ua,
      browser: browser,
      os: os,
      osVersion: osVersion,
      model: model,
      mobile: isMobile,
      screen: window.screen ? (screen.width + 'x' + screen.height) : '',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      lang: navigator.language || '',
      pwa: pwa
    };
  }

  // Store key entry into IndexedDB
  async function storeKeyEntry(entry) {
    var db = await openKeyDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readwrite');
      var store = tx.objectStore(STORE_NAME);
      var req = store.put(entry);
      req.onsuccess = function () { resolve(entry); };
      req.onerror = function (e) { reject(e.target.error || new Error('Failed to store key')); };
    });
  }

  // Retrieve key entry from IndexedDB
  async function getKeyEntry(studentTrackId) {
    var db = await openKeyDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var req = store.get(studentTrackId);
      req.onsuccess = function (e) { resolve(e.target.result || null); };
      req.onerror = function (e) { reject(e.target.error || new Error('Failed to read key')); };
    });
  }

  // Get all stored keys (for friend-marking detection §13)
  async function getAllStoredKeys() {
    var db = await openKeyDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE_NAME, 'readonly');
      var store = tx.objectStore(STORE_NAME);
      var req = store.getAll();
      req.onsuccess = function (e) { resolve(e.target.result || []); };
      req.onerror = function (e) { reject(e.target.error || new Error('Failed to read all keys')); };
    });
  }

  // Generate or retrieve non-extractable WebCrypto ECDSA P-256 key pair
  async function initOrGetDeviceKey(studentTrackId) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('WebCrypto is not supported on this browser or origin (HTTPS required)');
    }

    // Try reading existing key first
    if (studentTrackId) {
      var existing = await getKeyEntry(studentTrackId);
      if (existing && existing.privateKey && existing.publicKeyJwk) {
        return existing;
      }
    }

    // Attempt persistent storage
    await requestStoragePersistence();

    // Generate non-extractable ECDSA P-256 key pair
    var keyPair = await window.crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256'
      },
      false, // non-extractable private key
      ['sign']
    );

    // Export public key as JWK
    var publicKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
    var keyThumbprint = await computeJwkThumbprint(publicKeyJwk);

    var entry = {
      studentTrackId: studentTrackId || 'pending',
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      publicKeyJwk: publicKeyJwk,
      keyThumbprint: keyThumbprint,
      createdAt: new Date().toISOString()
    };

    if (studentTrackId) {
      await storeKeyEntry(entry);
    }

    return entry;
  }

  // Sign string or buffer payload using the non-extractable private key
  async function signPayload(payload, studentTrackId) {
    var entry = await getKeyEntry(studentTrackId);
    if (!entry || !entry.privateKey) {
      throw new Error('No registered private key found on this device for student: ' + studentTrackId);
    }

    var data = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
    var signatureBuffer = await window.crypto.subtle.sign(
      {
        name: 'ECDSA',
        hash: { name: 'SHA-256' }
      },
      entry.privateKey,
      data
    );

    var signatureArray = Array.from(new Uint8Array(signatureBuffer));
    return signatureArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // Get all key thumbprints stored on this device profile
  async function getAllStoredKeyThumbprints() {
    try {
      var all = await getAllStoredKeys();
      return all.map(function (k) { return k.keyThumbprint; }).filter(Boolean);
    } catch (e) {
      return [];
    }
  }

  // Update trackId binding once confirmed
  async function bindStudentTrackId(tempId, finalTrackId) {
    var entry = await getKeyEntry(tempId);
    if (entry) {
      entry.studentTrackId = finalTrackId;
      await storeKeyEntry(entry);
    }
  }

  // Create signed device proof for attendance marking (§7, T2.1)
  async function createDeviceProof(messagePayload, studentTrackId) {
    var ts = Date.now();
    var installId = getOrCreateInstallId();
    var fingerprintHash = await getFingerprintHash();
    var messageStr = typeof messagePayload === 'string' ? messagePayload : JSON.stringify(messagePayload);
    var toSign = messageStr + ':' + ts;
    var signature = null;

    try {
      var trackIdToUse = studentTrackId;
      if (!trackIdToUse) {
        var allKeys = await getAllStoredKeys();
        if (allKeys && allKeys.length > 0) {
          trackIdToUse = allKeys[0].studentTrackId;
        }
      }
      if (trackIdToUse) {
        signature = await signPayload(toSign, trackIdToUse);
      }
    } catch (e) {
      console.warn('[DeviceKey] Could not sign attendance payload:', e.message);
    }

    return {
      signature: signature,
      ts: ts,
      installId: installId,
      fingerprintHash: fingerprintHash
    };
  }

  // Seamless 15-day student device session refresh (§6, T3.1)
  async function trySessionRefresh() {
    try {
      var allKeys = await getAllStoredKeys();
      if (!allKeys || allKeys.length === 0) {
        return null;
      }
      var keyEntry = allKeys[0];

      var challengeRes = await fetch('/api/auth/device-challenge');
      if (!challengeRes.ok) return null;
      var challengeData = await challengeRes.json();
      if (!challengeData || !challengeData.nonce) return null;

      var signature = await signPayload(challengeData.nonce, keyEntry.studentTrackId);

      var refreshRes = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          studentTrackId: keyEntry.studentTrackId || '',
          deviceTrackId: keyEntry.deviceTrackId || '',
          nonce: challengeData.nonce,
          signature: signature
        })
      });

      if (!refreshRes.ok) return null;
      var refreshData = await refreshRes.json();
      if (refreshData && refreshData.ok && refreshData.token) {
        sessionStorage.setItem('eams_token', refreshData.token);
        sessionStorage.setItem('eams_sessionId', refreshData.sessionId || '');
        sessionStorage.setItem('eams_user', JSON.stringify(refreshData.user));
        sessionStorage.setItem('eams_session_class', refreshData.sessionClass || 'student-device');
        sessionStorage.setItem('eams_login_time', Date.now().toString());
        return refreshData;
      }
      return null;
    } catch (e) {
      console.warn('[DeviceKey] Session refresh failed:', e);
      return null;
    }
  }

  return {
    getOrCreateInstallId: getOrCreateInstallId,
    requestStoragePersistence: requestStoragePersistence,
    checkIosPwaStatus: checkIosPwaStatus,
    getFingerprintHash: getFingerprintHash,
    getDeviceInfo: getDeviceInfo,
    initOrGetDeviceKey: initOrGetDeviceKey,
    getKeyEntry: getKeyEntry,
    storeKeyEntry: storeKeyEntry,
    signPayload: signPayload,
    createDeviceProof: createDeviceProof,
    getAllStoredKeyThumbprints: getAllStoredKeyThumbprints,
    bindStudentTrackId: bindStudentTrackId,
    computeJwkThumbprint: computeJwkThumbprint,
    sha256Hex: sha256Hex,
    trySessionRefresh: trySessionRefresh
  };
}));
