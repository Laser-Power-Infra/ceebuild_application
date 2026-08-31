const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Deleting dummy record #216 and empty records...');
  const res = await prisma.dockerPartyName.deleteMany({
    where: {
      OR: [
        { id: 216 },
        { partyName: null },
        { docketNoQtnNo: '' },
        { docketNoQtnNo: ' ' },
      ],
    },
  });
  console.log(`Successfully deleted ${res.count} dummy records!`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
