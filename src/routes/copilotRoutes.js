const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const tenantGuard = require('../middlewares/tenantGuard');
const subscriptionGuard = require('../middlewares/subscriptionGuard');
const { handleCopilotChat } = require('../controllers/copilotController');

router.post('/chat', protect, tenantGuard, handleCopilotChat);

module.exports = router;
