// ============================================================
// Admin System Settings Controller (Tenant-Isolated)
// ============================================================

const prisma = require('../config/prisma');

const VALID_DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

/**
 * GET /api/admin/settings
 * Fetch authenticated organization's settings
 */
const getAdminSettings = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: { code: 'TENANT_REQUIRED', message: 'Authenticated organization required.' }
      });
    }

    const [org, globalSettings] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        include: { pricingPlan: true }
      }),
      prisma.globalSettings.findUnique({
        where: { id: 'global-settings' }
      })
    ]);

    if (!org) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization record not found.' }
      });
    }

    const masterCurrency = globalSettings?.masterCurrency || 'USD ($) - US Dollar';
    const currency = org.currency || org.pricingPlan?.currency || 'USD';

    return res.status(200).json({
      success: true,
      data: {
        organizationId: org.id,
        organizationName: org.name,
        countryCode: org.countryCode || '+1',
        timezone: org.timezone || 'UTC-08:00 (Pacific Standard Time)',
        dateFormat: org.dateFormat || 'DD/MM/YYYY',
        currency: currency,
        masterCurrency: masterCurrency,
        twoFactorEnabled: org.twoFactorEnabled !== false,
        sessionTimeout: org.sessionTimeout || '15 Minutes'
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/admin/settings
 * Update authenticated organization's settings
 */
const updateAdminSettings = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: { code: 'TENANT_REQUIRED', message: 'Authenticated organization required.' }
      });
    }

    const {
      countryCode,
      timezone,
      dateFormat,
      twoFactorEnabled,
      sessionTimeout
    } = req.body;

    const dataToUpdate = {};
    const updatedFields = [];

    // 1. Country Code validation
    if (countryCode !== undefined) {
      if (typeof countryCode !== 'string' || !countryCode.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid country code format.' }
        });
      }
      dataToUpdate.countryCode = countryCode.trim();
      updatedFields.push(`countryCode: ${dataToUpdate.countryCode}`);
    }

    // 2. Timezone validation
    if (timezone !== undefined) {
      if (typeof timezone !== 'string' || !timezone.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid primary timezone format.' }
        });
      }
      dataToUpdate.timezone = timezone.trim();
      updatedFields.push(`timezone: ${dataToUpdate.timezone}`);
    }

    // 3. Date Format validation
    if (dateFormat !== undefined) {
      if (!VALID_DATE_FORMATS.includes(dateFormat)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid date format. Must be one of: ${VALID_DATE_FORMATS.join(', ')}`
          }
        });
      }
      dataToUpdate.dateFormat = dateFormat;
      updatedFields.push(`dateFormat: ${dateFormat}`);
    }

    // 4. Two-Factor Authentication
    if (twoFactorEnabled !== undefined) {
      dataToUpdate.twoFactorEnabled = Boolean(twoFactorEnabled);
      updatedFields.push(`twoFactorEnabled: ${dataToUpdate.twoFactorEnabled}`);
    }

    // 5. Session Timeout
    if (sessionTimeout !== undefined) {
      if (typeof sessionTimeout === 'string' && sessionTimeout.trim()) {
        dataToUpdate.sessionTimeout = sessionTimeout.trim();
        updatedFields.push(`sessionTimeout: ${dataToUpdate.sessionTimeout}`);
      }
    }

    if (Object.keys(dataToUpdate).length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_UPDATES', message: 'No valid setting fields provided for update.' }
      });
    }

    // Perform database update strictly scoped to authenticated organization
    const updatedOrg = await prisma.organization.update({
      where: { id: organizationId },
      data: dataToUpdate,
      include: { pricingPlan: true }
    });

    const globalSettings = await prisma.globalSettings.findUnique({
      where: { id: 'global-settings' }
    });

    // Record Audit Trail
    await prisma.auditLog.create({
      data: {
        organizationId,
        userId: req.user?.id || req.user?.userId || null,
        action: 'ORGANIZATION_SETTINGS_UPDATED',
        details: `Updated platform settings: ${updatedFields.join(', ')}`,
        ipAddress: req.ip || null
      }
    }).catch(err => console.warn('[AuditLog] Failed to record settings update:', err.message));

    return res.status(200).json({
      success: true,
      message: 'Organization settings updated successfully.',
      data: {
        organizationId: updatedOrg.id,
        organizationName: updatedOrg.name,
        countryCode: updatedOrg.countryCode || '+1',
        timezone: updatedOrg.timezone || 'UTC-08:00 (Pacific Standard Time)',
        dateFormat: updatedOrg.dateFormat || 'DD/MM/YYYY',
        currency: updatedOrg.currency || updatedOrg.pricingPlan?.currency || 'USD',
        masterCurrency: globalSettings?.masterCurrency || 'USD ($) - US Dollar',
        twoFactorEnabled: updatedOrg.twoFactorEnabled !== false,
        sessionTimeout: updatedOrg.sessionTimeout || '15 Minutes'
      }
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/admin/settings/reset
 * Reset authenticated organization's settings to system defaults
 */
const resetAdminSettings = async (req, res, next) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    if (!organizationId) {
      return res.status(400).json({
        success: false,
        error: { code: 'TENANT_REQUIRED', message: 'Authenticated organization required.' }
      });
    }

    const defaultValues = {
      countryCode: '+1',
      timezone: 'UTC-08:00 (Pacific Standard Time)',
      dateFormat: 'DD/MM/YYYY',
      twoFactorEnabled: true,
      sessionTimeout: '15 Minutes'
    };

    const resetOrg = await prisma.organization.update({
      where: { id: organizationId },
      data: defaultValues,
      include: { pricingPlan: true }
    });

    const globalSettings = await prisma.globalSettings.findUnique({
      where: { id: 'global-settings' }
    });

    // Record Audit Trail
    await prisma.auditLog.create({
      data: {
        organizationId,
        userId: req.user?.id || req.user?.userId || null,
        action: 'ORGANIZATION_SETTINGS_RESET',
        details: 'Admin reset organization system settings to system defaults',
        ipAddress: req.ip || null
      }
    }).catch(err => console.warn('[AuditLog] Failed to record settings reset:', err.message));

    return res.status(200).json({
      success: true,
      message: 'System settings restored to defaults successfully.',
      data: {
        organizationId: resetOrg.id,
        organizationName: resetOrg.name,
        countryCode: resetOrg.countryCode,
        timezone: resetOrg.timezone,
        dateFormat: resetOrg.dateFormat,
        currency: resetOrg.currency || resetOrg.pricingPlan?.currency || 'USD',
        masterCurrency: globalSettings?.masterCurrency || 'USD ($) - US Dollar',
        twoFactorEnabled: resetOrg.twoFactorEnabled !== false,
        sessionTimeout: resetOrg.sessionTimeout
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getAdminSettings,
  updateAdminSettings,
  resetAdminSettings
};
