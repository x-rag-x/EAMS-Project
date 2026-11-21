/**
 * utils/asyncHandler.js
 * 
 * Standard Express Async Handler Wrapper (Resolves Checklist N15, C5).
 * Catches rejected promises from async route handlers and passes them to next(err).
 */

'use strict';

/**
 * Wraps an async Express middleware/route handler to catch unhandled promise rejections.
 * 
 * @param {Function} fn - Async middleware or route handler function (req, res, next)
 * @returns {Function} Express middleware function
 */
const asyncHandler = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
module.exports.asyncHandler = asyncHandler;
