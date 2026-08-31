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

      const { subscriptionStatus, plan } = req.tenant;

      // Basic guard against cancelled or suspended subscriptions
      if (['SUSPENDED', 'CANCELLED', 'EXPIRED'].includes(subscriptionStatus)) {
        return res.status(402).json({
          success: false,
          error: {
            code: 'SUBSCRIPTION_INACTIVE',
            message: `Your organization's subscription is ${subscriptionStatus.toLowerCase()}. Please renew to continue.`
          }
        });
      }

      // Enforce feature flags
      if (requiredFeature && !plans[plan]?.features.includes(requiredFeature)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FEATURE_NOT_ALLOWED', message: 'Your current plan does not support this feature.' }
        });
      }

      // Seat Limit check
      if (requiredFeature === 'ADD_EMPLOYEE') {
        const maxSeats = plans[plan]?.limits?.maxSeats || 0;
        const empCount = await prisma.user.count({ where: { organizationId: req.tenant.id }});
        
        if (empCount >= maxSeats) {
          return res.status(403).json({
            success: false,
            error: { code: 'SEAT_LIMIT_REACHED', message: 'Maximum seat limit reached for your plan.' }
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
