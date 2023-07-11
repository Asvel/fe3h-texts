const fs = require('fs');
const YAML = require('yaml');

const getRomfsPath = path => `${process.argv[2]}${path}`;

const readCString = (data, offset) => data.toString('utf8', offset, data.indexOf(0, offset))
  .replaceAll('\xa0', ' ').replaceAll('\r', '').replaceAll('\x1b', '$').trim();

const isDup = (dedupSet, texts) => {
  const key = (texts.join !== undefined ? texts : Array.from(texts)).join('\n');
  if (dedupSet.has(key)) return true;
  dedupSet.add(key);
};

const data0Data = fs.readFileSync(getRomfsPath('DATA0.bin'));
const data0FileCount = data0Data.length / 0x20 - 1;
const gameFiles = new Array(data0FileCount);
for (let fileId = 0; fileId < data0FileCount; fileId++) {
  const entry = data0Data.subarray(fileId * 0x20);
  gameFiles[fileId] = {
    offset: entry.readBigUInt64LE(0),
    size: entry.readUint32LE(8),
    isCompressed: entry.readUint32LE(0x18) !== 0,
  };
}

const info2Data = fs.readFileSync(getRomfsPath('patch4\\INFO2.bin'));
const info0Count = info2Data.readUint32LE(0);
const info1Count = info2Data.readUint32LE(8);
const info0Data = fs.readFileSync(getRomfsPath('patch4\\INFO0.bin'));
for (let i = 0; i < info0Count; i++) {
  const entry = info0Data.subarray(i * 0x120);
  const fileId = entry.readUint32LE(0);
  gameFiles[fileId] = {
    path: readCString(entry, 0x20 + 5/* 'rom:/' */),
    size: entry.readUint32LE(8),
    isCompressed: entry.readUint32LE(0x18) !== 0,
  };
}
const info1Data = fs.readFileSync(getRomfsPath('patch4\\info1.bin'));
for (let i = 0; i < info1Count; i++) {
  const entry = info1Data.subarray(i * 0x118);
  gameFiles.push({
    path: readCString(entry, 0x18 + 5/* 'rom:/' */),
    size: entry.readUint32LE(0),
    isCompressed: entry.readUint32LE(0x10) !== 0,
    info1Index: i,
  });
}

// dummy and only appears in lang 'JPN'
const dummyFiles = new Set([8659, 8660, 8761, 8762]);
for (let i = 16; i <= 25; i++) dummyFiles.add(data0FileCount + i);
for (let i = 215; i <= 236; i++) dummyFiles.add(data0FileCount + i);
for (let i = 243; i <= 257; i++) dummyFiles.add(data0FileCount + i);

