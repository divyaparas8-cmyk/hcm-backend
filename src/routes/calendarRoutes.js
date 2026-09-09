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

router.use(protect, tenantGuard, subscriptionGuard('shifts_calendars'));

router.route('/')
  .get(getAllCalendars)
  .post(authorize('ADMIN', 'SUPERADMIN', 'HR'), createCalendar);

router.route('/:id')
  .get(getCalendarById)
  .put(authorize('ADMIN', 'SUPERADMIN', 'HR'), updateCalendar)
  .delete(authorize('ADMIN', 'SUPERADMIN', 'HR'), deleteCalendar);

router.post('/assign', authorize('ADMIN', 'SUPERADMIN', 'HR'), assignCalendar);
router.delete('/assignments/:id', authorize('ADMIN', 'SUPERADMIN', 'HR'), removeAssignment);

module.exports = router;
