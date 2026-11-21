/**
 * middleware/errorHandler.js
 * 
 * Centralized Express Error Handler (Resolves Checklist N15, C5, S13, B11).
 * Normalizes error responses to standardized JSON contract { error, details?, requestId }.
 * Suppresses internal stack traces and secrets in client responses when running in production.
 */

'use strict';

const cfg = require('../config');

/**
 * Global Express error handling middleware
 */
function errorHandler(err, req, res, next) {
  const reqId = req?.id || req?.headers?.['x-request-id'] || 'N/A';
  const isProd = cfg.NODE_ENV === 'production' || process.env.NODE_ENV === 'production';

  // Always log internal error details server-side
  console.error(`[Muster Express Error] [ReqID: ${reqId}]:`, err);

  if (res.headersSent) {
    return next(err);
  }

  // Database connectivity failures (503)
  if (err.name === 'MongoServerSelectionError' || err.name === 'MongoNetworkError') {
    return res.status(503).json({
      error: 'Database connection temporarily interrupted. Please retry in a moment.',
      dbOffline: true,
      requestId: reqId
    });
  }

  // Mongoose schema validation failures (400)
  if (err.name === 'ValidationError') {
    const details = err.errors
      ? Object.values(err.errors).map(e => e.message || String(e))
      : [err.message];
    return res.status(400).json({
      error: 'Data validation failed',
      details,
      requestId: reqId
    });
  }

  // Mongoose CastError (invalid ObjectId / bad parameter type - 400)
  if (err.name === 'CastError') {
    return res.status(400).json({
      error: `Invalid identifier format for ${err.path || 'field'}`,
      details: isProd ? undefined : err.message,
      requestId: reqId
    });
  }

  // JSON syntax parsing error (400)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      error: 'Malformed JSON payload',
      requestId: reqId
    });
  }

  // Explicit HTTP status code from error object or default to 500
  let status = Number(err.statusCode || err.status);
  if (isNaN(status) || status < 400 || status > 599) {
    status = 500;
  }

  // Suppress internal system stack traces / sensitive server messages for 500s in production
  const errorMessage = (status < 500 || !isProd)
    ? (err.message || 'Error processing request')
    : 'An unexpected internal server error occurred. Please contact administrator.';

  const responseBody = {
    error: errorMessage,
    requestId: reqId
  };

  if (err.details) {
    responseBody.details = err.details;
  } else if (!isProd && status >= 500 && err.stack) {
    responseBody.stack = err.stack;
  }

  return res.status(status).json(responseBody);
}

module.exports = errorHandler;
module.exports.errorHandler = errorHandler;
