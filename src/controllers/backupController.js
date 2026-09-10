// ============================================================
// Organization Backup & Export Controller
// ============================================================

const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const { AVAILABLE_MODULES, runBackupJob } = require('../services/backupService');
const googleDriveService = require('../services/googleDriveService');
const { sendEmail } = require('../utils/emailService');

// Helper to serialize BigInt for JSON responses
const serializeBackup = (b) => ({
  ...b,
  fileSize: b.fileSize != null ? Number(b.fileSize) : null,
  recordCounts: b.recordCounts ? JSON.parse(b.recordCounts) : {},
  includedModules: b.includedModules ? JSON.parse(b.includedModules) : []
});

/**
 * GET /api/admin/backups/modules
 * Return available modules for backup selection
 */
const getAvailableModules = async (req, res, next) => {
  try {
    return res.status(200).json({ success: true, data: AVAILABLE_MODULES });
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/backups/overview
 * Top stats for the Backup Center (Last backup, storage, plan, etc.)
 */
const getBackupOverview = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) {
      return res.status(400).json({ success: false, error: { message: 'Organization required.' } });
    }

    const [org, lastBackup, totalBackups, completedBackups] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        include: { pricingPlan: true }
      }),
      prisma.backupJob.findFirst({
        where: { organizationId, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.backupJob.count({ where: { organizationId } }),
      prisma.backupJob.findMany({
        where: { organizationId, status: 'COMPLETED' },
        select: { fileSize: true }
      })
    ]);

    const totalSizeBytes = completedBackups.reduce((acc, b) => acc + (b.fileSize != null ? Number(b.fileSize) : 0), 0);
    const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);

    return res.status(200).json({
      success: true,
      data: {
        organization: org?.name || 'Organization',
        plan: org?.pricingPlan?.name || org?.subscriptionStatus || 'Professional',
        lastBackupDate: lastBackup?.completedAt || lastBackup?.createdAt || null,
        lastBackupStatus: lastBackup?.status || 'Never',
        lastBackupSize: lastBackup?.fileSize != null ? Number(lastBackup.fileSize) : 0,
        totalBackups,
        totalStorageUsedMB: Number(totalSizeMB),
        allocatedStorageMB: 5120, // 5GB standard tenant allowance
        retentionDays: org?.backupRetentionDays || 30
      }
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/admin/backups
 * Initiate a new organization-scoped backup job
 */
const createBackup = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) {
      return res.status(400).json({ success: false, error: { message: 'Organization required.' } });
    }

    const { type = 'DATA_ONLY', modules = [] } = req.body;
    const backupType = type === 'DATA_AND_DOCUMENTS' ? 'DATA_AND_DOCUMENTS' : 'DATA_ONLY';

    const selectedModules = Array.isArray(modules) && modules.length > 0 
      ? modules 
      : AVAILABLE_MODULES.map(m => m.key);

    // Create the queued BackupJob in database
    const job = await prisma.backupJob.create({
      data: {
        organizationId,
        createdByUserId: req.user?.id || req.user?.userId || null,
        type: backupType,
        status: 'QUEUED',
        progress: 0,
        progressStep: 'Queued for processing',
        includedModules: JSON.stringify(selectedModules)
      }
    });

    // Run the job asynchronously without blocking Express HTTP response
    setImmediate(() => {
      runBackupJob(job.id);
    });

    return res.status(201).json({
      success: true,
      message: 'Backup job initiated successfully.',
      data: serializeBackup(job)
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/backups
 * List all backup jobs for the authenticated tenant
 */
const getBackups = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) {
      return res.status(200).json({ success: true, data: [] });
    }

    const backups = await prisma.backupJob.findMany({
      where: { organizationId },
      include: {
        createdByUser: {
          select: { email: true, role: true, employeeProfile: { select: { fullName: true } } }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    return res.status(200).json({
      success: true,
      data: backups.map(serializeBackup)
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/backups/:id/status
 * Check the live status and progress of a backup job
 */
const getBackupStatus = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const job = await prisma.backupJob.findFirst({
      where: {
        id: req.params.id,
        organizationId
      }
    });

    if (!job) {
      return res.status(404).json({ success: false, error: { message: 'Backup job not found.' } });
    }

    return res.status(200).json({
      success: true,
      data: serializeBackup(job)
    });
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/backups/:id/download
 * Securely stream and download the backup ZIP archive
 */
const downloadBackup = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const job = await prisma.backupJob.findFirst({
      where: {
        id: req.params.id,
        organizationId
      }
    });

    if (!job) {
      return res.status(404).json({ success: false, error: { message: 'Backup not found or access denied.' } });
    }

    if (job.status !== 'COMPLETED' || !job.filePath || !fs.existsSync(job.filePath)) {
      return res.status(400).json({ success: false, error: { message: 'Backup file is not available for download.' } });
    }

    // Log Audit Event
    if (req.user?.id || req.user?.userId) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id || req.user.userId,
          action: 'BACKUP_DOWNLOADED',
          details: `Downloaded backup archive "${job.fileName}"`,
          organizationId
        }
      }).catch(() => {});
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${job.fileName}"`);
    return res.download(job.filePath, job.fileName);
  } catch (err) { next(err); }
};

/**
 * DELETE /api/admin/backups/:id
 * Delete backup archive and its database record
 */
const deleteBackup = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const job = await prisma.backupJob.findFirst({
      where: {
        id: req.params.id,
        organizationId
      }
    });

    if (!job) {
      return res.status(404).json({ success: false, error: { message: 'Backup not found.' } });
    }

    // Remove physical file from disk
    if (job.filePath && fs.existsSync(job.filePath)) {
      try {
        fs.unlinkSync(job.filePath);
      } catch (e) {
        console.warn('[BackupController] Unlink error:', e.message);
      }
    }

    await prisma.backupJob.delete({ where: { id: job.id } });

    // Log Audit Event
    if (req.user?.id || req.user?.userId) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id || req.user.userId,
          action: 'BACKUP_DELETED',
          details: `Deleted backup archive "${job.fileName}"`,
          organizationId
        }
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, message: 'Backup deleted successfully.' });
  } catch (err) { next(err); }
};

