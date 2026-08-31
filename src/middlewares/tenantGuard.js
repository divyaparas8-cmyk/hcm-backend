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

    // Fetch the tenant organization with pricing plan relation
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      include: {
        pricingPlan: true
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

    const orgStatus = (org.status || 'ACTIVE').toUpperCase();
    if (orgStatus === 'SUSPENDED' || orgStatus === 'INACTIVE' || orgStatus === 'DEACTIVATED') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_DEACTIVATED',
          message: 'Your organization account is deactivated. Access to the software is restricted until activated by an administrator.'
        }
      });
    }

    // Pass organization and subscription helpers down
    req.tenant = {
      ...org,
      plan: org.pricingPlan?.name || 'Professional',
      maxEmployees: org.pricingPlan?.maxEmployees || 500,
    };
    
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
