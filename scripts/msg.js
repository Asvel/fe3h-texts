const fs = require('fs');
const YAML = require('yaml');

const data = fs.readFileSync('./data/msgdata.bin');
const read16 = offset => data.readUint16LE(offset);
const read32 = offset => data.readUint32LE(offset);
const readString = offset => {
  let end = offset;
  while (data[end] !== 0) end++;
  return data.toString('utf8', offset, end);
}

const sectionCount = read32(0);
const sections = new Array(sectionCount);
for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
  const sectionOffset = read32(4 + sectionIndex * 8);
  const tableCount = read32(sectionOffset);
  const tables = sections[sectionIndex] = new Array(tableCount);
  for (let tableIndex = 0; tableIndex < tableCount; tableIndex++) {
    const tableOffset = sectionOffset + read32(sectionOffset + 4 + tableIndex * 8);
    const rowCount = read16(tableOffset + 8);
    const rows = tables[tableIndex] = new Array(rowCount);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const textOffset = tableOffset + 20 + read32(tableOffset + 20 + rowIndex * 4);
      rows[rowIndex] = readString(textOffset);
    }
  }
}

const sectionLangs = [
  'Japanese', 'American English', 'European English', 'German', 'European French', 'American French',
  'European Spanish', 'American Spanish', 'Italian', 'Korean', 'Traditional Chinese', 'Simplified Chinese',
];
const desiredLangs = [
  'Japanese', 'Simplified Chinese', 'American English',
].map(lang => sectionLangs.indexOf(lang));
const result = {};
const dedup = {};
for (let tableIndex = 0; tableIndex < sections[0].length; tableIndex++) {
  for (let rowIndex = 0; rowIndex < sections[0][tableIndex].length; rowIndex++) {
    const desired = desiredLangs.map(sectionIndex => sections[sectionIndex][tableIndex][rowIndex]);
    if (desired[1] === desired[2]) continue;  // exclude untranslatable
    if (!desired.every(Boolean)) continue;  // exclude empty
    const dedupKey = desired.map(text => text.replace(/[0-9０-９\n]/g, '')).join('\0');
    if (dedupKey.length === desired.length - 1) continue;  // exclude number only
    if (dedupKey in dedup) continue;  // exclude duplicate
    dedup[dedupKey] = true;
    result[`${tableIndex}-${rowIndex}`] = desired;
  }
}

fs.writeFileSync('../msg.yaml', YAML.stringify(result));
