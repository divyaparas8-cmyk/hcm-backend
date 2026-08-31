// ============================================================
// Auth Routes
// ============================================================
// Ye file URLs ko Controllers se jodhti hai

const express = require('express');
const router = express.Router();

const { login, register, getMe, changePassword, getMyPermissions, resetForgottenPassword } = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');
const tenantGuard = require('../middlewares/tenantGuard');

// Public Routes (login ke bina access)
router.post('/login', login);         // POST /api/auth/login
router.post('/register', register);   // POST /api/auth/register
router.post('/reset-forgotten-password', resetForgottenPassword); // POST /api/auth/reset-forgotten-password

// Protected Routes (JWT token required)
router.get('/me', protect, tenantGuard, getMe);    // GET /api/auth/me
router.post('/change-password', protect, changePassword); // POST /api/auth/change-password

// Permission check - any authenticated user can get their own role's permissions
router.get('/my-permissions', protect, tenantGuard, getMyPermissions); // GET /api/auth/my-permissions

module.exports = router;
