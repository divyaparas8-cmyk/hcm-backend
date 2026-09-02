// ============================================================
// Auth Middleware - JWT Token Verification + Role Check
// ============================================================

const { verifyToken } = require('../utils/jwtHelper');

const prisma = require('../config/prisma');

// 1. PROTECT - Check karo ki user logged in hai ya nahi
const protect = async (req, res, next) => {
  try {
    // Token can come from header: "Authorization: Bearer <token>" OR query param "?token=<token>" (for file downloads)
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'NO_TOKEN', message: 'Access denied. No token provided.' },
      });
    }

    const decoded = verifyToken(token); // Token verify karo

    // Verify user still exists in database (handles reset database state)
    const user = await prisma.user.findUnique({ 
      where: { id: decoded.userId },
      include: {
        organization: true,
        customRole: {
          select: {
            id: true,
            status: true,
            permissionVersion: true,
            inheritsFrom: true
          }
        }
      }
    });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'User does not exist or was deleted.' },
      });
    }

    // Check Organization active status (SuperAdmin is exempt)
    if (user.role !== 'SUPERADMIN' && user.organization) {
      const orgStatus = (user.organization.status || 'ACTIVE').toUpperCase();
      if (orgStatus === 'SUSPENDED' || orgStatus === 'INACTIVE' || orgStatus === 'DEACTIVATED') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ORGANIZATION_DEACTIVATED',
            message: 'Your organization account is currently deactivated. Access is restricted.'
          }
        });
      }
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        error: { code: 'ACCOUNT_DEACTIVATED', message: 'Your account is deactivated. Please contact HR.' },
      });
    }

    // Decoded info ko req mein attach karo taaki controller use kar sake
    const employeeProfile = await prisma.employeeProfile.findUnique({ 
      where: { userId: user.id },
      include: { exitLifecycle: true }
    });

    if (employeeProfile?.exitLifecycle) {
      const exit = employeeProfile.exitLifecycle;
      const approvedStatuses = ['APPROVED', 'CLEARANCE_IN_PROGRESS', 'PENDING_CLEARANCE'];
      if (approvedStatuses.includes(exit.status)) {
        const effectiveLwd = exit.finalLastWorkingDay ? new Date(exit.finalLastWorkingDay) : (exit.lastWorkingDay ? new Date(exit.lastWorkingDay) : null);
        if (effectiveLwd && !isNaN(effectiveLwd.getTime())) {
          const endOfLwd = new Date(effectiveLwd);
          endOfLwd.setHours(23, 59, 59, 999);
          if (new Date() > endOfLwd) {
            await prisma.user.update({ where: { id: user.id }, data: { isActive: false, status: 'Inactive' } });
            await prisma.exitLifecycle.update({ where: { id: exit.id }, data: { status: 'EMPLOYEE_RELIEVED' } });
            return res.status(401).json({
              success: false,
              error: { code: 'EMPLOYMENT_ENDED', message: 'Your tenure has concluded and your account is deactivated.' }
            });
          }
        }
      } else if (exit.status === 'EMPLOYEE_RELIEVED' || exit.status === 'COMPLETED') {
        if (user.isActive) {
          await prisma.user.update({ where: { id: user.id }, data: { isActive: false, status: 'Inactive' } });
        }
        return res.status(401).json({
          success: false,
          error: { code: 'ACCOUNT_RELIEVED', message: 'Your account has been deactivated.' }
        });
      }
    }
    
    // Determine effective role: custom role's inheritsFrom if active, else database user role
    const effectiveRole = (user.customRole && user.customRole.status === 'ACTIVE') 
      ? user.customRole.inheritsFrom 
      : user.role;

    req.user = {
      ...decoded,
      id: user.id,
      userId: user.id,
      role: effectiveRole, // Override JWT token role with current effective role
      organizationId: user.organizationId,
      employeeProfileId: employeeProfile ? employeeProfile.id : undefined,
      customRoleId: user.customRoleId,
      customRoleStatus: user.customRole?.status,
      permissionVersion: user.customRole?.permissionVersion
    };
    next(); // Aage badhao controller tak

  } catch (err) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Token is invalid or has expired.' },
    });
  }
};

// 2. AUTHORIZE - Check karo ki user ka role sahi hai
// Usage: authorize('ADMIN', 'HR')  → sirf ADMIN aur HR access kar sakte hain
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' }
      });
    }

    const currentRole = (req.user.role || '').toUpperCase();
    const upperAllowed = allowedRoles.map(r => r.toUpperCase());

    // SUPERADMIN always has platform-wide clearance
    if (currentRole === 'SUPERADMIN') {
      return next();
    }

    // ADMIN has administrative clearance across org modules
    if (currentRole === 'ADMIN' && (upperAllowed.includes('ADMIN') || upperAllowed.includes('HR') || upperAllowed.includes('MANAGER') || upperAllowed.includes('EMPLOYEE'))) {
      return next();
    }

    if (upperAllowed.includes(currentRole)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: `Access denied. Required role: ${allowedRoles.join(' or ')}. Current role: ${req.user.role}`,
      },
    });
  };
};

const tenantGuard = require('./tenantGuard');

module.exports = { protect, authorize, tenantGuard };
