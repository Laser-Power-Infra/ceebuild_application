const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const allDockets = await prisma.dockerPartyName.findMany();
  const validDocketNos = new Set(allDockets.map((d) => d.docketNoQtnNo).filter(Boolean));

  const allItems = await prisma.itemTable.findMany();
  const orphanedItems = allItems.filter((i) => i.docketNoQtnNo && !validDocketNos.has(i.docketNoQtnNo));

  console.log(`Total Dockets: ${allDockets.length}`);
  console.log(`Total Items: ${allItems.length}`);
  console.log(`Orphaned Items count (belonging to non-existent dockets): ${orphanedItems.length}`);

  if (orphanedItems.length > 0) {
    console.log('Sample orphaned items:', orphanedItems.slice(0, 5).map(i => ({ id: i.id, docketNoQtnNo: i.docketNoQtnNo, itemNameParty: i.itemNameParty })));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
