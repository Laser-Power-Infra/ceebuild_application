const fs = require('fs');
const path = require('path');

function inspectCsv(filename) {
  const filepath = path.join('c:', 'Users', 'Niloy Paul', 'Desktop', 'CEEBUILD DASHBOARD', filename);
  if (!fs.existsSync(filepath)) {
    console.log(`File not found: ${filename}`);
    return;
  }
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  console.log(`\n=== File: ${filename} ===`);
  console.log(`Total lines: ${lines.length}`);
  console.log('Header line:', lines[0]);
  console.log('Sample line 1:', lines[1]);
  console.log('Sample line 2:', lines[2]);
}

inspectCsv('main_sheet.csv');
inspectCsv('docket_party.csv');
