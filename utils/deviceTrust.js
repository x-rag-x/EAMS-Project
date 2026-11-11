const crypto = require('crypto');
const M = require('../models');
const { getSettings } = require('./settingsCache');
const { isCampusIpAllowed } = require('./ipCheck');

/**
 * utils/deviceTrust.js
 *
 * Implements EAMS Attendance Gate & Trust Engine (§7, §9, T2.1-T2.5):
 * 1. Verifies non-extractable WebCrypto ECDSA P-256 signatures over mark tokens.
 * 2. Compares browser install ID and stable hardware fingerprint signals.
 * 3. Calculates frozen Device Score (0–50) per §9 weights.
 * 4. Checks student Trust Score (0–100) and account lock status.
 * 5. Evaluates Combined Score (0–100) and Risk Level ('low' | 'medium' | 'high').
 * 6. Generates frozen security snapshot (§4).
 */

const DEFAULT_WEIGHTS = {
  key: 25,
  match: 10,
  location: 10,
  campusIp: 5,
  spoofPenalty: 10
};

/**
 * Evaluates device proof, trust score, and mark risk level.
 *
 * @param {object} params
 * @param {object} params.student - Student mongoose doc or object
 * @param {object} [params.deviceProof] - { signature, ts, installId, fingerprintHash }
 * @param {string|object} params.payload - Signed payload { sessionTrackId, qrTrackId|code }
 * @param {object} [params.location] - { latitude, longitude, accuracy, isClassroomRadiusOk, isCampusGeofenceOk }
 * @param {string} params.ip - Client IP address
 * @param {string} [params.deviceId] - Legacy client device identifier
 * @returns {Promise<object>} Evaluation outcome & security snapshot
 */
