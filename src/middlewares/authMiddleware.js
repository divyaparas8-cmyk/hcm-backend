// ============================================================
// Auth Middleware - JWT Token Verification + Role Check
// ============================================================

const { verifyToken } = require('../utils/jwtHelper');

const prisma = require('../config/prisma');

// 1. PROTECT - Check karo ki user logged in hai ya nahi
const protect = async (req, res, next) => {
  try {
    // Token header se lo: "Authorization: Bearer <token>"
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: { code: 'NO_TOKEN', message: 'Access denied. No token provided.' },
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token); // Token verify karo

    // Verify user still exists in database (handles reset database state)
    const user = await prisma.user.findUnique({ 
      where: { id: decoded.userId },
      include: {
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

    // Decoded info ko req mein attach karo taaki controller use kar sake
    const employeeProfile = await prisma.employeeProfile.findUnique({ where: { userId: user.id } });
    
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