const msgs = new Map();
const captions = new Map();
const talks = new Map();
const data1File = fs.openSync(getRomfsPath('DATA1.bin'), 'r');
for (let fileId = 0; fileId < gameFiles.length; fileId++) {
  if (dummyFiles.has(fileId)) continue;
  const fileEntry = gameFiles[fileId];
  if (fileEntry.size === 0 || fileEntry.isCompressed) continue;
  const file = fileEntry.path === undefined ? data1File : fs.openSync(getRomfsPath(fileEntry.path), 'r');
  const fileOffset = fileEntry.path === undefined ? fileEntry.offset : 0;

  const loadCurrentFile = () => {
    const data = Buffer.allocUnsafe(fileEntry.size);
    fs.readSync(file, data, 0, data.byteLength, fileOffset);
    return data;
  }

  const header = new Uint32Array(6);
  fs.readSync(file, header, 0, header.byteLength, fileOffset);

  // common/common/msgdata,*scrdata
  if (header[0] === 0x0c && header[1] === 0x64 && header[3] - header[2] === header[1]) {
    const data = loadCurrentFile();
    // section->table->row->cell
    const langCount = header[0];
    const langs = new Array(langCount);
    for (let langIndex = 0; langIndex < langCount; langIndex++) {
      const langEntry = data.subarray(data.readUint32LE(4 + langIndex * 8));
      const tableCount = langEntry.readUint32LE(0);
      const tables = langs[langIndex] = new Array(tableCount);
      for (let tableIndex = 0; tableIndex < tableCount; tableIndex++) {
        const tableEntry = langEntry.subarray(langEntry.readUint32LE(4 + tableIndex * 8));
        const rowCount = tableEntry.readUint16LE(8);
        const rowSize = tableEntry.readUint16LE(10);
        const rowBody = tableEntry.subarray(tableEntry.readUint16LE(12))
        const rows = tables[tableIndex] = new Array(rowCount);
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
          const cells = rows[rowIndex] = [];
          for (let cellIndex = 0; cellIndex < rowSize / 4; cellIndex++) {
            if (tableEntry.readUint8(16 + cellIndex) !== 0) continue;
            const cellOffset = rowBody.readInt32LE(rowIndex * rowSize + cellIndex * 4);
            cells.push(cellOffset !== -1 ? readCString(rowBody, cellOffset) : '');
          }
        }
      }
    }
    msgs.set(gameFiles[fileId].path.slice('patchX/'.length, -'.bin'.length), langs);
  }

  // common/common/caption/
  if (header[0] === 0x2962 && (8 + header[1] * 4) === header[2]) {
    const data = loadCurrentFile();
    const count = header[1];
    const lines = [];
    for (let i = 0; i < count; i++) {
        const offset = 8 + data.readUint32LE(8 + i * 4);
        lines.push(readCString(data, offset));
    }
    captions.set(fileId, lines);
  }

  // nx/event/talk_event/text/
  // nx/event/talk_scinario/text/*_S
  // nx/event/talk_castle/text/
  if (header[0] === 0x01 && header[1] === 0x01 && header[2] === 0x20 && header[5] === 0xeeeeeeee) {
    const data = loadCurrentFile();
    const pointersSize = header[3];
    const count = header[4];
    const lines = [];
    for (let i = 0; i < count; i++) {
      const offset = 0x20 + pointersSize + data.readUint32LE(0x20 + i * 4);
      const text = readCString(data, offset);
      lines.push(text === 'tTemporarymessage' ? '' : text);
    }
    talks.set(fileId, lines);
  }

  // nx/event/talk_scinario/text/*_V,*_B
  if (header[0] * 8 + 4 === header[1]) {
    const data = loadCurrentFile();
    if (data[header[1]] === 0x5b/* '[' */ && data[header[1] + 5] === 0x5d/* ']' */) {
      const count = header[0];
      const lines = [];
      for (let i = 0; i < count; i++) {
        const offset = data.readUint32LE(0x04 + i * 4);
        const text = readCString(data, offset);
        lines.push(text === '[9999]NULL#00＠DummyVoice' ? '' :
          text.slice('[0000]'.length, -'＠000000#00'.length));
      }
      talks.set(fileId, lines);
    }
  }

  if (fileEntry.path !== undefined) fs.closeSync(file);
}
fs.closeSync(data1File);

const gameLangs = ['JPN', 'ENG_U', 'ENG_E', 'GER', 'FRA_E', 'FRA_U', 'ESP_E', 'ESP_U', 'ITA', 'KOR', 'TWN', 'CHN'];
const desiredLangIndexes = ['JPN', 'CHN', 'ENG_U'].map(lang => gameLangs.indexOf(lang));
const output = new Map();

