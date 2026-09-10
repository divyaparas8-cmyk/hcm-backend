// ============================================================
// Prisma Client - Singleton Instance
// ============================================================
// Prisma ko ek baar initialize karo aur poore app mein reuse karo
// Multiple instances se "too many connections" error aata hai

const { PrismaClient } = require('@prisma/client');

const fallbackDbUrl = 'mysql://root:jFIJDcDNSUVFCIxXBIuDCEhLyTkEThHo@altaria.proxy.rlwy.net:52745/railway';
const dbUrl = process.env.DATABASE_URL || fallbackDbUrl;

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: dbUrl
    }
  }
});

module.exports = prisma;
