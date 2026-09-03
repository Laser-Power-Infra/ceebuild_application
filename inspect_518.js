const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const dockets = await prisma.dockerPartyName.findMany({
    where: { docketNoQtnNo: { contains: '518' } },
  });
  console.log('--- Dockets in DB matching 518 ---');
  console.log(dockets);

  const items = await prisma.itemTable.findMany({
    where: { docketNoQtnNo: { contains: '518' } },
  });
  console.log('--- Items in DB matching 518 ---');
  console.log(items.map(i => ({ id: i.id, docketNoQtnNo: i.docketNoQtnNo, itemNameParty: i.itemNameParty, status: i.status, createdAt: i.createdAt })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
