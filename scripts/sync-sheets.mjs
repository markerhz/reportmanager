import admin from 'firebase-admin';

// 1. อ่านข้อมูล Service Account จาก Environment Variable (รองรับทั้ง Base64 และ JSON ธรรมดา และ auto-repair)
const rawSaKey = process.env.GCP_SA_KEY;
if (!rawSaKey) {
  console.error('❌ Missing GCP_SA_KEY environment variable in GitHub Secrets');
  process.exit(1);
}

let serviceAccount;
try {
  const trimmed = rawSaKey.trim();
  if (trimmed.startsWith('{')) {
    try {
      serviceAccount = JSON.parse(trimmed);
    } catch (e1) {
      // Auto-repair escaped newlines if any
      const repaired = trimmed.replace(/([\r\n]+)/g, '\\n');
      serviceAccount = JSON.parse(repaired);
    }
  } else {
    // Base64 decoded
    const decoded = Buffer.from(trimmed, 'base64').toString('utf-8');
    serviceAccount = JSON.parse(decoded);
  }
} catch (e) {
  console.error('❌ Failed to parse GCP_SA_KEY:', e.message);
  process.exit(1);
}

console.log(`🔑 Service Account loaded for project: ${serviceAccount.project_id}`);

// 2. Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

// 3. Helper function ดึงข้อมูลจาก Google Sheet (รองรับทั้ง Direct Export และ Sheets API)
async function fetchSheetData(spreadsheetId) {
  console.log(`📡 Fetching data from Google Spreadsheet: ${spreadsheetId}...`);
  
  // วิธีที่ 1: ดึงผ่าน Direct CSV Export (เร็วที่สุด ไม่ต้องเปิด API บน Cloud Console)
  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=Event%20Schedule`;
    console.log(`🌐 Trying direct download from: ${csvUrl}`);
    const res = await fetch(csvUrl);
    if (res.ok) {
      const csvText = await res.text();
      const rows = parseCSV(csvText);
      if (rows && rows.length > 2) {
        console.log(`✅ Successfully fetched ${rows.length} rows via Direct Export!`);
        return rows.slice(2); // ข้ามแถว Header
      }
    }
  } catch (err) {
    console.log(`⚠️ Direct download fallback to API: ${err.message}`);
  }

  // วิธีที่ 2: ดึงผ่าน Google Sheets API
  try {
    const { google } = await import('googleapis');
    const auth = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Event Schedule'!A3:L",
      valueRenderOption: 'FORMATTED_VALUE',
    });
    return res.data.values || [];
  } catch (err) {
    console.error('❌ Google Sheets fetch failed:', err.message);
    throw err;
  }
}

// Simple CSV Parser for quotes and commas
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let inQuotes = false;
    let field = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(field);
        field = '';
      } else {
        field += char;
      }
    }
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function syncEventSchedule() {
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.error('❌ Missing SPREADSHEET_ID environment variable in GitHub Secrets');
    process.exit(1);
  }

  const rows = await fetchSheetData(spreadsheetId);
  console.log(`📋 Processing ${rows.length} rows...`);

  let batch = db.batch();
  let operationCount = 0;
  let syncedCount = 0;

  for (const row of rows) {
    // โครงสร้างคอลัมน์ Event Schedule:
    // col 2: Date (C), col 3: Start Time (D), col 4: End Time (E), col 5: Game Name (F), col 6: League (G), col 7: Channel (H), col 10: Assign (K)
    const date = row[2];
    const start = row[3];
    const end = row[4];
    const gameName = row[5];
    const league = row[6];
    const channel = row[7];
    const assign = row[10];
    
    // ข้ามแถวที่ไม่มีข้อมูลวันที่หรือยังไม่ได้มอบหมายงาน (Assign)
    if (!date || !assign || assign.trim() === '') continue;

    // สร้าง ID เอกสารเฉพาะตัว ป้องกันข้อมูลซ้ำ (Unique per date + channel + start)
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

  console.log(`🎉 Sync completed successfully! Total ${syncedCount} assigned feeds saved to Firestore.`);
}

syncEventSchedule().catch(err => {
  console.error('❌ Sync script execution failed:', err);
  process.exit(1);
});
