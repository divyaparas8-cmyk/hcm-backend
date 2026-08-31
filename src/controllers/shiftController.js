const prisma = require('../config/prisma');

// @desc    Get all shifts
// @route   GET /api/admin/shifts
// @access  Admin, SuperAdmin
const getShifts = async (req, res) => {
  try {
    const shifts = await prisma.shift.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(shifts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error fetching shifts' });
  }
};

// @desc    Create a shift
// @route   POST /api/admin/shifts
// @access  Admin, SuperAdmin
const createShift = async (req, res) => {
  try {
    const { name, startTime, endTime, breakDurationMin, workingHoursMin, graceInMin, graceOutMin, isDefault } = req.body;
    
    const breakMin = parseInt(breakDurationMin) || 60;
    const workMin = parseInt(workingHoursMin) || 480;

    if (breakMin < 0) {
      return res.status(400).json({ message: 'Break duration cannot be negative.' });
    }

    if (breakMin >= workMin) {
      return res.status(400).json({ message: 'Break duration must be less than total working hours.' });
    }

    const organizationId = req.user.organizationId;

    if (isDefault && organizationId) {
      await prisma.shift.updateMany({
        where: { isDefault: true, organizationId },
        data: { isDefault: false }
      });
    }

    const shift = await prisma.shift.create({
      data: {
        name, startTime, endTime, 
        breakDurationMin: breakMin,
        workingHoursMin: workMin,
        graceInMin: parseInt(graceInMin) || 15,
        graceOutMin: parseInt(graceOutMin) || 15,
        isDefault: Boolean(isDefault),
        ...(organizationId ? { organizationId } : {})
      }
    });
    res.status(201).json(shift);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error creating shift' });
  }
};

// @desc    Update a shift
// @route   PUT /api/admin/shifts/:id
// @access  Admin, SuperAdmin
const updateShift = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, startTime, endTime, breakDurationMin, workingHoursMin, graceInMin, graceOutMin, isDefault } = req.body;
    
    if (isDefault) {
      await prisma.shift.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false }
      });
    }

    const shift = await prisma.shift.update({
      where: { id },
      data: {
        name, startTime, endTime,
        breakDurationMin: parseInt(breakDurationMin) || 60,
        workingHoursMin: parseInt(workingHoursMin) || 480,
        graceInMin: parseInt(graceInMin) || 15,
        graceOutMin: parseInt(graceOutMin) || 15,
        isDefault: Boolean(isDefault)
      }
    });
    res.json(shift);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error updating shift' });
  }
};

// @desc    Delete a shift
// @route   DELETE /api/admin/shifts/:id
// @access  Admin, SuperAdmin
const deleteShift = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.shift.delete({ where: { id } });
    res.json({ message: 'Shift deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server Error deleting shift' });
  }
};

module.exports = {
  getShifts,
  createShift,
  updateShift,
  deleteShift
};
