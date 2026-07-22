import { mkdir, writeFile } from 'node:fs/promises';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const RETENTION_DAYS = 30;
const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountRaw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT secret');

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountRaw);
} catch {
  serviceAccount = JSON.parse(Buffer.from(serviceAccountRaw, 'base64').toString('utf8'));
}

if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

function jsonSafe(value) {
  if (value === null || value === undefined) return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, jsonSafe(v)]));
  return value;
}

async function createBackup() {
  const feeds = await db.collection('feeds').get();
  const records = [];
  for (const doc of feeds.docs) {
    const history = await doc.ref.collection('history').orderBy('savedAt', 'asc').get();
    records.push({
      id: doc.id,
      data: jsonSafe(doc.data()),
      history: history.docs.map(version => ({ id: version.id, data: jsonSafe(version.data()) }))
    });
  }
  const createdAt = new Date().toISOString();
  const payload = { schemaVersion: 1, projectId: serviceAccount.project_id, createdAt, retentionDays: RETENTION_DAYS, records };
  await mkdir('backup', { recursive: true });
  const filename = `backup/reportmanager-${createdAt.slice(0, 10)}.json`;
  await writeFile(filename, JSON.stringify(payload, null, 2));
  console.log(`Backed up ${records.length} records to ${filename}`);
}

async function cleanupExpired() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const feeds = await db.collection('feeds').where('isDeleted', '==', true).get();
  let deletedRecords = 0;
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
  console.log(`Purged ${deletedRecords} trash records and ${oldHistory.size} history versions older than ${cutoff}`);
}

const command = process.argv[2];
if (command === 'backup') await createBackup();
else if (command === 'cleanup') await cleanupExpired();
else throw new Error('Usage: node scripts/firestore-maintenance.mjs <backup|cleanup>');
