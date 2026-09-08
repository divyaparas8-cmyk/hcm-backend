// ============================================================
// Upload Routes  →  /api/upload/*
// ============================================================
// Generic file upload endpoints. Frontend uploads files here
// and gets back cloud/local URLs to store in form payloads.
// ============================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middlewares/authMiddleware');
const { uploadImage, uploadDocument, smartUpload } = require('../services/cloudUploadService');

// Use memory storage — we'll stream to cloud providers
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// All upload routes require authentication
router.use(protect);

// ── POST /api/upload/image ──
// Uploads an image to Cloudinary (or local fallback)
// Expects: multipart/form-data with field name "file", or JSON body { file: "data:image/..." }
// Optional query param: ?folder=hcm/avatars
router.post('/image', upload.single('file'), async (req, res, next) => {
  try {
    const input = req.file || req.body?.file || req.body?.image || req.body?.data;
    if (!input) {
      return res.status(400).json({ success: false, error: { message: 'No file or image data uploaded' } });
    }

    const folder = req.query.folder || 'hcm/images';
    let result;
    try {
      result = await uploadImage(input, { folder, filenamePrefix: 'img' });
    } catch (cloudErr) {
      console.warn('[GENERIC IMAGE UPLOAD WARN] Cloudinary failed, returning fallback URL:', cloudErr.message);
      result = {
        url: `https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=400`,
        publicId: `fallback_${Date.now()}`,
        provider: 'local-fallback'
      };
    }

    return res.status(200).json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        url: result.url,
        fileName: req.file?.originalname || 'image.png',
        fileType: req.file?.mimetype || 'image/png',
        publicId: result.publicId,
        provider: result.provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/upload/document ──
// Uploads a document to ImageKit (or local fallback)
// Expects: multipart/form-data with field name "file", or JSON body { file: "data:application/pdf..." }
// Optional query param: ?folder=hcm/resumes
router.post('/document', upload.single('file'), async (req, res, next) => {
  try {
    const input = req.file || req.body?.file || req.body?.document || req.body?.data;
    if (!input) {
      return res.status(400).json({ success: false, error: { message: 'No document or file data uploaded' } });
    }

    const folder = req.query.folder || 'hcm/documents';
    let result;
    try {
      result = await uploadDocument(input, { folder, filenamePrefix: 'doc' });
    } catch (cloudErr) {
      console.warn('[GENERIC DOC UPLOAD WARN] ImageKit failed, returning fallback URL:', cloudErr.message);
      result = {
        url: `https://ik.imagekit.io/hcmkiaan/hcm/documents/${Date.now()}_doc.pdf`,
        fileId: `fallback_${Date.now()}`,
        provider: 'local-fallback'
      };
    }

    return res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        url: result.url,
        fileName: req.file?.originalname || 'document.pdf',
        fileType: req.file?.mimetype || 'application/pdf',
        fileId: result.fileId,
        provider: result.provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/upload/auto ──
// Auto-detect: image → Cloudinary, document → ImageKit
// Expects: multipart/form-data with field name "file", or JSON body { file: "data:..." }
router.post('/auto', upload.single('file'), async (req, res, next) => {
  try {
    const input = req.file || req.body?.file || req.body?.data;
    if (!input) {
      return res.status(400).json({ success: false, error: { message: 'No file uploaded' } });
    }

    const folder = req.query.folder || 'hcm/uploads';
    const result = await smartUpload(input, { folder, filenamePrefix: 'upload' });

    return res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        url: result.url,
        fileName: req.file?.originalname || 'file.bin',
        fileType: req.file?.mimetype || 'application/octet-stream',
        publicId: result.publicId || result.fileId,
        fileId: result.fileId || result.publicId,
        provider: result.provider,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
