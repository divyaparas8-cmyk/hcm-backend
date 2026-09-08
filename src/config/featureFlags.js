// src/config/featureFlags.js
// Simple feature flag configuration. Toggle features per organization globally.
// In a real SaaS, this could be stored per tenant in the DB, but for now we use a static config.

module.exports = {
  // Example flags: set to true to enable, false to disable.
  PAYROLL: true,
  AI_FEATURES: false,
  DOCUMENT_SHARING: true,
  CUSTOM_REPORTS: false,
};