/**
 * POST /api/admin/backups/:id/email
 * Send backup notification and secure download info via email
 */
const sendBackupEmail = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const job = await prisma.backupJob.findFirst({
      where: {
        id: req.params.id,
        organizationId
      },
      include: { organization: true }
    });

    if (!job || job.status !== 'COMPLETED') {
      return res.status(400).json({ success: false, error: { message: 'Completed backup not found.' } });
    }

    const targetEmail = req.body?.recipientEmail || req.user?.email;
    if (!targetEmail) {
      return res.status(400).json({ success: false, error: { message: 'Recipient email is required.' } });
    }

    const orgName = job.organization?.name || 'Organization';
    const sizeMB = job.fileSize != null ? (Number(job.fileSize) / (1024 * 1024)).toFixed(2) : '0';
    const downloadUrl = `${req.protocol}://${req.get('host')}/api/admin/backups/${job.id}/download`;

    const htmlContent = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f8fafc; border-radius: 16px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h2 style="color: #1e293b; margin: 0;">HCM Data Backup Report</h2>
          <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Security Archive for ${orgName}</p>
        </div>
        <div style="background: white; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;">Organization:</td><td style="padding: 8px 0; font-weight: bold; color: #0f172a; text-align: right;">${orgName}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;">Backup File:</td><td style="padding: 8px 0; font-weight: bold; color: #0f172a; text-align: right; font-family: monospace;">${job.fileName}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;">Archive Size:</td><td style="padding: 8px 0; font-weight: bold; color: #0f172a; text-align: right;">${sizeMB} MB</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;">Checksum (SHA-256):</td><td style="padding: 8px 0; font-weight: bold; color: #4338ca; text-align: right; font-family: monospace; font-size: 11px;">${job.checksum || 'N/A'}</td></tr>
            <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px;">Created At:</td><td style="padding: 8px 0; font-weight: bold; color: #0f172a; text-align: right;">${new Date(job.createdAt).toLocaleString()}</td></tr>
          </table>
        </div>
        <div style="text-align: center; margin-bottom: 20px;">
          <a href="${downloadUrl}" style="display: inline-block; background: #4f46e5; color: white; padding: 12px 28px; border-radius: 10px; font-weight: bold; text-decoration: none; font-size: 14px;">
            Download Secure Backup Archive
          </a>
        </div>
        <p style="text-align: center; color: #94a3b8; font-size: 12px; margin: 0;">
          This archive is strictly confidential and protected by HCM Tenant Isolation protocols.
        </p>
      </div>
    `;

    const emailResult = await sendEmail({
      to: targetEmail,
      subject: `[HCM Backup] ${orgName} — ${job.fileName}`,
      html: htmlContent,
      text: `HCM Backup Archive for ${orgName}\nFile: ${job.fileName}\nSize: ${sizeMB} MB\nChecksum: ${job.checksum}\nDownload: ${downloadUrl}`
    });

    if (!emailResult.success) {
      return res.status(500).json({ success: false, error: { message: 'Failed to send backup email.' } });
    }

    // Log Audit Event
    if (req.user?.id || req.user?.userId) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id || req.user.userId,
          action: 'BACKUP_EMAIL_SENT',
          details: `Sent backup details for "${job.fileName}" to ${targetEmail}`,
          organizationId
        }
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: `Backup details dispatched successfully to ${targetEmail}.`
    });
  } catch (err) { next(err); }
};

/**
 * POST /api/admin/backups/:id/google-drive
 * Upload backup archive directly to connected Google Drive
 */
const uploadToGoogleDrive = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const job = await prisma.backupJob.findFirst({
      where: {
        id: req.params.id,
        organizationId
      }
    });

    if (!job || job.status !== 'COMPLETED' || !job.filePath || !fs.existsSync(job.filePath)) {
      return res.status(400).json({ success: false, error: { message: 'Completed backup archive not found.' } });
    }

    const driveResult = await googleDriveService.uploadBackupToDrive(
      organizationId,
      job.filePath,
      job.fileName
    );

    // Log Audit Event
    if (req.user?.id || req.user?.userId) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id || req.user.userId,
          action: 'BACKUP_GOOGLE_DRIVE_UPLOADED',
          details: `Uploaded backup "${job.fileName}" to Google Drive`,
          organizationId
        }
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: 'Backup archive uploaded to Google Drive successfully.',
      data: driveResult
    });
  } catch (err) {
    console.error('[uploadToGoogleDrive] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: { message: err.message || 'Failed to upload backup to Google Drive.' }
    });
  }
};

/**
 * GET /api/admin/google-drive/status
 */
const getGoogleDriveStatus = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const status = await googleDriveService.getStatus(organizationId);
    return res.status(200).json({ success: true, data: status });
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/google-drive/connect
 */
const getGoogleDriveAuthUrl = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    const url = googleDriveService.getAuthUrl(organizationId);
    return res.status(200).json({ success: true, data: { url } });
  } catch (err) { next(err); }
};

/**
 * GET /api/admin/google-drive/callback
 */
const handleGoogleDriveCallback = async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) {
      return res.redirect('/admin/settings/backup?error=oauth_cancelled');
    }

    let organizationId = null;
    if (state) {
      try {
        const parsed = JSON.parse(Buffer.from(state, 'base64').toString());
        organizationId = parsed.organizationId;
      } catch {}
    }

    if (!organizationId) {
      return res.redirect('/admin/settings/backup?error=invalid_state');
    }

    await googleDriveService.exchangeCodeForTokens(code, organizationId);
    return res.redirect('/admin/settings/backup?google_drive=connected');
  } catch (err) {
    console.error('[handleGoogleDriveCallback] Error:', err.message);
    return res.redirect('/admin/settings/backup?error=oauth_failed');
  }
};

/**
 * POST /api/admin/google-drive/disconnect
 */
const disconnectGoogleDrive = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    await googleDriveService.disconnect(organizationId);

    // Log Audit Event
    if (req.user?.id || req.user?.userId) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id || req.user.userId,
          action: 'GOOGLE_DRIVE_DISCONNECTED',
          details: `Disconnected Google Drive account`,
          organizationId
        }
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, message: 'Google Drive disconnected.' });
  } catch (err) { next(err); }
};

module.exports = {
  getAvailableModules,
  getBackupOverview,
  createBackup,
  getBackups,
  getBackupStatus,
  downloadBackup,
  deleteBackup,
  sendBackupEmail,
  uploadToGoogleDrive,
  getGoogleDriveStatus,
  getGoogleDriveAuthUrl,
  handleGoogleDriveCallback,
  disconnectGoogleDrive
};
