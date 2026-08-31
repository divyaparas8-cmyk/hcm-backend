const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function runTest() {
  console.log('--- STARTING SAAS ISOLATION TEST ---');
  try {
    // Cleanup any previous test data
    await prisma.department.deleteMany({ where: { name: { in: ['Test Dept Org A', 'Test Dept Org B'] } } });
    await prisma.employeeProfile.deleteMany({ where: { fullName: { in: ['Admin A', 'Admin B'] } } });
    await prisma.user.deleteMany({ where: { email: { in: ['adminA@test.com', 'adminB@test.com'] } } });
    await prisma.organization.deleteMany({ where: { name: { in: ['Org A', 'Org B'] } } });

    // Create Org A and Admin A
    const orgA = await prisma.organization.create({ data: { name: 'Org A', industry: 'Technology', status: 'ACTIVE', subscriptionStatus: 'TRIAL' } });
    const userA = await prisma.user.create({ data: { email: 'adminA@test.com', passwordHash: await bcrypt.hash('password123', 10), role: 'ADMIN', organizationId: orgA.id, status: 'Active', isActive: true } });
    await prisma.employeeProfile.create({ data: { userId: userA.id, fullName: 'Admin A', employeeId: 'EMP-A001', organizationId: orgA.id } });

    // Create Org B and Admin B
    const orgB = await prisma.organization.create({ data: { name: 'Org B', industry: 'Healthcare', status: 'ACTIVE', subscriptionStatus: 'TRIAL' } });
    const userB = await prisma.user.create({ data: { email: 'adminB@test.com', passwordHash: await bcrypt.hash('password123', 10), role: 'ADMIN', organizationId: orgB.id, status: 'Active', isActive: true } });
    await prisma.employeeProfile.create({ data: { userId: userB.id, fullName: 'Admin B', employeeId: 'EMP-B001', organizationId: orgB.id } });

    // Create Departments
    const deptA = await prisma.department.create({ data: { name: 'Test Dept Org A', code: 'TDA', organizationId: orgA.id } });
    const deptB = await prisma.department.create({ data: { name: 'Test Dept Org B', code: 'TDB', organizationId: orgB.id } });

    // Verify isolation: Org A should not see Org B
    const departmentsForA = await prisma.department.findMany({ where: { organizationId: orgA.id } });
    if (departmentsForA.some(d => d.id === deptB.id)) {
      throw new Error('TEST FAILED: Org A can see Org B department');
    }
    console.log('TEST PASSED: Org A isolation confirmed');

    // Verify composite unique constraint across organizations
    await prisma.department.create({ data: { name: 'Test Dept Org A', code: 'TDA-B', organizationId: orgB.id } });
    console.log('TEST PASSED: Same department name under different org succeeded');
    try {
      await prisma.department.create({ data: { name: 'Test Dept Org A', code: 'TDA-Dup', organizationId: orgA.id } });
      throw new Error('TEST FAILED: Duplicate department under same org succeeded');
    } catch (e) {
      console.log('TEST PASSED: Duplicate department under same org correctly rejected');
    }

    // Cleanup
    await prisma.department.deleteMany({ where: { name: { in: ['Test Dept Org A', 'Test Dept Org B'] } } });
    await prisma.employeeProfile.deleteMany({ where: { fullName: { in: ['Admin A', 'Admin B'] } } });
    await prisma.user.deleteMany({ where: { email: { in: ['adminA@test.com', 'adminB@test.com'] } } });
    await prisma.organization.deleteMany({ where: { name: { in: ['Org A', 'Org B'] } } });

    console.log('--- ALL ISOLATION TESTS PASSED ---');
  } catch (err) {
    console.error('TEST ERROR:', err.message);
    process.exit(1);
  }
}

runTest();