async function evaluateDeviceTrust(params) {
  const {
    student,
    deviceProof,
    payload,
    location = {},
    ip = '',
    deviceId = ''
  } = params;

  // 1. Fetch system settings
  const settingsMap = await getSettings(['trust', 'device', 'college_ips']);
  const trustSettings = settingsMap?.trust || {};
  const weights = trustSettings.deviceWeights || DEFAULT_WEIGHTS;
  const allowedCampusIps = settingsMap?.college_ips || [];
  const deviceSettings = settingsMap?.device || {};
  const requireRegistered = deviceSettings.requireRegisteredDevice !== false;

  // 2. Check Student Trust Score & Lock Gate (§7.2, §8)
  const trustObj = student?.trust || {};
  const trustScore = typeof trustObj.score === 'number' ? trustObj.score : 100;
  const isLocked = !!(trustObj.lockedUntil && new Date(trustObj.lockedUntil) > new Date());
  const trustOk = !isLocked && trustScore >= 40;

  if (!trustOk) {
    return {
      allowed: false,
      code: 'TRUST_LOCKED_OR_LOW',
      error: isLocked
        ? `Self-attendance is locked until ${new Date(trustObj.lockedUntil).toLocaleDateString()}. Please meet your department admin.`
        : `Self-attendance is disabled because your trust score (${trustScore}) is below 40. Please meet your department admin.`,
      trustScore,
      isLocked,
      trustOk: false
    };
  }

  // 3. Find registered trusted device (§4, T1)
  const trustedDevice = await M.StudentDevice.findOne({
    studentId: student._id,
    status: 'TRUSTED'
  }).lean();

  let deviceRegisteredOk = false;
  let deviceProofOk = false;
  const riskReasons = [];

  // 4. Verify Cryptographic Signature (T2.1, T2.2)
  if (!trustedDevice) {
    deviceRegisteredOk = false;
    deviceProofOk = false;
    riskReasons.push('Unregistered device (no trusted phone registered for student)');
    if (requireRegistered) {
      return {
        allowed: false,
        code: 'REGISTERED_DEVICE_REQUIRED',
        error: 'Self-attendance requires a registered trusted device. Please register your device in the student portal or contact your advisor.',
        trustScore,
        isLocked,
        trustOk,
        deviceRegisteredOk: false,
        deviceProofOk: false,
        requiresTeacherVerification: true,
        riskLevel: 'high',
        riskReasons
      };
    }
  } else if (!deviceProof || !deviceProof.signature || !deviceProof.ts) {
    deviceRegisteredOk = false;
    deviceProofOk = false;
    riskReasons.push('Missing device cryptographic proof');
  } else {
    // Freshness check: timestamp must be within 60 seconds
    const now = Date.now();
    const proofTs = Number(deviceProof.ts);
    const tsAgeMs = Math.abs(now - proofTs);

    if (isNaN(proofTs) || tsAgeMs > 60000) {
      deviceProofOk = false;
      deviceRegisteredOk = false;
      riskReasons.push(`Device proof timestamp expired (${Math.round(tsAgeMs / 1000)}s old, max allowed: 60s)`);
    } else if (trustedDevice.publicKeyJwk) {
      try {
        const pubKey = crypto.createPublicKey({
          key: trustedDevice.publicKeyJwk,
          format: 'jwk'
        });
        const verify = crypto.createVerify('SHA256');
        const messageStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
        verify.update(`${messageStr}:${deviceProof.ts}`);

        const isValid = verify.verify(
          { key: pubKey, dsaEncoding: 'ieee-p1363' },
          Buffer.from(deviceProof.signature, 'hex')
        );

        if (isValid) {
          deviceProofOk = true;
          deviceRegisteredOk = true;
        } else {
          deviceProofOk = false;
          deviceRegisteredOk = false;
          riskReasons.push('Cryptographic signature verification failed');
        }
      } catch (err) {
        deviceProofOk = false;
        deviceRegisteredOk = false;
        riskReasons.push('Error verifying cryptographic signature');
      }
    }
  }

  // 5. Calculate Device Score (0–50) per §9
  let deviceScore = 0;

  // Signal 1: Valid signature by registered key
  if (deviceProofOk) {
    deviceScore += (weights.key || 25);
  }

  // Signal 2: Install ID and Fingerprint matching
  const clientInstallId = (deviceProof?.installId || deviceId || '').trim();
  const clientFp = (deviceProof?.fingerprintHash || '').trim();

  if (trustedDevice && clientInstallId) {
    if (trustedDevice.installId === clientInstallId && (!clientFp || trustedDevice.fingerprintHash === clientFp)) {
      deviceScore += (weights.match || 10);
    } else if (trustedDevice.installId === clientInstallId) {
      // Fingerprint drifted (e.g. browser update or OS version change)
      deviceScore += Math.floor((weights.match || 10) / 2);
      riskReasons.push('Device hardware fingerprint drifted');
    } else {
      riskReasons.push('Device install ID mismatch');
    }
  }

  // Signal 3: GPS Geolocation matching
  if (location.isClassroomRadiusOk || location.locationOk) {
    deviceScore += (weights.location || 10);
  } else if (location.isCampusGeofenceOk) {
    deviceScore += Math.floor((weights.location || 10) / 2);
  }

  // Signal 4: Campus Network IP
  if (isCampusIpAllowed(ip, allowedCampusIps)) {
    deviceScore += (weights.campusIp || 5);
  }

  // Signal 5: Anti-Spoofing penalties
  if (location.accuracy === 0 || (location.latitude === 0 && location.longitude === 0)) {
    deviceScore -= (weights.spoofPenalty || 10);
    riskReasons.push('Suspicious geolocation fix (zero coordinates or zero reported accuracy)');
  }

  // Signal 6: Device in open DeviceShareCase (§9, capped at 10)
  try {
    const studentObjectId = student?._id;
    const studentTrackId = student?.trackId || String(student?._id || '');
    const openCase = await M.DeviceShareCase.findOne({
      $or: [
        { 'students.studentId': studentObjectId },
        { 'students.studentTrackId': studentTrackId }
      ],
      status: 'OPEN'
    }).lean();
    if (openCase) {
      deviceScore = Math.min(10, deviceScore);
      riskReasons.push('Device involved in active DeviceShareCase investigation (score capped at 10)');
    }
  } catch (caseErr) {}

  // Clamp device score to 0–50
  deviceScore = Math.max(0, Math.min(50, deviceScore));

  // 6. Combined Score (§3 & §4)
  const combinedScore = Math.round((trustScore / 2) + deviceScore);

  // 7. Risk Level & Outcome Determination (§7.2)
  let riskLevel = 'low';
  let requiresTeacherVerification = false;

  if (!deviceRegisteredOk) {
    // Unregistered / new device (§7.2: high risk, pending teacher verification)
    riskLevel = 'high';
    requiresTeacherVerification = true;
    if (!riskReasons.includes('Unregistered device (no trusted phone registered for student)')) {
      riskReasons.push('Unregistered device');
    }
  } else if (trustScore >= 80 && deviceScore >= 35) {
    riskLevel = 'low';
    requiresTeacherVerification = false;
  } else if (trustScore >= 60 || deviceScore >= 25) {
    riskLevel = 'medium';
    requiresTeacherVerification = false;
    riskReasons.push('Enhanced monitoring (trust 60–79 or device score 25–34)');
  } else {
    // Registered device, trust 40–59 or device score < 25
    riskLevel = 'high';
    requiresTeacherVerification = true;
    riskReasons.push('Low trust score or low device score');
  }

  // 8. Construct Frozen Security Snapshot (§4)
  const securitySnapshot = {
    deviceTrackId: trustedDevice?.deviceTrackId || '',
    deviceProofOk: Boolean(deviceProofOk),
    trustScoreAtMark: trustScore,
    deviceScoreAtMark: deviceScore,
    combinedScoreAtMark: combinedScore,
    riskLevelAtMark: riskLevel,
    riskReasons: riskReasons,
    teacherVerification: {
      required: requiresTeacherVerification,
      result: null,
      by: null,
      at: null
    }
  };

  return {
    allowed: true,
    trustOk: true,
    deviceRegisteredOk,
    riskOk: !requiresTeacherVerification,
    requiresTeacherVerification,
    security: securitySnapshot
  };
}


