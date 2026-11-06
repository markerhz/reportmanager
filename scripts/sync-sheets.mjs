import admin from 'firebase-admin';
import * as XLSX from 'xlsx';

// ใช้ไฟล์จริง AIS_PLAY_Engineer_Resource_Precheck_Template.xlsx (1zqMGz59AVSDI8rvxVQdIY1OKrWTamQpo) เป็นฐานข้อมูลหลักเท่านั้น
const REAL_XLSX_FILE_ID = '1zqMGz59AVSDI8rvxVQdIY1OKrWTamQpo';

const p1 = (process.env.GCP_SA_KEY || '').trim();
const p2 = (process.env.SA_KEY_2 || '').trim();
if (!p1) {
  console.error('❌ Missing GCP_SA_KEY in GitHub Secrets');
  process.exit(1);
}

let serviceAccount;
if (p1.startsWith('{')) {
  serviceAccount = JSON.parse(p1);
} else {
  const b64 = (p1 + p2).replace(/\s+/g, '');
  const rawPem = Buffer.from(b64, 'base64').toString('utf8');
  const cleanB64 = rawPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  const lines = cleanB64.match(/.{1,64}/g) || [];
  const pem = ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
  serviceAccount = {
    project_id: 'live-event-report',
    client_email: 'firebase-adminsdk-fbsvc@live-event-report.iam.gserviceaccount.com',
    private_key: pem
  };
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

function formatExcelDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number') {
    const dt = new Date(Math.round((val - 25569) * 86400 * 1000));
    return dt.toISOString().slice(0, 10);
  }
  return String(val).trim();
}

function formatExcelTime(val) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) {
    const hh = String(val.getUTCHours()).padStart(2, '0');
    const mm = String(val.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  if (typeof val === 'number') {
    const totalMins = Math.round((val % 1) * 1440);
    const hh = String(Math.floor(totalMins / 60) % 24).padStart(2, '0');
    const mm = String(totalMins % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return String(val).trim();
}

async function fetchXlsxRows(fileId) {
  console.log(`📡 Fetching real database (.xlsx) from Google Drive File ID: ${fileId}...`);
  const { google } = await import('googleapis');
  const auth = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ],
  });

  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  const wb = XLSX.read(Buffer.from(res.data), { type: 'buffer', cellDates: false });
  const ws = wb.Sheets['Event Schedule'];
  if (!ws) throw new Error("Sheet 'Event Schedule' not found in .xlsx file");
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  console.log(`✅ Loaded ${rows.length} rows from AIS_PLAY_Engineer_Resource_Precheck_Template.xlsx!`);
  return rows.slice(2);
}

async function syncRealDatabase() {
  const rows = await fetchXlsxRows(REAL_XLSX_FILE_ID);

  // 1. ล้างข้อมูลเก่าจากชีตเดิมใน Firestore ออกก่อน เพื่อให้เหลือเฉพาะข้อมูลจาก .xlsx ตัวจริงเท่านั้น
  console.log('🧹 Removing old sheet records from Firestore...');
  const existingSnap = await db.collection('feeds').get();
  let delBatch = db.batch();
  let delCount = 0;
  for (const doc of existingSnap.docs) {
    delBatch.delete(doc.ref);
    delCount++;
    if (delCount >= 400) {
      await delBatch.commit();
      delBatch = db.batch();
      delCount = 0;
    }
  }
  if (delCount > 0) await delBatch.commit();

  // 2. บันทึกข้อมูลจาก AIS_PLAY_Engineer_Resource_Precheck_Template.xlsx
  let batch = db.batch();
  let opCount = 0;
  let syncedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const date = formatExcelDate(row[2]);
    const start = formatExcelTime(row[3]);
    const end = formatExcelTime(row[4]);
    const gameName = String(row[5] || '').trim();
    const league = String(row[6] || '').trim();
    let channel = String(row[7] || '').trim();
    if (channel.endsWith('.0')) channel = channel.slice(0, -2);
    const assign = String(row[10] || '').trim();

    if (!date || !assign) continue;

    const docId = `xlsx_${i + 3}_${date}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const docRef = db.collection('feeds').doc(docId);
    const assignees = assign.split(',').map(s => s.trim()).filter(Boolean);

    batch.set(docRef, {
      date,
      start,
      end,
      feed: gameName,
      name: league,
      channel,
      assign,
      assignedEngineers: assignees,
      status: 'Pass',
      isDeleted: false,
      sourceFileId: REAL_XLSX_FILE_ID,
      updatedAt: new Date().toISOString(),
      updatedBy: 'xlsx-real-db-sync'
    });

    opCount++;
    syncedCount++;
    if (opCount >= 400) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) await batch.commit();
  console.log(`🎉 Synced ${syncedCount} assigned events from AIS_PLAY_Engineer_Resource_Precheck_Template.xlsx!`);
}

syncRealDatabase().catch(err => {
  console.error('❌ Sync failed:', err);
  process.exit(1);
});
