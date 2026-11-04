import { google } from 'googleapis';
import admin from 'firebase-admin';

// 1. อ่านข้อมูล Service Account จาก Environment Variable (รองรับทั้ง Base64 และ JSON ธรรมดา)
const rawSaKey = process.env.GCP_SA_KEY;
if (!rawSaKey) {
  console.error('❌ Missing GCP_SA_KEY environment variable in GitHub Secrets');
  process.exit(1);
}

let serviceAccount;
try {
  const trimmed = rawSaKey.trim();
  if (trimmed.startsWith('{')) {
    serviceAccount = JSON.parse(trimmed);
  } else {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
    serviceAccount = JSON.parse(decoded);
  }
} catch (e) {
  console.error('❌ Failed to parse GCP_SA_KEY as JSON:', e.message);
  process.exit(1);
}

// 2. Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

// 3. Initialize Google Sheets API
const auth = new google.auth.JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function syncEventSchedule() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.error('❌ Missing SPREADSHEET_ID environment variable in GitHub Secrets');
    process.exit(1);
  }

  console.log(`📡 Fetching data from Google Spreadsheet: ${spreadsheetId}...`);

  // ดึงข้อมูลคอลัมน์ C ถึง K (Date, Start Time, End Time, Game Name, League, Channel, Media ID, Notes, Assign)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "'Event Schedule'!C3:K",
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = res.data.values || [];
  console.log(`📋 Retrieved ${rows.length} rows from Event Schedule.`);

  let batch = db.batch();
  let operationCount = 0;
  let syncedCount = 0;

  for (const row of rows) {
    const [date, start, end, gameName, league, channel, mediaId, notes, assign] = row;
    
    // ข้ามแถวที่ไม่มีข้อมูลวันที่หรือยังไม่ได้มอบหมายงาน (Assign)
    if (!date || !assign || assign.trim() === '') continue;

    // สร้าง ID เอกสารเฉพาะตัวเพื่อป้องกันข้อมูลซ้ำ (Unique ID per date + channel + start)
    const rawId = `${date}_${channel || 'CH'}_${start || '00'}`;
    const docId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const docRef = db.collection('feeds').doc(docId);

    // แยกรายชื่อวิศวกรกรณีที่มีหลายคนคั่นด้วย comma
    const assignees = assign.split(',').map(s => s.trim()).filter(Boolean);

    batch.set(docRef, {
      date: date.trim(),
      start: start ? start.trim() : '',
      end: end ? end.trim() : '',
      feed: gameName ? gameName.trim() : '',
      name: league ? league.trim() : '',
      channel: channel ? channel.trim() : '',
      assign: assign.trim(),
      assignedEngineers: assignees,
      status: 'Pass',
      isDeleted: false,
      updatedAt: new Date().toISOString(),
      updatedBy: 'github-actions-sync'
    }, { merge: true });

    operationCount++;
    syncedCount++;

    // Firestore batch จำกัดสูงสุด 500 operations ต่อ 1 batch
    if (operationCount >= 450) {
      await batch.commit();
      batch = db.batch();
      operationCount = 0;
      console.log(`💾 Committed 450 records batch...`);
    }
  }

  if (operationCount > 0) {
    await batch.commit();
  }

  console.log(`✅ Sync completed successfully! Total ${syncedCount} assigned feeds saved to Firestore.`);
}

syncEventSchedule().catch(err => {
  console.error('❌ Sync script execution failed:', err);
  process.exit(1);
});
