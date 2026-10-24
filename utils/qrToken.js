const crypto = require('crypto');

/**
 * Generates a rotating HMAC token for the warden's roll-call QR screen.
 * Rotates every rotateSec seconds (default 15s).
 *
 * Token format: <rollCallId>.<step>.<hmacHex>
 */
function generateQRToken(rollCallId, qrSecret, rotateSec = 15) {
  if (!rollCallId || !qrSecret) {
    throw new Error('rollCallId and qrSecret are required');
  }
  const step = Math.floor(Date.now() / (rotateSec * 1000));
  const payload = `${rollCallId}:${step}`;
  const hmac = crypto.createHmac('sha256', qrSecret).update(payload).digest('hex').slice(0, 16);
  return `${rollCallId}.${step}.${hmac}`;
}

/**
 * Verifies a student check-in QR token.
 * Accepts current step and previous step (step - 1) to tolerate clock drift and scan latency.
 */
function verifyQRToken(tokenString, qrSecret, rotateSec = 15) {
  if (!tokenString || typeof tokenString !== 'string' || !qrSecret) {
    return { valid: false, error: 'Invalid token format or missing secret' };
  }

  const parts = tokenString.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Malformed token structure' };
  }

  const [rollCallId, stepStr, signature] = parts;
  const tokenStep = parseInt(stepStr, 10);
  if (isNaN(tokenStep)) {
    return { valid: false, error: 'Invalid token step' };
  }

  const currentStep = Math.floor(Date.now() / (rotateSec * 1000));
  // Accept current step or immediately preceding step (grace period 15s)
  if (tokenStep !== currentStep && tokenStep !== (currentStep - 1)) {
    return { valid: false, error: 'Token has expired. Please scan the current QR.' };
  }

  const payload = `${rollCallId}:${tokenStep}`;
  const expectedSig = crypto.createHmac('sha256', qrSecret).update(payload).digest('hex').slice(0, 16);

  // Timing safe equality comparison
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: 'Invalid token signature' };
  }

  return { valid: true, rollCallId, step: tokenStep };
}

module.exports = {
  generateQRToken,
  verifyQRToken,
};
