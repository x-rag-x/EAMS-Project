/**
 * Sanitize query parameters to prevent NoSQL injection.
 * Converts query values to primitives (strings, numbers, booleans, dates)
 * and rejects nested objects that could contain MongoDB operators.
 *
 * Express's qs parser converts ?role[$ne]=x into {role: {$ne: 'x'}},
 * which would bypass string comparisons in filters. This function prevents that.
 */

/**
 * Sanitize a single query parameter value.
 * - If it's an object (not Date/Array), reject and return undefined
 * - If it's a string, return as-is
 * - If it's a number/boolean, return as-is
 * - If it's a Date, return as-is
 * - Otherwise return undefined
 */
function sanitizeQueryValue(value) {
  if (value === null || value === undefined) return undefined;
  
  // Allow primitives: strings, numbers, booleans
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  
  // Allow Date objects (for date filters)
  if (value instanceof Date) {
    return value;
  }
  
  // Reject plain objects (potential NoSQL injection via operators like {$ne, $gt, etc})
  if (typeof value === 'object' && !Array.isArray(value)) {
    console.warn('Rejected potentially malicious query object:', value);
    return undefined;
  }
  
  // Reject arrays of query parameters
  if (Array.isArray(value)) {
    return undefined;
  }
  
  return undefined;
}

/**
 * Sanitize multiple query parameters.
 * Whitelist-based: only include parameters you explicitly allow.
 *
 * @param {Object} queryParams - req.query object
 * @param {Array<string>} allowedFields - List of field names to extract and sanitize
 * @returns {Object} Sanitized filter object with only allowed fields
 *
 * Example:
 *   sanitizeQuery(req.query, ['role', 'status', 'deptId'])
 *   Input:  {role: 'admin', status: {$ne: 'inactive'}, extra: 'ignored'}
 *   Output: {role: 'admin'}  (status rejected, extra ignored)
 */
function sanitizeQuery(queryParams, allowedFields = []) {
  const sanitized = {};
  
  for (const field of allowedFields) {
    const value = queryParams[field];
    const cleanValue = sanitizeQueryValue(value);
    
    if (cleanValue !== undefined) {
      sanitized[field] = cleanValue;
    }
  }
  
  return sanitized;
}

/**
 * Sanitize a specific query parameter to a string.
 * Useful for scalar filters where you expect a string value.
 *
 * @param {any} value - Query parameter value
 * @returns {string|undefined} The value as a string, or undefined if rejected
 */
function sanitizeToString(value) {
  const sanitized = sanitizeQueryValue(value);
  if (sanitized === undefined) return undefined;
  if (typeof sanitized === 'string') return sanitized;
  return String(sanitized);
}

/**
 * Sanitize a specific query parameter to a number.
 * Useful for numeric filters (e.g., deptId, classId).
 *
 * @param {any} value - Query parameter value
 * @returns {number|undefined} The value as a number, or undefined if rejected
 */
function sanitizeToNumber(value) {
  const sanitized = sanitizeQueryValue(value);
  if (sanitized === undefined) return undefined;
  if (typeof sanitized === 'number') return sanitized;
  const num = Number(sanitized);
  return isNaN(num) ? undefined : num;
}

/**
 * Sanitize a specific query parameter to an ObjectId string.
 * Validates that the value is a valid MongoDB ObjectId format.
 *
 * @param {any} value - Query parameter value
 * @returns {string|undefined} The value as a string if valid ObjectId format, else undefined
 */
function sanitizeToObjectId(value) {
  const str = sanitizeToString(value);
  if (!str) return undefined;
  // MongoDB ObjectId must be 24 hex characters
  if (/^[0-9a-f]{24}$/i.test(str)) {
    return str;
  }
  return undefined;
}

module.exports = {
  sanitizeQueryValue,
  sanitizeQuery,
  sanitizeToString,
  sanitizeToNumber,
  sanitizeToObjectId,
};
