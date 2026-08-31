const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Deleting test docket record #217...');
  
  // Find docket #217 first to get docketNoQtnNo
  const docket = await prisma.dockerPartyName.findUnique({
    where: { id: 217 },
  });

  if (docket) {
    console.log(`Found Docket #217: docketNo="${docket.docketNoQtnNo}", partyName="${docket.partyName}"`);
    
    // Delete test items created under this docket if any
    if (docket.docketNoQtnNo) {
      const deletedItems = await prisma.itemTable.deleteMany({
        where: { docketNoQtnNo: docket.docketNoQtnNo },
      });
      console.log(`Deleted ${deletedItems.count} items linked to docket ${docket.docketNoQtnNo}`);
    }

    // Delete docket #217
    await prisma.dockerPartyName.delete({
      where: { id: 217 },
    });
    console.log('Successfully deleted Docket record #217 from database!');
  } else {
    console.log('Docket #217 not found or already deleted.');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
