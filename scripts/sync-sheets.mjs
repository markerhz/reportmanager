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
    try {
      serviceAccount = JSON.parse(trimmed);
    } catch (e1) {
      const repaired = trimmed.replace(/([\r\n]+)/g, '\\n');
      serviceAccount = JSON.parse(repaired);
    }
  } else {
    // ถอดรหัส Base64
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

// 3. Helper function ดึงข้อมูลจาก Google Sheet (ดึงตรงแบบ Dual-Engine)
async function fetchSheetData(spreadsheetId) {
  console.log(`📡 Fetching data from Google Spreadsheet: ${spreadsheetId}...`);
  
  // วิธีที่ 1: ดึงผ่าน Direct Web Export (เร็วที่สุดและไม่ต้องเปิด API บน Cloud Console)
  try {
    const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=Event%20Schedule`;
    console.log(`🌐 Trying direct download from: ${csvUrl}`);
    const res = await fetch(csvUrl);
    if (res.ok) {
      const csvText = await res.text();
      const rows = parseCSV(csvText);
      if (rows && rows.length > 2) {
        console.log(`✅ Successfully fetched ${rows.length} rows via Direct Export!`);
        return rows.slice(2);
      }
    }
  } catch (err) {
    console.log(`⚠️ Direct download fallback: ${err.message}`);
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

// Simple CSV Parser
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
    // col 2: Date, col 3: Start, col 4: End, col 5: Game Name, col 6: League
