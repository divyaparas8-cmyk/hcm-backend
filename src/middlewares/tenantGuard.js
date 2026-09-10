const prisma = require('../config/prisma');

const tenantGuard = async (req, res, next) => {
  try {
    // NOTE: Candidates are allowed to register and login without an associated organization.
    // The tenant guard would normally reject requests lacking an organizationId.
    // To support candidate workflows, we explicitly bypass the tenant check for SUPERADMIN and CANDIDATE roles.
    if (req.user && (req.user.role === 'SUPERADMIN' || req.user.role === 'CANDIDATE')) {
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

    // Fetch the tenant organization with pricing plan relation and its features
    const org = await prisma.organization.findUnique({
      where: { id: req.user.organizationId },
      include: {
        pricingPlan: {
          include: { features: true }
        }
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

    let pricingPlan = org.pricingPlan;
    if (!pricingPlan) {
      pricingPlan = await prisma.pricingPlan.findFirst({
        where: { name: 'Enterprise' },
        include: { features: true }
      }) || await prisma.pricingPlan.findFirst({
        include: { features: true }
      });
      if (pricingPlan && !org.pricingPlanId) {
        await prisma.organization.update({
          where: { id: org.id },
          data: { pricingPlanId: pricingPlan.id }
        }).catch(() => {});
      }
    }

    // Extract active SaaS module feature identifiers for the organization's plan
    const assignedFeatures = (pricingPlan?.features || []).map(f => f.feature);

    // Pass organization and subscription helpers down
    req.tenant = {
      ...org,
      plan: pricingPlan?.name || 'Enterprise',
      maxEmployees: pricingPlan?.maxEmployees || 9999,
      features: assignedFeatures
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
