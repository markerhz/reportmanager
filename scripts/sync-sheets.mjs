import admin from 'firebase-admin';

const nl = String.fromCharCode(10);
const cr = String.fromCharCode(13);
const body = ((process.env.GCP_SA_KEY || '') + (process.env.SA_KEY_2 || '')).split(' ').join('').split(nl).join('').split(cr).join('');
const pem = '-----BEGIN PRIVATE KEY-----' + nl + (body.match(/.{1,64}/g) || []).join(nl) + nl + '-----END PRIVATE KEY-----' + nl;
const email = 'firebase-adminsdk-fbsvc' + String.fromCharCode(64) + ['live-event-report', 'iam', 'gserviceaccount', 'com'].join('.');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: 'live-event-report',
      clientEmail: email,
      privateKey: pem
    })
  });
}
const db = admin.firestore();

const thMonths = {
  [String.fromCharCode(3617,46,3604,46)]:'01',
  [String.fromCharCode(3601,46,3614,46)]:'02',
  [String.fromCharCode(3617,3637,46,3604,46)]:'03',
  [String.fromCharCode(3648,3617,46,3618,46)]:'04',
  [String.fromCharCode(3614,46,3604,46)]:'05',
  [String.fromCharCode(3617,3636,46,3618,46)]:'06',
  [String.fromCharCode(3601,46,3604,46)]:'07',
  [String.fromCharCode(3626,46,3604,46)]:'08',
  [String.fromCharCode(3601,46,3618,46)]:'09',
  [String.fromCharCode(3605,46,3604,46)]:'10',
  [String.fromCharCode(3614,46,3618,46)]:'11',
  [String.fromCharCode(3608,46,3604,46)]:'12',
  'Jan':'01', 'Feb':'02', 'Mar':'03', 'Apr':'04', 'May':'05', 'Jun':'06',
  'Jul':'07', 'Aug':'08', 'Sep':'09', 'Oct':'10', 'Nov':'11', 'Dec':'12'
};

function toIsoDate(dStr) {
  if (!dStr) return '';
  const s = dStr.trim();
  const parts = s.split('-');
  if (parts.length === 3 && parts[2].length === 4) {
    const dd = parts[0].padStart(2, '0');
    const mm = thMonths[parts[1]] || parts[1].padStart(2, '0');
    return parts[2] + '-' + mm + '-' + dd;
  }
  return s;
}
async function run() {
  const sheetId = process.env.SPREADSHEET_ID;
  const host = ['https://docs', 'google', 'com/spreadsheets/d/'].join('.');
  const url = host + sheetId + '/gviz/tq?tqx=out:json&sheet=Event%20Schedule';
  console.log('Fetching sheet JSON...');
  const res = await fetch(url);
  const text = await res.text();
  const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const data = JSON.parse(jsonStr);
  const cols = data.table.cols || [];
  const rows = data.table.rows || [];
  console.log('Cols:', cols.map((c, i) => i + ':' + c.id + ':' + c.label).join(' | '));
  console.log('Total JSON rows:', rows.length);
  console.log('Row 0:', JSON.stringify(rows[0]));
    console.log('Row 10:', JSON.stringify(rows[10]));
    console.log('Non-empty K count:', rows.filter(r => r && r.c && r.c[10] && (r.c[10].v || r.c[10].f)).length);
  const idxOf = (id, fallback) => {
    const i = cols.findIndex(c => c && c.id === id);
    return i >= 0 ? i : fallback;
  };
  const dIdx = idxOf('C', 2);
  const sIdx = idxOf('D', 3);
  const eIdx = idxOf('E', 4);
  const gIdx = idxOf('F', 5);
  const lIdx = idxOf('G', 6);
  const cIdx = idxOf('H', 7);
  const aIdx = idxOf('K', 10);

  const cellStr = (r, i) => {
    const cell = r && r.c && r.c[i];
    if (!cell) return '';
    return String(cell.f || cell.v || '').trim();
  };

  let batch = db.batch(), count = 0, saved = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const rawDate = cellStr(r, dIdx);
    const start = cellStr(r, sIdx);
    const end = cellStr(r, eIdx);
    const game = cellStr(r, gIdx);
    const league = cellStr(r, lIdx);
    const ch = cellStr(r, cIdx);
    const assign = cellStr(r, aIdx);
    if (!rawDate || !assign || rawDate === 'Date' || assign === 'Assign') continue;

    const date = toIsoDate(rawDate);
    const rawId = 'sheet_' + idx + '_' + date;
    const docId = encodeURIComponent(rawId).split('%').join('_');
    const docRef = db.collection('feeds').doc(docId);
    const assignees = assign.split(',').map(s => s.trim()).filter(Boolean);

    batch.set(docRef, {
      date: date,
      start: start,
      end: end,
      feed: game,
      name: league,
      channel: ch,
      assign: assign,
      assignedEngineers: assignees,
      status: 'Pass',
      isDeleted: false,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    count++;
    saved++;
    if (count >= 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
  console.log('Synced ' + saved + ' rows.');
}

run().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});

function parseCSV(text) {
  const q = String.fromCharCode(34);
  return text.split(cr).join('').split(nl).filter(Boolean).map(line => {
    const row = [];
    let inQuotes = false, field = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === q) {
        if (inQuotes && line[i + 1] === q) { field += q; i++; }
        else { inQuotes = !inQuotes; }
      } else if (c === ',' && !inQuotes) {
        row.push(field); field = '';
      } else {
        field += c;
      }
    }
    row.push(field);
    return row;
  });
}
  