// msg
for (const fileName of [
  'msgdata',
  'scrdata', 'scrdataDLC',
  'gwscrdata', 'scrgwdataDLC',
  'tuscrdata',
  'btlscrdata', 'btlscrdataDLC',
]) {
  const filePath = `common/common/${fileName}`;
  const langs = msgs.get(filePath);
  const tables = new Map();
  for (let tableIndex = 0; tableIndex < langs[0].length; tableIndex++) {
    const rowDedupSet = new Set();
    const rows = new Map();
    for (let rowIndex = 0; rowIndex < langs[0][tableIndex].length; rowIndex++) {
      const cellDedupSet = new Set();
      const cells = new Map();
      for (let cellIndex = 0; cellIndex < langs[0][tableIndex][rowIndex].length; cellIndex++) {
        const trans = desiredLangIndexes.map(sectionIndex => langs[sectionIndex][tableIndex][rowIndex][cellIndex]);
        if (trans[1] === trans[2] || !trans.every(Boolean)) continue;
        if (trans[2] === 'iron_untranslated' || trans[1] === '未定') continue;
        if (isDup(cellDedupSet, trans.map(text => text.replace(/[0-9０-９]+$/, '')))) continue;
        cells.set(cellIndex, trans);
      }
      if (cells.size === 0) continue;
      if (isDup(rowDedupSet, cellDedupSet.values())) continue;
      rows.set(rowIndex, langs[0][tableIndex][0].length === 1 ? Array.from(cells.values()) : cells);
    }
    if (rows.size === 0) continue;
    tables.set(tableIndex, rows);
  }
  output.set(filePath, tables);
}

// caption
{
  const entries_ = Array.from(captions.entries());
  const group2Fisrt = entries_.findIndex(kvp => kvp[0] === 29768);
  const info1Fisrt = entries_.findIndex(kvp => kvp[0] > data0FileCount);

  const dedupSet = new Set();
  for (const entries of [entries_.slice(0, group2Fisrt),
    entries_.slice(group2Fisrt, info1Fisrt), entries_.slice(info1Fisrt)]) {
    const fileCount = entries.length / (gameLangs.length + 1);  // caption has an extra lang 'ENG_R'
    const captionLangIndexes = desiredLangIndexes.map((x, i) => i === 0 ? x : x + 1);
    for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
      const lines = new Map();
      for (let lineIndex = 0; lineIndex < entries[fileIndex][1].length; lineIndex++) {
        const trans = captionLangIndexes.map(langIndex =>
          entries[fileCount * langIndex + fileIndex][1][lineIndex]);
        if (trans[1] === trans[2] || !trans.every(Boolean)) continue;
        lines.set(lineIndex, trans);
      }
      if (lines.size === 0) continue;
      if (isDup(dedupSet, lines.values())) continue;
      output.set(`common/common/caption/${entries[fileIndex][0]}`, lines);
    }
  }
}

// talk
{
  let entries_ = Array.from(talks.entries());
  const info1Fisrt = entries_.findIndex(kvp => kvp[0] > data0FileCount);

  // move range i483..i526 ahead i373
  const [ i373, i483, i526 ] = [373, 483, 526].map(info1Index =>
    entries_.findIndex(kvp => kvp[0] === data0FileCount + info1Index, info1Fisrt));
  entries_ = [
    ...entries_.slice(0, i373),
    ...entries_.slice(i483, i526 + 1),
    ...entries_.slice(i373, i483),
    ...entries_.slice(i526 + 1),
  ];

  const dedupSet = new Set();
  for (const entries of [entries_.slice(0, info1Fisrt), entries_.slice(info1Fisrt)]) {
    const fileCount = entries.length / gameLangs.length;
    for (let fileIndex = 0; fileIndex < fileCount; fileIndex++) {
      const lines = new Map();
      for (let lineIndex = 0; lineIndex < entries[fileIndex][1].length; lineIndex++) {
        const trans = desiredLangIndexes.map(langIndex =>
          entries[fileCount * langIndex + fileIndex][1][lineIndex]);
        if (trans[1] === trans[2] || !trans.every(Boolean)) continue;
        lines.set(lineIndex, trans);
      }
      if (lines.size === 0) continue;
      if (isDup(dedupSet, lines.values())) continue;
      output.set(`nx/event/talk_*/text/${entries[fileIndex][0]}`, lines);
    }
  }
}

fs.writeFileSync('../texts.yaml', YAML.stringify(output, { lineWidth: 0 }));
