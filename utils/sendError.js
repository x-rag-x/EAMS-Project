const cfg = require('../config');

/**
 * Centralized error responder that logs internal server errors with request ID
 * and returns safe generic error messages in production while exposing details
 * during development or for client-side (4xx) errors.
 *
 * @param {import('express').Response} res - Express response object
 * @param {Error|string} err - The error object or error message
 * @param {number} [status=500] - HTTP status code
 * @param {string} [fallbackMessage] - Optional user-friendly message
 */
function sendError(res, err, status = 500, fallbackMessage) {
  const req = res && res.req;
  const reqId = (req && req.id) || 'N/A';
  const statusCode = Number(status) || 500;

  if (statusCode >= 500) {
    console.error(`[EAMS API Error] [ReqID: ${reqId}]:`, err);
  } else {
    console.warn(`[EAMS Client Error] [ReqID: ${reqId}] (${statusCode}):`, (err && err.message) || err);
  }

  if (res && res.headersSent) {
    return;
  }

  const isProd = cfg.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';
  let message;

  if (statusCode < 500) {
    message = (err && err.message) || (typeof err === 'string' ? err : null) || fallbackMessage || 'Error processing request';
  } else if (!isProd) {
    message = (err && err.message) || (typeof err === 'string' ? err : null) || fallbackMessage || 'An unexpected internal server error occurred';
  } else {
    message = fallbackMessage || 'An unexpected internal server error occurred. Please contact administrator.';
  }

  return res.status(statusCode).json({
    error: message,
    requestId: reqId
  });
}

module.exports = { sendError };