/**
 * AttReg Part 1 (§3.8, §10): Heuristic Forensic Device Trust Engine
 */
const TRUST_VERSION = 1;
const WEIGHTS = {
  exclusiveInSession: 20,
  knownDevice: 20,
  loginSessionLinked: 20,
  userAgentMatch: 10,
  ipMatch: 10,
  geoOk: 15,
  qrWindow: 5,
};
const CAPS = { noDeviceId: 20, sharedDevice: 20 };
const BANDS = { high: 80, medium: 50 };

/**
 * Computes heuristic explainable device trust score (0-100)
 * @param {object} params
 * @param {string} params.method - 'Live QR' | 'QuickPass Code' | 'Manual' | 'Rep Share'
 * @param {string} [params.deviceId]
 * @param {boolean} [params.isSharedInSession]
 * @param {number} [params.priorSessionCount]
 * @param {object} [params.loginEntry] - Matching LoginHistory entry
 * @param {Date} [params.markedAt]
 * @param {string} [params.requestUserAgent]
 * @param {string} [params.requestIp]
 * @param {boolean} [params.locationOk]
 * @param {string} [params.qrWindowType] - 'current' | 'grace' | null
 * @returns {object} { score, band, flags: string[], signals: Array<{key, earned, max, ok}>, v: number }
 */
