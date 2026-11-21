// Database and server runtime configuration

require('dotenv').config();
const crypto = require('crypto');

// Treat development as an explicit opt-in; default to production
const isExplicitDev = process.env.NODE_ENV === 'development';
const isTest = process.env.NODE_ENV === 'test';
const nodeEnv = (isExplicitDev || isTest) ? (process.env.NODE_ENV) : (process.env.NODE_ENV || 'production');
process.env.NODE_ENV = nodeEnv;

// Mandatory security and connection invariants: refuse to start if any core secret/connection is missing
const REQUIRED_ENV_VARS = [
  'JWT_SECRET',
  'LOG_ENCRYPTION_KEY',
  'QRID_ENCRYPTION_KEY',
  'SID_ENCRYPTION_KEY',
  'MONGO_URI',
];

const missingEnvVars = REQUIRED_ENV_VARS.filter(key => !process.env[key] || !process.env[key].trim());
if (missingEnvVars.length > 0) {
  const errorMsg = `[FATAL] Missing required environment variable(s): ${missingEnvVars.join(', ')}. Refusing to start server.`;
  console.error(errorMsg);
  throw new Error(errorMsg);
}

// Check for insecure defaults when in production (S11, S20, S14)
if (nodeEnv === 'production') {
  const INSECURE_DEFAULTS = new Set([
    'dev-secret', 'secret', 'changeme', 'password', 'default', '123456', 'admin', 'jwt-secret', 'eams-admin@123'
  ]);
  const secretsToCheck = ['JWT_SECRET', 'LOG_ENCRYPTION_KEY', 'QRID_ENCRYPTION_KEY', 'SID_ENCRYPTION_KEY'];
  for (const sName of secretsToCheck) {
    const val = (process.env[sName] || '').trim().toLowerCase();
    if (INSECURE_DEFAULTS.has(val)) {
      const errorMsg = `[FATAL] Insecure default detected for ${sName} in production mode. Refusing to start server.`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
  }
}

// N22: Remove the published fallback timetable share secret ('dev-secret-tt-links')
let ttLinkSecret = process.env.TT_LINK_SECRET;
if (!ttLinkSecret || !ttLinkSecret.trim()) {
  if (process.env.STRICT_PRODUCTION_SECRETS === 'true') {
    const errorMsg = '[FATAL] TT_LINK_SECRET must be explicitly configured.';
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  // Cryptographically strong random secret instead of published fallback
  ttLinkSecret = crypto.randomBytes(32).toString('hex');
}

module.exports = {
  // MongoDB database connection settings
  MONGO_URI: process.env.MONGO_URI,
  DB_NAME:   process.env.DB_NAME,

  // Application server settings
  PORT:      process.env.PORT      || 3000,
  NODE_ENV:  nodeEnv,

  // Default credentials and action authorization passwords
  STUDENT_PASSWORD:     process.env.studentPassword,
  TEACHER_PASSWORD:     process.env.teacherPassword,
  ADMIN_PASSWORD:       process.env.adminPassword,
  DELETE_DATA_PASSWORD: process.env.deleteDataPassword,
  EXPORT_DATA_PASSWORD: process.env.exportDataPassword,

  // Authentication tokens and encryption security settings
  JWT_SECRET:         process.env.JWT_SECRET,
  BOARD_JWT_SECRET:   process.env.BOARD_JWT_SECRET || (process.env.JWT_SECRET + '-board'),
  JWT_EXPIRES_IN:     process.env.JWT_EXPIRES_IN || '24h',
  BCRYPT_ROUNDS:      parseInt(process.env.BCRYPT_ROUNDS, 10) || 10,
  LOG_ENCRYPTION_KEY: process.env.LOG_ENCRYPTION_KEY,

  // Allowed cross-origin resource sharing origins
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5500',

  // Production domain for QR code generation (use in production, localhost in dev)
  PRODUCTION_DOMAIN: process.env.PRODUCTION_DOMAIN || '',
  GDRIVE_BACKUP_FOLDER_ID: process.env.GDRIVE_BACKUP_FOLDER_ID || '',
  GDRIVE_BULK_FOLDER_ID: process.env.GDRIVE_BULK_FOLDER_ID || '',
  QRID_ENCRYPTION_KEY: process.env.QRID_ENCRYPTION_KEY,
  SID_ENCRYPTION_KEY: process.env.SID_ENCRYPTION_KEY,
  TT_LINK_SECRET: ttLinkSecret,
  isDevServer: () => process.env.NODE_ENV !== 'production',
};
