require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Find the MANAGER profile
  const manager = await prisma.employeeProfile.findFirst({
    where: { user: { role: 'MANAGER' } }
  });

  if (!manager) {
    console.error("Manager profile not found!");
    return;
  }

  console.log("Found Manager Profile:", manager.fullName, "ID:", manager.id);

  // Update Bob Marley to report to MANAGER
  const bob = await prisma.employeeProfile.findFirst({
    where: { fullName: { contains: 'Bob Marley' } }
  });

  if (bob) {
    await prisma.employeeProfile.update({
      where: { id: bob.id },
      data: { managerId: manager.id }
    });
    console.log("Updated Bob Marley managerId to:", manager.id);
  } else {
    console.log("Bob Marley not found.");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
