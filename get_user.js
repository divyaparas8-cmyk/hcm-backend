const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany({ take: 1 });
  console.log('USER:', users[0].email);
}
main();
