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

  const { op } = req.query || {};

  if (!db) {
    res.status(500).json({ error: 'Firebase não configurado. Adicione as variáveis de ambiente na Vercel.' });
    return;
  }

  try {
    switch (op) {
      case 'login':
        res.status(200).json({ message: 'use /api/auth para login' });
        break;

      case 'cadastro': {
        const { nome, sobrenome, rg } = req.body || {};
        if (!nome || !sobrenome || !rg) {
          res.status(400).json({ error: 'Preencha todos os campos.' });
          return;
        }
        await db.collection('pending').add({
          nome,
          sobrenome,
          rg,
          status: 'pendente',
          createdAt: new Date().toISOString(),
        });
        res.status(200).json({ message: 'Cadastro enviado com sucesso!' });
        break;
      }

      case 'list-cadastros': {
        const snap = await db.collection('pending').get();
        const cadastros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.status(200).json({ cadastros });
        break;
      }

      case 'list-funcionarios': {
        const snap = await db.collection('users').get();
        const funcionarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.status(200).json({ funcionarios });
        break;
      }

      case 'permissoes': {
        const snap = await db.collection('permissoes').get();
        const permissoes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        res.status(200).json({ permissoes });
        break;
      }

      default:
        res.status(400).json({ error: 'op inválida' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
