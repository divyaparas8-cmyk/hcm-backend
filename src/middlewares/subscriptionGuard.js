const prisma = require('../config/prisma');
const plans = require('../config/plans');

const subscriptionGuard = (requiredFeature) => {
  return async (req, res, next) => {
    try {
      if (req.user && req.user.role === 'SUPERADMIN') {
        return next();
      }

      if (!req.tenant) {
        return res.status(500).json({
          success: false,
          error: { code: 'GUARD_ORDER_ERROR', message: 'tenantGuard must precede subscriptionGuard' }
        });
      }

      const { subscriptionStatus, plan, maxEmployees, pricingPlan } = req.tenant;
      const statusUpper = (subscriptionStatus || 'ACTIVE').toUpperCase();

      // Basic guard against cancelled or suspended subscriptions
      if (['SUSPENDED', 'CANCELLED', 'EXPIRED'].includes(statusUpper)) {
        return res.status(402).json({
          success: false,
          error: {
            code: 'SUBSCRIPTION_INACTIVE',
            message: `Your organization's subscription is ${subscriptionStatus ? subscriptionStatus.toLowerCase() : 'inactive'}. Please renew to continue.`
          }
        });
      }

      // Feature validation
      if (requiredFeature) {
        const standardCoreFeatures = ['ADD_EMPLOYEE', 'VIEW_DASHBOARD', 'PAYROLL', 'ATTENDANCE', 'LEAVES', 'DOCUMENTS', 'PERFORMANCE'];
        
        // Normalize plan name key (e.g. 'Professional' -> 'PRO', 'Enterprise' -> 'ENTERPRISE', 'Free' -> 'FREE')
        const planKey = (plan || 'PRO').toUpperCase().includes('FREE') ? 'FREE' 
          : (plan || 'PRO').toUpperCase().includes('ENTERPRISE') ? 'ENTERPRISE' 
          : 'PRO';
        
        const planConfig = plans[planKey] || plans.PRO;
        const customPlanFeatures = Array.isArray(pricingPlan?.features) ? pricingPlan.features : [];

        const isAllowed = standardCoreFeatures.includes(requiredFeature) ||
          planConfig?.features?.includes(requiredFeature) ||
          customPlanFeatures.includes(requiredFeature);

        if (!isAllowed) {
          return res.status(403).json({
            success: false,
            error: { code: 'FEATURE_NOT_ALLOWED', message: 'Your current plan does not support this feature.' }
          });
        }
      }

      // Dynamic Seat Limit check based on tenant organization's maxEmployees
      if (requiredFeature === 'ADD_EMPLOYEE') {
        const seatLimit = maxEmployees || pricingPlan?.maxEmployees || 500;
        const empCount = await prisma.user.count({ where: { organizationId: req.tenant.id } });
        
        if (seatLimit > 0 && empCount >= seatLimit) {
          return res.status(403).json({
            success: false,
            error: { 
              code: 'SEAT_LIMIT_REACHED', 
              message: `Maximum seat limit (${seatLimit}) reached for your plan. Please upgrade to add more employees.` 
            }
          });
        }
      }

      next();
    } catch (err) {
      console.error('Subscription Guard Error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to verify subscription status.' }
      });
    }
  };
};

module.exports = subscriptionGuard;
