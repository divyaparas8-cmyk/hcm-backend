const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const policies = await prisma.leavePolicy.findMany();
  console.log("Policies:", policies);
  const requests = await prisma.leaveRequest.findMany();
  console.log("Requests:", requests);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
