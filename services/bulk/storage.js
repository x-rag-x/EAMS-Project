const mongoose = require('mongoose');
const crypto = require('crypto');
const { Readable } = require('stream');

let _bucket = null;

function getBucket() {
  if (!_bucket) {
    if (!mongoose.connection.db) {
      throw new Error('Database connection not established');
    }
    _bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: 'bulkFiles'
    });
  }
  return _bucket;
}

/**
 * Stores a file buffer in MongoDB GridFS bucket 'bulkFiles'
 * 
 * @param {Buffer} buffer
 * @param {string} filename
 * @param {Object} [metadata]
 * @returns {Promise<{ gridFsId: mongoose.Types.ObjectId, size: number, sha256: string }>}
 */
async function put(buffer, filename, metadata = {}) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const bucket = getBucket();

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, {
      metadata: {
        ...metadata,
        sha256: hash,
        uploadedAt: new Date()
      }
    });

    const readable = Readable.from(buffer);
    readable.pipe(uploadStream)
      .on('error', reject)
      .on('finish', () => {
        resolve({
          gridFsId: uploadStream.id,
          size: buffer.length,
          sha256: hash
        });
      });
  });
}

/**
 * Retrieves a file from GridFS by its ObjectId
 * 
 * @param {string|mongoose.Types.ObjectId} gridFsId
 * @returns {Promise<Buffer>}
 */
async function get(gridFsId) {
  const bucket = getBucket();
  const id = typeof gridFsId === 'string' ? new mongoose.Types.ObjectId(gridFsId) : gridFsId;

  return new Promise((resolve, reject) => {
    const downloadStream = bucket.openDownloadStream(id);
    const chunks = [];

    downloadStream.on('data', chunk => chunks.push(chunk));
    downloadStream.on('error', reject);
    downloadStream.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

/**
 * Deletes a file from GridFS
 */
async function remove(gridFsId) {
  try {
    const bucket = getBucket();
    const id = typeof gridFsId === 'string' ? new mongoose.Types.ObjectId(gridFsId) : gridFsId;
    await bucket.delete(id);
    return true;
  } catch (err) {
    console.warn('[GridFS Delete Warning]:', err.message);
    return false;
  }
}

module.exports = {
  put,
  get,
  remove,
  getBucket
};