function computeDeviceTrust(params) {
  const {
    method,
    deviceId
  } = params;

  // Manual and Rep Share have no device link
  if (method === 'Manual' || method === 'Rep Share' || !method) {
    return {
      score: null,
      band: 'na',
      flags: [],
      signals: [],
      v: TRUST_VERSION
    };
  }

  const isSharedInSession = params.isSharedInSession ?? ((params.sharedCountInSession || 1) > 1);
  const priorSessionCount = params.priorSessionCount ?? params.priorSeenCount ?? 0;
  const loginEntry = params.loginEntry || params.loginSession || null;
  const markedAt = params.markedAt || new Date();
  const requestUserAgent = params.requestUserAgent || params.userAgent || '';
  const requestIp = params.requestIp || params.ipAddress || '';
  const locationOk = params.locationOk ?? (params.verificationDetails?.locationOk === true);
  const qrWindowType = params.qrWindowType || 'current';

  const flags = [];
  const signals = [];
  let rawScore = 0;

  // Signal 1: Exclusive in session
  if (!isSharedInSession) {
    rawScore += WEIGHTS.exclusiveInSession;
    signals.push({ key: 'exclusiveInSession', earned: WEIGHTS.exclusiveInSession, max: WEIGHTS.exclusiveInSession, ok: true });
  } else {
    flags.push('SHARED_DEVICE');
    signals.push({ key: 'exclusiveInSession', earned: 0, max: WEIGHTS.exclusiveInSession, ok: false });
  }

  // Signal 2: Known device to student
  if (priorSessionCount >= 3) {
    rawScore += WEIGHTS.knownDevice;
    signals.push({ key: 'knownDevice', earned: WEIGHTS.knownDevice, max: WEIGHTS.knownDevice, ok: true });
  } else if (priorSessionCount > 0) {
    const pts = Math.min(WEIGHTS.knownDevice, 8 + (priorSessionCount * 4));
    rawScore += pts;
    signals.push({ key: 'knownDevice', earned: pts, max: WEIGHTS.knownDevice, ok: true });
  } else {
    rawScore += 8; // first sight
    signals.push({ key: 'knownDevice', earned: 8, max: WEIGHTS.knownDevice, ok: false });
  }

  // Signal 3: Login session link & time window
  if (loginEntry) {
    const lTime = loginEntry.loginTime ? new Date(loginEntry.loginTime).getTime() : 0;
    const oTime = loginEntry.logoutTime ? new Date(loginEntry.logoutTime).getTime() : Date.now() + 86400000;
    const mTime = new Date(markedAt).getTime();
    if (mTime >= (lTime - 60000) && mTime <= (oTime + 60000)) {
      rawScore += WEIGHTS.loginSessionLinked;
      signals.push({ key: 'loginSessionLinked', earned: WEIGHTS.loginSessionLinked, max: WEIGHTS.loginSessionLinked, ok: true });
    } else {
      flags.push('LOGIN_WINDOW_EXPIRED');
      signals.push({ key: 'loginSessionLinked', earned: 5, max: WEIGHTS.loginSessionLinked, ok: false });
    }
  } else {
    signals.push({ key: 'loginSessionLinked', earned: 0, max: WEIGHTS.loginSessionLinked, ok: false });
  }

  // Signal 4: User agent match
  if (loginEntry && loginEntry.userAgent && requestUserAgent) {
    if (loginEntry.userAgent.trim() === requestUserAgent.trim()) {
      rawScore += WEIGHTS.userAgentMatch;
      signals.push({ key: 'userAgentMatch', earned: WEIGHTS.userAgentMatch, max: WEIGHTS.userAgentMatch, ok: true });
    } else {
      flags.push('UA_MISMATCH');
      signals.push({ key: 'userAgentMatch', earned: 0, max: WEIGHTS.userAgentMatch, ok: false });
    }
  } else {
    signals.push({ key: 'userAgentMatch', earned: 5, max: WEIGHTS.userAgentMatch, ok: true });
  }

  // Signal 5: IP match (or /24 subnet match)
  if (loginEntry && loginEntry.ip && requestIp) {
    const lIp = loginEntry.ip.trim();
    const rIp = requestIp.trim();
    if (lIp === rIp) {
      rawScore += WEIGHTS.ipMatch;
      signals.push({ key: 'ipMatch', earned: WEIGHTS.ipMatch, max: WEIGHTS.ipMatch, ok: true });
    } else {
      const lSub = lIp.split('.').slice(0, 3).join('.');
      const rSub = rIp.split('.').slice(0, 3).join('.');
      if (lSub && lSub === rSub) {
        rawScore += 5;
        signals.push({ key: 'ipMatch', earned: 5, max: WEIGHTS.ipMatch, ok: true });
      } else {
        signals.push({ key: 'ipMatch', earned: 0, max: WEIGHTS.ipMatch, ok: false });
      }
    }
  } else {
    signals.push({ key: 'ipMatch', earned: 5, max: WEIGHTS.ipMatch, ok: true });
  }

  // Signal 6: Geolocation OK
  if (locationOk) {
    rawScore += WEIGHTS.geoOk;
    signals.push({ key: 'geoOk', earned: WEIGHTS.geoOk, max: WEIGHTS.geoOk, ok: true });
  } else {
    signals.push({ key: 'geoOk', earned: 0, max: WEIGHTS.geoOk, ok: false });
  }

  // Signal 7: QR Window
  if (qrWindowType === 'current') {
    rawScore += WEIGHTS.qrWindow;
    signals.push({ key: 'qrWindow', earned: WEIGHTS.qrWindow, max: WEIGHTS.qrWindow, ok: true });
  } else if (qrWindowType === 'grace') {
    rawScore += 2;
    flags.push('GRACE_WINDOW');
    signals.push({ key: 'qrWindow', earned: 2, max: WEIGHTS.qrWindow, ok: true });
  } else {
    signals.push({ key: 'qrWindow', earned: 0, max: WEIGHTS.qrWindow, ok: false });
  }

  // Hard caps
  let finalScore = rawScore;
  if (!deviceId) {
    flags.push('NO_DEVICE_ID');
    finalScore = Math.min(finalScore, CAPS.noDeviceId);
  }
  if (isSharedInSession) {
    finalScore = Math.min(finalScore, CAPS.sharedDevice);
  }

  finalScore = Math.max(0, Math.min(100, finalScore));

  let band = 'low';
  if (finalScore >= BANDS.high) band = 'high';
  else if (finalScore >= BANDS.medium) band = 'medium';

  return {
    score: finalScore,
    band,
    flags,
    signals,
    v: TRUST_VERSION
  };
}

module.exports = {
  evaluateDeviceTrust,
  computeDeviceTrust
};
