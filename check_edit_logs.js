const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.editLog.findMany({
    where: { fieldName: 'ourItemNot' },
    orderBy: { id: 'desc' },
    take: 100,
  });

  console.log(`Edit logs for ourItemNot count: ${logs.length}`);
  if (logs.length > 0) {
    console.log('Sample edit logs:', logs.slice(0, 10));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
