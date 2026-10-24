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

module.exports = {
  evaluateDeviceTrust
};
