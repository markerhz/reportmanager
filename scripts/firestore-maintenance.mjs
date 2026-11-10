import { mkdir, writeFile } from 'node:fs/promises';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const RETENTION_DAYS = 30;
const FIREBASE_PROJECT_ID = 'live-event-report';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function parseServiceAccountFromEnv() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  const p1 = (process.env.GCP_SA_KEY || '').trim();
  const p2 = (process.env.SA_KEY_2 || '').trim();
  const combined = raw || (p1 + p2).trim();
  if (!combined) return null;

  if (combined.startsWith('{')) {
    try {
      const parsed = JSON.parse(combined);
      if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      return parsed;
    } catch {
      const sanitized = combined.replace(/\r?\n/g, '\\n');
      const parsed = JSON.parse(sanitized);
      if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      return parsed;
    }
  }

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

  const b64 = combined.replace(/\s+/g, '');
  const decoded = Buffer.from(b64, 'base64').toString('utf8').trim();
  if (decoded.startsWith('{')) {
    const parsed = JSON.parse(decoded);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
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
    if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
    db = getFirestore();
    console.log('✅ Initialized Firebase Admin SDK for Firestore maintenance.');
  } else {
    console.warn('⚠️ No FIREBASE_SERVICE_ACCOUNT / GCP_SA_KEY secret found; using Firestore REST API mode.');
  }
} catch (err) {
  console.warn(`⚠️ Service Account key could not be parsed (${err.message}); falling back to Firestore REST API mode.`);
  db = null;
}

function jsonSafe(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}

function decodeRestValue(v) {
  if (!v || typeof v !== 'object') return v;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeRestValue);
  if ('mapValue' in v) {
    const out = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) {
      out[k] = decodeRestValue(val);
    }
    return out;
  }
  return v;
}

function decodeRestFields(fieldsObj) {
  const out = {};
  for (const [k, v] of Object.entries(fieldsObj || {})) {
    out[k] = decodeRestValue(v);
  }
  return out;
}

async function restFetchAllFeeds() {
  const docs = [];
  let pageToken = '';
  while (true) {
    const url = `${FIRESTORE_BASE}/feeds?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Firestore REST GET feeds failed (${res.status}): ${txt}`);
    }
    const data = await res.json();
    if (Array.isArray(data.documents)) {
      for (const doc of data.documents) {
        const id = doc.name ? doc.name.split('/').pop() : '';
        docs.push({
          name: doc.name,
          id,
          data: decodeRestFields(doc.fields),
          history: []
        });
      }
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return docs;
}

async function createBackup() {
  const records = [];
  if (db) {
    const feeds = await db.collection('feeds').get();
    for (const doc of feeds.docs) {
      const history = await doc.ref.collection('history').orderBy('savedAt', 'asc').get();
      records.push({
        id: doc.id,
        data: jsonSafe(doc.data()),
        history: history.docs.map(version => ({ id: version.id, data: jsonSafe(version.data()) }))
      });
    }
  } else {
    const restDocs = await restFetchAllFeeds();
    for (const d of restDocs) {
      records.push({
        id: d.id,
        data: d.data,
        history: d.history
      });
    }
  }

  const createdAt = new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    projectId: serviceAccount?.project_id || FIREBASE_PROJECT_ID,
    createdAt,
    retentionDays: RETENTION_DAYS,
    records
  };
  await mkdir('backup', { recursive: true });
  const filename = `backup/reportmanager-${createdAt.slice(0, 10)}.json`;
  await writeFile(filename, JSON.stringify(payload, null, 2));
  console.log(`✅ Backed up ${records.length} records to ${filename}`);
}

async function cleanupExpired() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let deletedRecords = 0;
  let deletedHistory = 0;

  if (db) {
    const feeds = await db.collection('feeds').where('isDeleted', '==', true).get();
    for (const doc of feeds.docs) {
      const deletedAt = doc.get('deletedAt');
      if (typeof deletedAt === 'string' && deletedAt < cutoff) {
        await db.recursiveDelete(doc.ref);
        deletedRecords += 1;
      }
    }
    const oldHistory = await db.collectionGroup('history').where('savedAt', '<', cutoff).get();
    const writer = db.bulkWriter();
    oldHistory.docs.forEach(doc => writer.delete(doc.ref));
    await writer.close();
    deletedHistory = oldHistory.size;
  } else {
    const restDocs = await restFetchAllFeeds();
    const toDeleteNames = [];
    for (const d of restDocs) {
      if (d.data && d.data.isDeleted === true && typeof d.data.deletedAt === 'string' && d.data.deletedAt < cutoff) {
        toDeleteNames.push(d.name);
      }
    }
    for (let i = 0; i < toDeleteNames.length; i += 400) {
      const writes = toDeleteNames.slice(i, i + 400).map(name => ({ delete: name }));
      const res = await fetch(`${FIRESTORE_BASE}:commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Firestore REST delete failed (${res.status}): ${txt}`);
      }
    }
    deletedRecords = toDeleteNames.length;
  }

  console.log(`✅ Purged ${deletedRecords} trash records and ${deletedHistory} history versions older than ${cutoff}`);
}

const rawCmd = (process.argv[2] || '').replace(/^--/, '');
if (rawCmd === 'backup') {
  await createBackup();
} else if (rawCmd === 'cleanup') {
  await cleanupExpired();
} else if (rawCmd === 'check') {
  console.log('✅ Firestore maintenance check passed.');
} else {
  throw new Error('Usage: node scripts/firestore-maintenance.mjs <backup|cleanup|check>');
}
