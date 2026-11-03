import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!getApps().length && process.env.FIREBASE_PROJECT_ID) {
  initializeApp({ credential: cert(firebaseConfig) });
}

const db = getApps().length ? getFirestore() : null;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Galvabras-CSRF');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!db) {
    res.status(500).json({ error: 'Firebase não configurado.' });
    return;
  }

  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      await db.collection('rnc').add({
        ...body,
        createdAt: new Date().toISOString(),
      });
      res.status(200).json({ ok: true, message: 'RNC recebido.' });
    } else {
      const snap = await db.collection('rnc').limit(50).get();
      const rncs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      res.status(200).json({ rncs });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
