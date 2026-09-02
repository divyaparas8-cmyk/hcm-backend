const prisma = require('../config/prisma');

// @desc    Get all shifts
// @route   GET /api/admin/shifts
// @access  Admin, SuperAdmin
const getShifts = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId || req.tenant?.id;
    let shifts = await prisma.shift.findMany({
      where: organizationId ? { organizationId } : {},
      include: {
        _count: {
          select: { employees: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Auto-seed standard default shifts if empty
    if (shifts.length === 0 && organizationId) {
      await prisma.shift.createMany({
        data: [
          {
            name: 'Standard Morning Shift',
            startTime: '09:00',
            endTime: '18:00',
            breakDurationMin: 60,
            workingHoursMin: 480,
            graceInMin: 15,
            graceOutMin: 15,
            isDefault: true,
            organizationId
          },
          {
            name: 'Evening Shift',
            startTime: '14:00',
            endTime: '23:00',
            breakDurationMin: 60,
            workingHoursMin: 480,
            graceInMin: 15,
            graceOutMin: 15,
            isDefault: false,
            organizationId
          }
        ],
        skipDuplicates: true
      });

      shifts = await prisma.shift.findMany({
        where: { organizationId },
        include: {
          _count: {
            select: { employees: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    }

    res.json(shifts);
  } catch (error) {
    console.error('getShifts error:', error);
    res.status(500).json({ message: 'Server Error fetching shifts' });
  }
};

// @desc    Create a shift
// @route   POST /api/admin/shifts
// @access  Admin, SuperAdmin
const createShift = async (req, res) => {
  try {
    const { name, startTime, endTime, breakDurationMin, workingHoursMin, graceInMin, graceOutMin, isDefault } = req.body;
    
    if (!name || !startTime || !endTime) {
      return res.status(400).json({ message: 'Name, Start Time, and End Time are required.' });
    }

    const breakMin = parseInt(breakDurationMin) || 60;
    const workMin = parseInt(workingHoursMin) || 480;

    if (breakMin < 0) {
      return res.status(400).json({ message: 'Break duration cannot be negative.' });
    }

    const organizationId = req.user?.organizationId || req.tenant?.id;

    // Check duplicate name within the organization
    const existing = await prisma.shift.findFirst({
      where: {
        name,
        ...(organizationId ? { organizationId } : {})
      }
    });

    if (existing) {
      return res.status(400).json({ message: `A shift named "${name}" already exists.` });
    }

    if (isDefault && organizationId) {
      await prisma.shift.updateMany({
        where: { isDefault: true, organizationId },
        data: { isDefault: false }
      });
    }

    const shift = await prisma.shift.create({
      data: {
        name, 
        startTime, 
        endTime, 
        breakDurationMin: breakMin,
        workingHoursMin: workMin,
        graceInMin: parseInt(graceInMin) || 15,
        graceOutMin: parseInt(graceOutMin) || 15,
        isDefault: Boolean(isDefault),
        ...(organizationId ? { organizationId } : {})
      },
      include: {
        _count: {
          select: { employees: true }
        }
      }
    });
    res.status(201).json(shift);
  } catch (error) {
    console.error('createShift error:', error);
    res.status(500).json({ message: error.message || 'Server Error creating shift' });
  }
};

// @desc    Update a shift
// @route   PUT /api/admin/shifts/:id
// @access  Admin, SuperAdmin
const updateShift = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({ message: 'Valid Shift ID is required.' });
    }

    const { name, startTime, endTime, breakDurationMin, workingHoursMin, graceInMin, graceOutMin, isDefault } = req.body;
    const organizationId = req.user?.organizationId || req.tenant?.id;

    if (isDefault && organizationId) {
      await prisma.shift.updateMany({
        where: { isDefault: true, id: { not: id }, organizationId },
        data: { isDefault: false }
      });
    }

    const shift = await prisma.shift.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(startTime && { startTime }),
        ...(endTime && { endTime }),
        breakDurationMin: parseInt(breakDurationMin) || 60,
        workingHoursMin: parseInt(workingHoursMin) || 480,
        graceInMin: parseInt(graceInMin) || 15,
        graceOutMin: parseInt(graceOutMin) || 15,
        ...(isDefault !== undefined && { isDefault: Boolean(isDefault) })
      },
      include: {
        _count: {
          select: { employees: true }
        }
      }
    });
    res.json(shift);
  } catch (error) {
    console.error('updateShift error:', error);
    res.status(500).json({ message: error.message || 'Server Error updating shift' });
  }
};

// @desc    Delete a shift
// @route   DELETE /api/admin/shifts/:id
// @access  Admin, SuperAdmin
const deleteShift = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({ message: 'Valid Shift ID is required.' });
    }
    
    // Unlink any employees assigned to this shift first to prevent foreign key errors
    await prisma.employeeProfile.updateMany({
      where: { shiftId: id },
      data: { shiftId: null }
    });

    await prisma.shift.delete({ where: { id } });
    res.json({ message: 'Shift deleted successfully' });
  } catch (error) {
    console.error('deleteShift error:', error);
    res.status(500).json({ message: error.message || 'Server Error deleting shift' });
  }
};

module.exports = {
  getShifts,
  createShift,
  updateShift,
  deleteShift
};
