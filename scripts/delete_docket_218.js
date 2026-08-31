const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Deleting test docket record #218...');
  
  const docket = await prisma.dockerPartyName.findUnique({
    where: { id: 218 },
  });

  if (docket) {
    console.log(`Found Docket #218: docketNo="${docket.docketNoQtnNo}", partyName="${docket.partyName}"`);
    
    if (docket.docketNoQtnNo) {
      const deletedItems = await prisma.itemTable.deleteMany({
        where: { docketNoQtnNo: docket.docketNoQtnNo },
      });
      console.log(`Deleted ${deletedItems.count} items linked to docket ${docket.docketNoQtnNo}`);
    }

    await prisma.dockerPartyName.delete({
      where: { id: 218 },
    });
    console.log('Successfully deleted Docket record #218 from database!');
  } else {
    console.log('Docket #218 not found or already deleted.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
