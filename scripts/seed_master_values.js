const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Master Values from existing DB data...');

  // Fetch unique party names
  const partyNames = await prisma.dockerPartyName.findMany({
    where: { partyName: { not: null } },
    select: { partyName: true },
    distinct: ['partyName'],
  });

  // Fetch unique states
  const states = await prisma.dockerPartyName.findMany({
    where: { state: { not: null } },
    select: { state: true },
    distinct: ['state'],
  });

  // Fetch unique utilities
  const utilities = await prisma.dockerPartyName.findMany({
    where: { utility: { not: null } },
    select: { utility: true },
    distinct: ['utility'],
  });

  // Fetch unique addresses
  const addresses = await prisma.dockerPartyName.findMany({
    where: { address: { not: null } },
    select: { address: true },
    distinct: ['address'],
  });

  // Fetch unique statuses
  const statuses = ['Quoted', 'NOT Required'];

  const seedItems = [
    ...partyNames.map((p) => ({ type: 'PARTY_NAME', value: p.partyName.trim() })),
    ...states.map((s) => ({ type: 'STATE', value: s.state.trim() })),
    ...utilities.map((u) => ({ type: 'UTILITY', value: u.utility.trim() })),
    ...addresses.map((a) => ({ type: 'ADDRESS', value: a.address.trim() })),
    ...statuses.map((st) => ({ type: 'STATUS', value: st })),
  ].filter((item) => item.value && item.value !== '');

  let createdCount = 0;
  for (const item of seedItems) {
    const existing = await prisma.masterValue.findFirst({
      where: { type: item.type, value: item.value },
    });
    if (!existing) {
      await prisma.masterValue.create({
        data: {
          type: item.type,
          value: item.value,
          isActive: true,
        },
      });
      createdCount++;
    }
  }

  console.log(`Seeded ${createdCount} master values into PostgreSQL database!`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
