// ============================================================
// Calendar Routes
// ============================================================
const express = require('express');
const router = express.Router();
const { protect, tenantGuard, authorize } = require('../middlewares/authMiddleware');
const subscriptionGuard = require('../middlewares/subscriptionGuard');

const {
  getAllCalendars,
  getCalendarById,
  createCalendar,
  updateCalendar,
  deleteCalendar,
  assignCalendar,
  removeAssignment
} = require('../controllers/calendarController');

router.route('/')
  .get(protect, tenantGuard, getAllCalendars)
  .post(protect, tenantGuard, authorize('ADMIN', 'SUPERADMIN', 'HR'), createCalendar);

router.route('/:id')
  .get(protect, tenantGuard, getCalendarById)
  .put(protect, tenantGuard, authorize('ADMIN', 'SUPERADMIN', 'HR'), updateCalendar)
  .delete(protect, tenantGuard, authorize('ADMIN', 'SUPERADMIN', 'HR'), deleteCalendar);

router.post('/assign', protect, tenantGuard, authorize('ADMIN', 'SUPERADMIN', 'HR'), assignCalendar);
router.delete('/assignments/:id', protect, tenantGuard, authorize('ADMIN', 'SUPERADMIN', 'HR'), removeAssignment);

module.exports = router;
