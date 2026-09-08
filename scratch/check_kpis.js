require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const ep = await prisma.employeeProfile.findMany({
    select: {
      id: true,
      fullName: true,
      managerId: true,
      userId: true,
      user: { select: { email: true, role: true } }
    }
  });
  console.log("=== Employee Profiles ===");
  console.log(ep);

  const goals = await prisma.performanceGoal.findMany({
    include: { employee: true }
  });
  console.log("=== Performance Goals ===");
  console.log(goals);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
