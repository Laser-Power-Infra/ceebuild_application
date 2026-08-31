const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const dockets = await prisma.dockerPartyName.findMany({
    take: 10,
    orderBy: { id: 'desc' },
    select: { id: true, docketNoQtnNo: true, partyName: true },
  });
  console.log('Latest dockets:', dockets);
}

main().finally(() => prisma.$disconnect());
