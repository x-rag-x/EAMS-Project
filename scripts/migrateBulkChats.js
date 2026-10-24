require('dotenv').config();
const mongoose = require('mongoose');
const cfg = require('../config');
const M = require('../models');
const storage = require('../services/bulk/storage');

async function migrateBulkChats() {
  console.log('> Starting Bulk Chats Migration (Idempotent)...');

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(cfg.MONGO_URI, {
      dbName: cfg.DB_NAME,
      serverSelectionTimeoutMS: 8000
    });
    console.log(`Connected to MongoDB: ${cfg.DB_NAME}`);
  }

  const batches = await M.BulkImportBatch.find({});
  console.log(`Found ${batches.length} batch(es) to inspect.`);

  let migratedCount = 0;
  let fileMovedCount = 0;
  let messagesCreatedCount = 0;

  for (const batch of batches) {
    let dirty = false;

    // 1. Title
    if (!batch.title) {
      const typeLabel = batch.type.charAt(0).toUpperCase() + batch.type.slice(1);
      batch.title = `${typeLabel} Import · ${batch.batchTrackId.slice(-6)}`;
      dirty = true;
    }

    // 2. Timestamps
    if (!batch.lastMessageAt) {
      batch.lastMessageAt = batch.updatedAt || batch.createdAt || new Date();
      dirty = true;
    }

    // 3. Move base64 file buffer to GridFS if not yet stored
    if (batch.fileBufferBase64 && (!batch.fileRef || !batch.fileRef.gridFsId)) {
      try {
        const buffer = Buffer.from(batch.fileBufferBase64, 'base64');
        const filename = batch.originalFileName || `${batch.batchTrackId}.xlsx`;
        const fileRef = await storage.put(buffer, filename, {
          batchId: batch._id,
          migrated: true,
          migratedAt: new Date()
        });
        batch.fileRef = fileRef;
        fileMovedCount++;
        dirty = true;
      } catch (fErr) {
        console.warn(`[Migrate] Warning migrating file buffer for batch ${batch.batchTrackId}:`, fErr.message);
      }
    }

    // 4. Synthesize messages from roadmap if chat has 0 messages
    const existingMsgCount = await M.BulkChatMessage.countDocuments({ batchId: batch._id });
    if (existingMsgCount === 0) {
      let seq = 0;
      const uploaderActor = {
        userId: batch.uploadedBy?.userId || null,
        name:   batch.uploadedBy?.name || 'User',
        role:   batch.uploadedBy?.role || 'teacher'
      };

      // Type selection bubble
      seq++;
      await M.BulkChatMessage.create({
        batchId: batch._id,
        seq,
        kind: 'card',
        card: 'type',
        author: 'user',
        actor: uploaderActor,
        payload: { type: batch.type },
        createdAt: batch.createdAt || new Date()
      });

      // Column reference card
      seq++;
      await M.BulkChatMessage.create({
        batchId: batch._id,
        seq,
        kind: 'card',
        card: 'column-ref',
        author: 'system',
        payload: { type: batch.type },
        createdAt: batch.createdAt || new Date()
      });

      // File upload card if file exists
      if (batch.originalFileName || batch.fileBufferBase64) {
        seq++;
        await M.BulkChatMessage.create({
          batchId: batch._id,
          seq,
          kind: 'card',
          card: 'file',
          author: 'user',
          actor: uploaderActor,
          payload: {
            name: batch.originalFileName || 'spreadsheet.xlsx',
            size: batch.fileRef?.size || 0
          },
          createdAt: batch.createdAt || new Date()
        });
      }

      // Summary card if staged rows exist
      if (batch.totalRows > 0 || ['staged', 'skipped_resolved', 'pending_sudo_initial', 'sudo_initial_approved', 'verifying', 'verified_all', 'pending_final_approval', 'committed'].includes(batch.status)) {
        seq++;
        await M.BulkChatMessage.create({
          batchId: batch._id,
          seq,
          kind: 'card',
          card: 'summary',
          author: 'system',
          payload: {
            eligibleCount: batch.eligibleCount,
            skippedCount: batch.skippedCount,
            totalRows: batch.totalRows,
            driveFolder: batch.drive?.folderName,
            driveUrl: batch.drive?.folderUrl
          },
          createdAt: batch.createdAt || new Date()
        });
      }

      // Sudo review card if approval was recorded
      if (batch.sudoInitialApproval?.approved || ['sudo_initial_approved', 'verifying', 'verified_all', 'pending_final_approval', 'committed'].includes(batch.status)) {
        seq++;
        await M.BulkChatMessage.create({
          batchId: batch._id,
          seq,
          kind: 'card',
          card: 'sudo-review',
          author: 'system',
          payload: {
            approved: true,
            approvedBy: batch.sudoInitialApproval?.approvedBy || 'Sudo Admin',
            notes: batch.sudoInitialApproval?.notes || ''
          },
          createdAt: batch.sudoInitialApproval?.approvedAt || new Date()
        });
      }

      // Final / Completed card if committed
      if (batch.status === 'committed') {
        seq++;
        await M.BulkChatMessage.create({
          batchId: batch._id,
          seq,
          kind: 'card',
          card: 'complete',
          author: 'system',
          payload: {
            addedCount: batch.verifiedCount || batch.eligibleCount,
            driveUrl: batch.backup?.driveWebViewLink
          },
          createdAt: batch.backup?.archivedAt || batch.updatedAt || new Date()
        });
      } else if (batch.status === 'rejected') {
        seq++;
        await M.BulkChatMessage.create({
          batchId: batch._id,
          seq,
          kind: 'card',
          card: 'rejected',
          author: 'system',
          payload: {
            reason: batch.rejection?.reason || 'Import rejected'
          },
          createdAt: batch.rejection?.at || batch.updatedAt || new Date()
        });
      }

      batch.messageSeq = seq;
      batch.lastMessagePreview = `Import status: ${batch.status}`;
      messagesCreatedCount += seq;
      dirty = true;
    }

    if (dirty) {
      await batch.save();
      migratedCount++;
    }
  }

  console.log(`\nMigration completed:`);
  console.log(`- Batches migrated/updated: ${migratedCount}`);
  console.log(`- Files moved to GridFS:   ${fileMovedCount}`);
  console.log(`- Messages synthesized:    ${messagesCreatedCount}`);
}

if (require.main === module) {
  migrateBulkChats()
    .then(() => {
      console.log('✓ Migration finished successfully.');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration error:', err);
      process.exit(1);
    });
}

module.exports = { migrateBulkChats };
