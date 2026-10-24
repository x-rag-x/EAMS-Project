#!/usr/bin/env node
/**
 * scripts/unlockUser.js — Break-Glass CLI Account Unlock Script
 * 
 * Usage:
 *   node scripts/unlockUser.js <username> [--reset-password <newPassword>]
 * 
 * Part of Sign-in Phase S6.5 (Hardening + Break-Glass Recovery).
 */

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('@node-rs/bcrypt');
const cfg = require('../config');
const M = require('../models');
const { clearBlocksForUser } = require('../utils/securityBlockService');
const { logAction } = require('../utils/logAction');

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Usage:
  node scripts/unlockUser.js <username> [--reset-password <newPassword>]

Options:
  --reset-password <newPassword>   Optionally reset the password for the unlocked user
  --help, -h                       Show this help message
`);
    process.exit(0);
  }

  const username = String(args[0]).toLowerCase().trim();
  let resetPassword = null;
  const pwIdx = args.indexOf('--reset-password');
  if (pwIdx !== -1 && args[pwIdx + 1]) {
    resetPassword = args[pwIdx + 1].trim();
  }

  console.log(`[unlockUser] Connecting to MongoDB (${cfg.DB_NAME})...`);
  await mongoose.connect(cfg.MONGO_URI, { dbName: cfg.DB_NAME });

  try {
    const user = await M.User.findOne({ username });
    if (!user) {
      console.error(`[unlockUser] Error: User "${username}" not found in User collection.`);
      process.exit(1);
    }

    const previousStatus = user.status;
    const previousFailed = user.failedLogins || 0;
    const previousLockedUntil = user.lockedUntil;

    // Reset User lockout fields (S6.2 source-of-truth)
    user.status = 'active';
    user.failedLogins = 0;
    user.lockedUntil = null;
    await user.save();

    // Mirror to LoginHistory
    if (user.trackId) {
      await M.LoginHistory.updateOne(
        { trackId: user.trackId },
        { $set: { failedLogins: 0, lockedUntil: null } }
      ).catch(() => {});
    }

    // Clear IP / identifier blocks
    await clearBlocksForUser(username).catch(() => {});

    let pwResetNotice = '';
    if (resetPassword) {
      const rounds = cfg.BCRYPT_ROUNDS || 10;
      const hashed = await bcrypt.hash(resetPassword, rounds);

      if (user.role === 'teacher') {
        await M.Teacher.updateOne(
          { username },
          { $set: { password: hashed, mustChangePassword: true } }
        );
      } else if (user.role === 'student') {
        await M.Student.updateOne(
          { username },
          { $set: { password: hashed, mustChangePassword: true } }
        );
      }

      if (M.Password) {
        await M.Password.updateOne(
          { username },
          { $set: { hash: hashed, updatedAt: new Date() } }
        ).catch(() => {});
      }

      pwResetNotice = `\n  - Password: Password successfully updated (mustChangePassword set)`;
    }

    // Audit log
    await logAction(
      user.trackId || user._id,
      'Break-Glass CLI',
      'system',
      'Account Unlocked via Break-Glass CLI',
      `Break-glass script unlocked account for "${username}". Status: ${previousStatus} -> active. Reset password: ${Boolean(resetPassword)}`,
      'security',
      'warning',
      '127.0.0.1',
      '',
      { module: 'system', subType: 'break-glass-unlock', username, trackId: user.trackId }
    ).catch(() => {});

    console.log(`
=====================================================
  Break-Glass Account Unlock Complete
=====================================================
  - Username:       ${user.username}
  - Role:           ${user.role}
  - Track ID:       ${user.trackId || 'N/A'}
  - Previous State: Status=${previousStatus}, FailedAttempts=${previousFailed}, LockedUntil=${previousLockedUntil || 'none'}
  - New State:      Status=active, FailedAttempts=0, LockedUntil=null${pwResetNotice}
  - Security Block: Cleared
=====================================================
`);
  } catch (err) {
    console.error(`[unlockUser] Unexpected error:`, err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
