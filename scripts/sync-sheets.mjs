import admin from 'firebase-admin';
import * as XLSX from 'xlsx';

// ใช้ไฟล์จริง AIS_PLAY_Engineer_Resource_Precheck_Template.xlsx (1zqMGz59AVSDI8rvxVQdIY1OKrWTamQpo) เป็นฐานข้อมูลหลัก
// (แก้ไขตัวอักษร O แทนเลข 0 ที่เคยพิมพ์ผิดเป็น IY10Kr)
const REAL_XLSX_FILE_ID = '1zqMGz59AVSDI8rvxVQdIY1OKrWTamQpo';
const FIREBASE_PROJECT_ID = 'live-event-report';

function parseServiceAccountFromEnv() {
  const p1 = (process.env.GCP_SA_KEY || '').trim();
  const p2 = (process.env.SA_KEY_2 || '').trim();
  if (!p1) return null;

  const combined = (p1 + p2).trim();

  // กรณีที่ 1: เป็น JSON ของ Service Account โดยตรง
  if (combined.startsWith('{')) {
    try {
      const parsed = JSON.parse(combined);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    } catch {
      // กรณีวาง JSON แล้วมี newline ดิบข้างใน string
      const sanitized = combined.replace(/\r?\n/g, '\\n');
      const parsed = JSON.parse(sanitized);
      if (parsed.private_key) {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    }
  }

  // กรณีที่ 2: เป็น PEM Private Key โดยตรง (-----BEGIN PRIVATE KEY-----)
  if (combined.includes('BEGIN PRIVATE KEY')) {
    const cleanBody = combined
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\\n/g, '')
      .replace(/\s+/g, '');
    const lines = cleanBody.match(/.{1,64}/g) || [];
    const pem = ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
    return {
      project_id: FIREBASE_PROJECT_ID,
      client_email: 'firebase-adminsdk-fbsvc@live-event-report.iam.gserviceaccount.com',
      private_key: pem
    };
  }

  // กรณีที่ 3: เป็น Base64 (ทั้งแบบ Base64 ของ JSON ทั้งก้อน หรือ Base64 ของ PEM ที่แบ่ง p1 + p2)
  const b64 = combined.replace(/\s+/g, '');
  const decoded = Buffer.from(b64, 'base64').toString('utf8').trim();
  if (decoded.startsWith('{')) {
    const parsed = JSON.parse(decoded);
    if (parsed.private_key) {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return parsed;
  }

  const cleanB64 = decoded
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  const lines = cleanB64.match(/.{1,64}/g) || [];
  const pem = ['-----BEGIN PRIVATE KEY-----', ...lines, '-----END PRIVATE KEY-----', ''].join('\n');
  return {
    project_id: FIREBASE_PROJECT_ID,
    client_email: 'firebase-adminsdk-fbsvc@live-event-report.iam.gserviceaccount.com',
    private_key: pem
  };
}

let db = null;
let serviceAccount = null;

try {
  serviceAccount = parseServiceAccountFromEnv();
  if (serviceAccount) {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    db = admin.firestore();
    console.log('✅ Initialized Firebase Admin SDK successfully.');
  } else {
    console.warn('⚠️ GCP_SA_KEY not provided; using direct public XLSX + Firestore REST API fallback.');
  }
} catch (err) {
  console.warn(`⚠️ GCP_SA_KEY invalid or incomplete (${err.message}). Switching to direct public XLSX + Firestore REST API fallback...`);
  db = null;
  serviceAccount = null;
}

const MONTHS_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

function formatExcelDate(val) {
  if (val === null || val === undefined || val === '') return '';
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number') {
    const dt = new Date(Math.round((val - 25569) * 86400 * 1000));
    return dt.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmyMatch = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{4})$/);
  if (dmyMatch) {
    const dd = dmyMatch[1].padStart(2, '0');
    const mm = MONTHS_MAP[dmyMatch[2].toLowerCase()];
    if (mm) return `${dmyMatch[3]}-${mm}-${dd}`;
  }
  return s;
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
  const s = String(val).trim();
  const hm = s.match(/^(\d{1,2}):(\d{2})/);
  if (hm) return `${hm[1].padStart(2, '0')}:${hm[2]}`;
  return s;
}

async function downloadXlsxBuffer(fileId) {
  // 1. ลองดึงผ่าน Google Drive API ถ้ามี Service Account ที่ใช้งานได้
  if (serviceAccount && serviceAccount.private_key) {
    try {
      console.log(`📡 Fetching .xlsx via Google Drive API (File ID: ${fileId})...`);
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
      return Buffer.from(res.data);
    } catch (apiErr) {
      console.warn(`⚠️ Drive API fetch failed (${apiErr.message}), falling back to public download URL...`);
    }
  }

  // 2. Fallback ดึงไฟล์โดยตรงผ่าน Public Export / Download URL
  const urls = [
    `https://docs.google.com/spreadsheets/d/${fileId}/export?format=xlsx`,
    `https://drive.google.com/uc?export=download&id=${fileId}`
  ];

  for (const url of urls) {
    try {
      console.log(`🌐 Downloading .xlsx from ${url}...`);
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) {
        const arrBuf = await res.arrayBuffer();
        return Buffer.from(arrBuf);
      }
      console.warn(`⚠️ HTTP ${res.status} from ${url}`);
    } catch (e) {
      console.warn(`⚠️ Fetch error from ${url}: ${e.message}`);
    }
  }

  throw new Error(`Unable to download XLSX file (${fileId}) from either Drive API or public URLs.`);
}

