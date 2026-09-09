const prisma = require('../config/prisma');

// Feature name map for clear user-facing error messages
const FEATURE_TITLES = {
  attendance_leave: 'Attendance & Leave Tracking',
  employee_directory: 'Employee Directory & Profiles',
  shifts_calendars: 'Shifts & Work Calendars',
  payroll_operations: 'Payroll & Compensation',
  benefits_insurance: 'Benefits & Insurance Config',
  recruitment_pipeline: 'Recruitment & Job Pipeline',
  ai_resume_scoring: 'AI Resume Scoring & Matching',
  performance_kpi: 'Performance & KPI Tracking',
  approval_workflows: 'Custom Approval Workflows',
  documents_vault: 'Document Vault & Storage',
  support_tickets: 'Help Desk & Support Tickets',
  backup_center: 'Organization Backup Center',
  offboarding_exit: 'Offboarding & Exit Lifecycle',
  advanced_reports: 'Advanced Analytics & Exports',
  audit_compliance: 'Audit Logs & Statutory Compliance',
};

const subscriptionGuard = (requiredFeature) => {
  return async (req, res, next) => {
    try {
      // Platform SuperAdmin has full system access across all tenants and features
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
            message: `Your organization's subscription is ${subscriptionStatus ? subscriptionStatus.toLowerCase() : 'inactive'}. Please contact support or renew to continue.`
          }
        });
      }

      // Dynamic Seat Limit check based on tenant organization's maxEmployees
      if (requiredFeature === 'ADD_EMPLOYEE' || requiredFeature === 'employee_directory_create') {
        const seatLimit = maxEmployees || pricingPlan?.maxEmployees || 500;
        const empCount = await prisma.user.count({ where: { organizationId: req.tenant.id } });
        
        if (seatLimit > 0 && empCount >= seatLimit) {
          return res.status(403).json({
            success: false,
            error: { 
              code: 'SEAT_LIMIT_REACHED', 
              message: `Maximum employee limit (${seatLimit}) reached for your plan '${plan}'. Please upgrade your subscription to add more employees.` 
            }
          });
        }
      }

      // Feature Entitlement Check
      if (requiredFeature && requiredFeature !== 'ADD_EMPLOYEE') {
        const tenantFeatures = Array.isArray(req.tenant.features) ? req.tenant.features : [];

        // Check if the required feature is permitted
        let isAllowed = false;
        if (Array.isArray(requiredFeature)) {
          isAllowed = requiredFeature.some(rf => tenantFeatures.includes(rf));
        } else {
          isAllowed = tenantFeatures.includes(requiredFeature);
        }

        if (!isAllowed) {
          const featureName = FEATURE_TITLES[requiredFeature] || requiredFeature;
          return res.status(403).json({
            success: false,
            error: { 
              code: 'FEATURE_NOT_ENTITLED', 
              message: `The '${featureName}' module is not included in your organization's '${plan}' plan. Please contact your administrator to upgrade your subscription.`,
              requiredFeature,
              currentPlan: plan
            }
          });
        }
      }

      next();
    } catch (err) {
      console.error('Subscription Guard Error:', err);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Failed to verify subscription status and feature entitlement.' }
      });
    }
  };
};

module.exports = subscriptionGuard;
