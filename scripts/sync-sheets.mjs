iport admin from 'firebase-admin';

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

async function run() {
  const sheetId = process.env.SPREADSHEET_ID;
  const host = ['https://docs', 'google', 'com/spreadsheets/d/'].join('.');
  const url = host + sheetId + '/gviz/tq?tqx=out:csv&sheet=Event%20Schedule';
  console.log('Fetching sheet...');
  const res = await fetch(url);
  const text = await res.text();
  const allRows = parseCSV(text);
  console.log('Total CSV rows parsed:', allRows.length);
  const rows = allRows.slice(1);

  let batch = db.batch(), count = 0, saved = 0;
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const [id, day, rawDate, start, end, game, league, ch, media, notes, assign] = r;
    if (!rawDate || !assign || !assign.trim() || rawDate === 'Date') continue;

    const date = toIsoDate(rawDate);
    const rawId = 'sheet_' + idx + '_' + date;
    const docId = encodeURIComponent(rawId).split('%').join('_');
    const docRef = db.collection('feeds').doc(docId);
    const assignees = assign.split(',').map(s => s.trim()).filter(Boolean);

    batch.set(docRef, {
      date: date,
      start: (start || '').trim(),
      end: (end || '').trim(),
      feed: (game || '').trim(),
      name: (league || '').trim(),
      channel: (ch || '').trim(),
      assign: assign.trim(),
      assignedEngineers: assignees,
      status: 'Pass',
      note: (notes || '').trim(),
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
  pro});cess.exit(1);
});ba
