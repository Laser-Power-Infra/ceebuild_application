import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting database seeding from Google Sheets JSON data...');

  // 1. Seed Terms & Conditions ("tream-and-conditions")
  const termsPath = path.join(process.cwd(), 'scratch_terms_&_condition.json');
  if (fs.existsSync(termsPath)) {
    const termsData = JSON.parse(fs.readFileSync(termsPath, 'utf-8'));
    const rows = termsData.values || [];
    console.log(`Seeding TreamAndConditions (${rows.length - 1} rows)...`);
    
    // Clear existing
    await prisma.treamAndConditions.deleteMany({});

    // Skip header (row 0)
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      await prisma.treamAndConditions.create({
        data: {
          price: r[0] || null,
          payment: r[1] || null,
          delivery: r[2] || null,
          warranty: r[3] || null,
          approval: r[4] || null,
          inspection: r[5] || null,
        },
      });
    }
  }

  // 2. Seed Docker Party Name ("docket-party-name")
  const dockerPath = path.join(process.cwd(), 'scratch_docket,_party_name.json');
  if (fs.existsSync(dockerPath)) {
    const dockerData = JSON.parse(fs.readFileSync(dockerPath, 'utf-8'));
    const rows = dockerData.values || [];
    console.log(`Seeding DockerPartyName (${rows.length - 1} rows)...`);

    await prisma.dockerPartyName.deleteMany({});

    const dockerBatch = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      dockerBatch.push({
        docketNoQtnNo: r[0] || null,
        partyName: r[1] || null,
        address: r[2] || null,
        state: r[3] || null,
        utility: r[4] || null,
        deliveryLocation: r[5] || null,
        price: r[6] || null,
        payment: r[7] || null,
        delivery: r[8] || null,
        warranty: r[9] || null,
        approval: r[10] || null,
        inspection: r[11] || null,
      });
    }

    // Chunk insertion into batches of 100
    for (let i = 0; i < dockerBatch.length; i += 100) {
      const chunk = dockerBatch.slice(i, i + 100);
      await prisma.dockerPartyName.createMany({ data: chunk });
    }
  }

  // 3. Seed Main Sheet Items ("iteam-table")
  const mainPath = path.join(process.cwd(), 'scratch_main_sheet.json');
  if (fs.existsSync(mainPath)) {
    const mainData = JSON.parse(fs.readFileSync(mainPath, 'utf-8'));
    const rows = mainData.values || [];
    console.log(`Seeding ItemTable (${rows.length - 1} rows)...`);

    await prisma.itemTable.deleteMany({});

    const itemBatch = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      itemBatch.push({
        uniqueNo: r[0] || null,
        docketNoQtnNo: r[1] || null,
        itemNameParty: r[2] || null,
        uom: r[3] || null,
        qty: r[4] || null,
        ourItemNot: r[5] || null,
        typeOfItem: r[6] || null,
        ourItemName: r[7] || null,
        size: r[8] || null,
        lengthInMtr: r[9] || null,
        weightPerPiece: r[10] || null,
        price: r[11] || null,
        uomOfQtn: r[12] || null,
        a: r[13] || null,
        freightPerKg: r[14] || null,
        status: r[15] || null,
      });
    }

    for (let i = 0; i < itemBatch.length; i += 250) {
      const chunk = itemBatch.slice(i, i + 250);
      await prisma.itemTable.createMany({ data: chunk });
    }
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
