const dept = require('./dept');
const teacher = require('./teacher');
const classSchema = require('./class');
const subject = require('./subject');
const student = require('./student');

const schemas = {
  dept,
  teacher,
  class: classSchema,
  subject,
  student
};

/**
 * Normalizes a header or alias string: lower-cased with non-alphanumeric characters stripped.
 * Examples:
 *   "Course Type" -> "coursetype"
 *   "Department_Name" -> "departmentname"
 *   "E-mail" -> "email"
 */
function normalizeHeader(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Retrieves the schema definition for a given import type
 */
function getSchema(type) {
  const schema = schemas[type];
  if (!schema) {
    throw new Error(`Unsupported bulk import schema type: "${type}"`);
  }
  return schema;
}

/**
 * Resolves a sheet column header to a known schema column using EXACT match on normalized strings (A6).
 * No substring/includes matching is used.
 */
function findColumn(type, headerText) {
  const schema = getSchema(type);
  const norm = normalizeHeader(headerText);
  if (!norm) return null;

  for (const col of schema.columns) {
    if (normalizeHeader(col.key) === norm) return col;
    if (normalizeHeader(col.label) === norm) return col;
    for (const alias of (col.aliases || [])) {
      if (normalizeHeader(alias) === norm) return col;
    }
  }

  return null;
}

module.exports = {
  schemas,
  getSchema,
  findColumn,
  normalizeHeader
};
