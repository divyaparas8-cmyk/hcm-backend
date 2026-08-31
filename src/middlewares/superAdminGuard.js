// src/middlewares/superAdminGuard.js
// Guard to allow only platform‑wide SUPERADMIN users

module.exports = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'User not authenticated' }
    });
  }
  if (req.user.role !== 'SUPERADMIN') {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Requires SUPERADMIN role' }
    });
  }
  next();
};