async function fetchXlsxRows(fileId) {
  const buf = await downloadXlsxBuffer(fileId);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });
  const ws = wb.Sheets['Event Schedule'] || wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("Sheet 'Event Schedule' not found in .xlsx file");
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  console.log(`✅ Loaded ${rows.length} rows from AIS_PLAY_Engineer_Resource_Precheck_Template.xlsx!`);
  return rows.slice(2);
}

// ===== Firestore REST API Fallback Helpers (ไม่ต้องใช้ Private Key หากกฎ Firestore เปิดสำหรับโปรเจกต์นี้) =====
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

async function restListFeedDocNames() {
  const names = [];
  let pageToken = '';
  while (true) {
    const url = `${FIRESTORE_BASE}/feeds?pageSize=300&mask.fieldPaths=__name__${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Firestore REST list failed (${res.status}): ${txt}`);
    }
    const data = await res.json();
    if (Array.isArray(data.documents)) {
      for (const doc of data.documents) {
        if (doc.name) names.push(doc.name);
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return names;
}

async function restCommitWrites(writes) {
  const res = await fetch(`${FIRESTORE_BASE}:commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore REST commit failed (${res.status}): ${txt}`);
  }
}

async function syncViaRestApi(records) {
  console.log('🧹 Removing old records from Firestore via REST API...');
  const existingNames = await restListFeedDocNames();
  for (let i = 0; i < existingNames.length; i += 400) {
    const chunk = existingNames.slice(i, i + 400).map(name => ({ delete: name }));
    await restCommitWrites(chunk);
  }

  console.log(`📤 Uploading ${records.length} records to Firestore via REST API...`);
  for (let i = 0; i < records.length; i += 400) {
    const chunk = records.slice(i, i + 400).map(r => ({
      update: {
        name: `${FIRESTORE_BASE}/feeds/${r.docId}`,
        fields: {
          id: { stringValue: r.docId },
          date: { stringValue: r.date },
          start: { stringValue: r.start },
          end: { stringValue: r.end },
          feed: { stringValue: r.feed },
          name: { stringValue: r.name },
          channel: { stringValue: r.channel },
          assign: { stringValue: r.assign },
          assignedEngineers: {
            arrayValue: {
              values: r.assignedEngineers.map(a => ({ stringValue: a }))
            }
          },
          status: { stringValue: 'Pass' },
          isDeleted: { booleanValue: false },
          sourceFileId: { stringValue: REAL_XLSX_FILE_ID },
          updatedAt: { stringValue: r.updatedAt },
          updatedBy: { stringValue: 'xlsx-real-db-sync' }
        }
      }
    }));
    await restCommitWrites(chunk);
  }
}

async function syncRealDatabase() {
  const rows = await fetchXlsxRows(REAL_XLSX_FILE_ID);
  const nowIso = new Date().toISOString();
  const records = [];

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

    if (!date || date.startsWith('1900') || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !assign || assign === 'Assign') continue;

    const docId = `xlsx_${i + 3}_${date}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const assignees = assign.split(',').map(s => s.trim()).filter(Boolean);

    records.push({
      docId,
      date,
      start,
      end,
      feed: gameName,
      name: league,
      channel,
      assign,
      assignedEngineers: assignees,
      updatedAt: nowIso
    });
  }

  if (db) {
    console.log('🧹 Removing old sheet records from Firestore (Admin SDK)...');
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

    let batch = db.batch();
    let opCount = 0;
    for (const r of records) {
      const docRef = db.collection('feeds').doc(r.docId);
      batch.set(docRef, {
        id: r.docId,
        date: r.date,
        start: r.start,
        end: r.end,
        feed: r.feed,
        name: r.name,
        channel: r.channel,
        assign: r.assign,
        assignedEngineers: r.assignedEngineers,
        status: 'Pass',
        isDeleted: false,
        sourceFileId: REAL_XLSX_FILE_ID,
        updatedAt: r.updatedAt,
        updatedBy: 'xlsx-real-db-sync'
      });
      opCount++;
      if (opCount >= 400) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }
    if (opCount > 0) await batch.commit();
  } else {
    await syncViaRestApi(records);
  }

  console.log(`🎉 Synced ${records.length} assigned events from AIS_PLAY_Engineer_Resource_Precheck_Template.xlsx!`);
}

syncRealDatabase().catch(err => {
  console.error('❌ Sync failed:', err);
  process.exit(1);
});
