import admin from 'firebase-admin';

const body = ((process.env.GCP_SA_KEY || '') + (process.env.SA_KEY_2 || '')).replace(/\s+/g, '');
const nl = String.fromCharCode(10);
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

// 3. ฟังก์ชันแปลง CSV
function parseCSV(text) {
  return text.split(/\r?\n/).filter(Boolean).map(line => {
    const row = [];
    let inQuotes = false, field = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
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

// 4. ดึงข้อมูลจากชีทและบันทึกลง Firestore
async function run() {
  const sheetId = process.env.SPREADSHEET_ID;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=Event%20Schedule`;
  console.log('Fetching sheet...');
  const res = await fetch(url);
  const text = await res.text();
  const rows = parseCSV(text).slice(2); // ข้ามหัวตาราง

  let batch = db.batch(), count = 0, saved = 0;
  for (const r of rows) {
    const [id, day, date, start, end, game, league, ch, media, notes, assign] = r;
    if (!date || !assign || !assign.trim()) continue;

    const docId = `${date}_${ch || 'CH'}_${start || '00'}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const docRef = db.collection('feeds').doc(docId);
    const assignees = assign.split(',').map(s => s.trim()).filter(Boolean);

    batch.set(docRef, {
      date: date.trim(),
      start: (start || '').trim(),
      end: (end || '').trim(),
      feed: (game || '').trim(),
      name: (league || '').trim(),
      channel: (ch || '').trim(),
      assign: assign.trim(),
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

  if (count > 0) {
    await batch.commit();
  }

  console.log(`Synced ${saved} rows.`);
}

run().catch(console.error);
