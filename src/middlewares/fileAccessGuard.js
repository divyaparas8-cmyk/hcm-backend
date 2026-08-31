// src/middlewares/fileAccessGuard.js
// Guard to ensure uploaded files are accessed only by the owning organization.
// Expects the request URL to contain the organizationId as a param, e.g. /uploads/:orgId/... .
// For static serving via express.static, we mount this middleware before the static handler.

module.exports = (req, res, next) => {
  // Expect an authenticated user
  if (!req.user) {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'User not authenticated' } });
  }

  // The organizationId is either in the URL path (first segment after /uploads) or derived from the user's tenant.
  const pathParts = req.path.split('/').filter(Boolean); // remove empty parts
  const orgIdFromPath = pathParts[0]; // /uploads/:orgId/...

  const userOrgId = req.user.organizationId || (req.tenant && req.tenant.id);

  if (!orgIdFromPath || !userOrgId) {
    return res.status(400).json({ success: false, error: { code: 'ORG_ID_MISSING', message: 'Organization context missing for file access' } });
  }

  if (orgIdFromPath !== userOrgId) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access to files of other organizations is denied' } });
  }

  // All good – proceed to static file serving.
  next();
};
