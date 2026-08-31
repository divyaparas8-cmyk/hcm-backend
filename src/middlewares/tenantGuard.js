const prisma = require('../config/prisma');

const tenantGuard = async (req, res, next) => {
  try {
    // SuperAdmin bypasses tenant guards
    if (req.user && req.user.role === 'SUPERADMIN') {
      return next();
    }

    if (!req.user || !req.user.organizationId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'NO_TENANT',
          message: 'User is not associated with any organization.'
        }
      });
    }

    // Fetch the tenant status
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      select: {
        status: true,
        subscriptionStatus: true,
      }
    });

    if (!org) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TENANT_NOT_FOUND',
          message: 'Organization not found.'
        }
      });
    }

    if (org.status === 'SUSPENDED') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_SUSPENDED',
          message: 'Your organization account is suspended. Please contact support.'
        }
      });
    }

    if (org.status === 'INACTIVE') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_INACTIVE',
          message: 'Your organization account is inactive. Please contact support.'
        }
      });
    }

    // Pass organization status down
    req.tenant = org;
    
    // IMPORTANT: Inject organizationId into query/body to avoid manipulation,
    // though it's safer to always use req.user.organizationId in controllers.
    
    next();
  } catch (err) {
    console.error('Tenant Guard Error:', err);
    return res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to verify tenant status.' }
    });
  }
};

module.exports = tenantGuard;
