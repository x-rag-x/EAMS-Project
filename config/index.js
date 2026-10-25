// Database and server runtime configuration

require('dotenv').config();

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

// Treat development as an explicit opt-in; default to production
const isExplicitDev = process.env.NODE_ENV === 'development';
const nodeEnv = isExplicitDev ? 'development' : (process.env.NODE_ENV || 'production');
process.env.NODE_ENV = nodeEnv;

function isDevServer() {
  return process.env.NODE_ENV === 'development';
}

module.exports = {
  isDevServer,
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
  BCRYPT_ROUNDS:      parseInt(process.env.BCRYPT_ROUNDS) || 10,
  LOG_ENCRYPTION_KEY: process.env.LOG_ENCRYPTION_KEY,

  // Allowed cross-origin resource sharing origins
  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5500',

  // Production domain for QR code generation (use in production, localhost in dev)
  PRODUCTION_DOMAIN: process.env.PRODUCTION_DOMAIN || '',
  QRID_ENCRYPTION_KEY: process.env.QRID_ENCRYPTION_KEY,
  SID_ENCRYPTION_KEY: process.env.SID_ENCRYPTION_KEY,
};
