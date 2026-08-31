// ============================================================
// Prisma Client - Singleton Instance
// ============================================================
// Prevent connection leaks and multiple instances across nodemon reloads

const { PrismaClient } = require('@prisma/client');

const globalForPrisma = global;

const prisma = globalForPrisma.__prismaInstance || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prismaInstance = prisma;
}

module.exports = prisma;

