'use strict';

/**
 * File upload API routes.
 *
 * POST   /api/uploads/:siteId/upload     — upload a single file (multipart)
 * GET    /api/uploads/:siteId/files      — list files for a site
 * DELETE /api/uploads/:siteId/files/:name — delete a file
 * GET    /api/uploads/:siteId/upload-url — get pre-signed upload URL
 */

const express      = require('express');
const multer       = require('multer');
const storageCloud = require('../integrations/storage-cloud');
const { authOrApiKey } = require('./auth');

const router = express.Router();

// ---------------------------------------------------------------------------
// Multer configuration — in-memory storage, 5 MB limit, web-safe file types
// ---------------------------------------------------------------------------
const ALLOWED_MIME_TYPES = new Set([
  // Images
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'image/avif', 'image/bmp', 'image/tiff',
  // Web assets
  'text/css', 'text/javascript', 'application/javascript',
  'application/json', 'text/html', 'text/plain',
  // Fonts
  'font/woff', 'font/woff2', 'font/ttf', 'application/font-woff',
  // Documents (commonly embedded)
  'application/pdf',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported file type: ${file.mimetype}`));
    }
  },
});

// Apply auth to all routes in this router.
router.use(authOrApiKey);

// ---------------------------------------------------------------------------
// POST /:siteId/upload — upload a single file
// ---------------------------------------------------------------------------
router.post('/:siteId/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded (field name must be "file")' });
    }

    const { siteId }   = req.params;
    const { originalname, buffer, mimetype, size } = req.file;

    const result = await storageCloud.uploadFile(siteId, originalname, buffer, mimetype);
    res.status(201).json({ file: { url: result.url, name: result.name, size: size || result.size } });
  } catch (err) {
    if (err.code && err.code.startsWith('LIMIT_')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:siteId/files — list all files for a site
// ---------------------------------------------------------------------------
router.get('/:siteId/files', async (req, res) => {
  try {
    const { siteId } = req.params;
    const files      = await storageCloud.listFiles(siteId);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:siteId/files/:name — delete a specific file
// ---------------------------------------------------------------------------
router.delete('/:siteId/files/:name', async (req, res) => {
  try {
    const { siteId, name } = req.params;
    await storageCloud.deleteFile(siteId, name);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /:siteId/upload-url — get pre-signed URL for direct browser upload
// ---------------------------------------------------------------------------
router.get('/:siteId/upload-url', async (req, res) => {
  try {
    const { siteId } = req.params;
    const fileName   = (req.query.fileName || '').trim();

    if (!fileName) {
      return res.status(400).json({ error: 'Query parameter "fileName" is required' });
    }

    const result = await storageCloud.getSignedUploadUrl(siteId, fileName);
    res.json({ uploadUrl: result.uploadUrl, publicUrl: result.publicUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Multer error handler
// ---------------------------------------------------------------------------
router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(500).json({ error: err.message });
  }
  next();
});

module.exports = router;
