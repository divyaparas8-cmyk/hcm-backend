const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const tenantGuard = require('../middlewares/tenantGuard');
const subscriptionGuard = require('../middlewares/subscriptionGuard');
const { 
  handleCopilotChat,
  getConversationHistory,
  getCopilotSuggestions 
} = require('../controllers/copilotController');

router.post('/chat', protect, tenantGuard, subscriptionGuard('ai_resume_scoring'), handleCopilotChat);
router.get('/history/:conversationId', protect, tenantGuard, getConversationHistory);
router.get('/suggestions', protect, tenantGuard, getCopilotSuggestions);

module.exports = router;
