'use strict';

/**
 * Cloud file storage integration (Cloudflare R2 or Google Cloud Storage).
 *
 * Mock mode: R2_ACCESS_KEY_ID and GCS_BUCKET both unset.
 *   - Stores files locally in data/uploads/{siteId}/
 * Real mode: R2 (S3-compatible) or GCS based on env vars.
 */

const fs   = require('fs');
const path = require('path');

const PROVIDER   = process.env.STORAGE_PROVIDER || 'local';
const isMock     = !process.env.R2_ACCESS_KEY_ID && !process.env.GCS_BUCKET;
const UPLOAD_DIR = path.resolve(path.join(process.env.DATA_DIR || './data', 'uploads'));

// R2 config
const R2_BUCKET    = process.env.R2_BUCKET || 'n3ware';
const R2_ENDPOINT  = process.env.R2_ENDPOINT || '';
const R2_REGION    = process.env.R2_REGION || 'auto';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

// GCS config
const GCS_BUCKET    = process.env.GCS_BUCKET || '';
const GCS_PUBLIC_URL = process.env.GCS_PUBLIC_URL || `https://storage.googleapis.com/${GCS_BUCKET}`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _ensureSiteDir(siteId) {
  const dir = path.join(UPLOAD_DIR, siteId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function _getR2Client() {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    region:   R2_REGION,
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function _getGcsClient() {
  const { Storage } = require('@google-cloud/storage');
  return new Storage();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload a file to storage.
 * @param {string} siteId
 * @param {string} fileName
 * @param {Buffer} buffer
 * @param {string} contentType
 * @returns {Promise<{ url, name, size }>}
 */
async function uploadFile(siteId, fileName, buffer, contentType) {
  if (isMock || PROVIDER === 'local') {
    const dir     = _ensureSiteDir(siteId);
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buffer);
    return {
      url:  `/uploads/${siteId}/${fileName}`,
      name: fileName,
      size: buffer.length,
    };
  }

  if (PROVIDER === 'r2' || process.env.R2_ACCESS_KEY_ID) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const client = _getR2Client();
    const key = `${siteId}/${fileName}`;
    await client.send(new PutObjectCommand({
      Bucket:      R2_BUCKET,
      Key:         key,
      Body:        buffer,
      ContentType: contentType,
    }));
    const publicUrl = R2_PUBLIC_URL
      ? `${R2_PUBLIC_URL}/${key}`
      : `/uploads/${siteId}/${fileName}`;
    return { url: publicUrl, name: fileName, size: buffer.length };
  }

  if (PROVIDER === 'gcs' || process.env.GCS_BUCKET) {
    const storage = _getGcsClient();
    const key     = `${siteId}/${fileName}`;
    const file    = storage.bucket(GCS_BUCKET).file(key);
    await file.save(buffer, { contentType, resumable: false });
    const publicUrl = `${GCS_PUBLIC_URL}/${key}`;
    return { url: publicUrl, name: fileName, size: buffer.length };
  }

  throw new Error('No valid storage provider configured');
}

/**
 * Delete a file from storage.
 * @param {string} siteId
 * @param {string} fileName
 * @returns {Promise<void>}
 */
async function deleteFile(siteId, fileName) {
  if (isMock || PROVIDER === 'local') {
    const filePath = path.join(UPLOAD_DIR, siteId, fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }

  if (PROVIDER === 'r2' || process.env.R2_ACCESS_KEY_ID) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const client = _getR2Client();
    await client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: `${siteId}/${fileName}` }));
    return;
  }

  if (PROVIDER === 'gcs' || process.env.GCS_BUCKET) {
    const storage = _getGcsClient();
    await storage.bucket(GCS_BUCKET).file(`${siteId}/${fileName}`).delete();
  }
}

/**
 * List files for a site.
 * @param {string} siteId
 * @returns {Promise<Array<{ name, url, size, lastModified }>>}
 */
async function listFiles(siteId) {
  if (isMock || PROVIDER === 'local') {
    const dir = path.join(UPLOAD_DIR, siteId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return {
        name,
        url:          `/uploads/${siteId}/${name}`,
        size:         stat.size,
        lastModified: stat.mtime.toISOString(),
      };
    });
  }

  if (PROVIDER === 'r2' || process.env.R2_ACCESS_KEY_ID) {
    const { ListObjectsV2Command } = require('@aws-sdk/client-s3');
    const client = _getR2Client();
    const res    = await client.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET,
      Prefix: `${siteId}/`,
    }));
    return (res.Contents || []).map((obj) => {
      const name = obj.Key.replace(`${siteId}/`, '');
      const publicUrl = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${obj.Key}` : `/uploads/${siteId}/${name}`;
      return { name, url: publicUrl, size: obj.Size, lastModified: obj.LastModified.toISOString() };
    });
  }

  if (PROVIDER === 'gcs' || process.env.GCS_BUCKET) {
    const storage   = _getGcsClient();
    const [files]   = await storage.bucket(GCS_BUCKET).getFiles({ prefix: `${siteId}/` });
    return files.map((f) => {
      const name = f.name.replace(`${siteId}/`, '');
      return {
        name,
        url:          `${GCS_PUBLIC_URL}/${f.name}`,
        size:         Number(f.metadata.size || 0),
        lastModified: f.metadata.updated || new Date().toISOString(),
      };
    });
  }

  return [];
}

/**
 * Get a pre-signed URL for direct browser upload.
 * @param {string} siteId
 * @param {string} fileName
 * @returns {Promise<{ uploadUrl, publicUrl }>}
 */
async function getSignedUploadUrl(siteId, fileName) {
  if (isMock || PROVIDER === 'local') {
    return {
      uploadUrl: `/api/sites/${siteId}/upload`,
      publicUrl: `/uploads/${siteId}/${fileName}`,
    };
  }

  if (PROVIDER === 'r2' || process.env.R2_ACCESS_KEY_ID) {
    const { getSignedUrl }   = require('@aws-sdk/s3-request-presigner');
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    const client = _getR2Client();
    const key    = `${siteId}/${fileName}`;
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: R2_BUCKET, Key: key }),
      { expiresIn: 3600 }
    );
    const publicUrl = R2_PUBLIC_URL ? `${R2_PUBLIC_URL}/${key}` : `/uploads/${siteId}/${fileName}`;
    return { uploadUrl, publicUrl };
  }

  if (PROVIDER === 'gcs' || process.env.GCS_BUCKET) {
    const storage = _getGcsClient();
    const key     = `${siteId}/${fileName}`;
    const [uploadUrl] = await storage.bucket(GCS_BUCKET).file(key).getSignedUrl({
      version: 'v4',
      action:  'write',
      expires: Date.now() + 3600 * 1000,
    });
    return { uploadUrl, publicUrl: `${GCS_PUBLIC_URL}/${key}` };
  }

  throw new Error('No valid storage provider configured');
}

module.exports = { uploadFile, deleteFile, listFiles, getSignedUploadUrl };
