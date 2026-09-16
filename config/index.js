// Database and server runtime configuration

require('dotenv').config();

module.exports = {
  // MongoDB database connection settings
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/eams_db',
  DB_NAME:   process.env.DB_NAME,

  // Application server settings
  PORT:      process.env.PORT      || 3000,
  NODE_ENV:  process.env.NODE_ENV  || 'development',

  // Default credentials and action authorization passwords
  STUDENT_PASSWORD:     process.env.studentPassword,
  TEACHER_PASSWORD:     process.env.teacherPassword,
  ADMIN_PASSWORD:       process.env.adminPassword,
  DELETE_DATA_PASSWORD: process.env.deleteDataPassword,
  EXPORT_DATA_PASSWORD: process.env.exportDataPassword,

  // Authentication tokens and encryption security settings
  JWT_SECRET:         process.env.JWT_SECRET,
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
