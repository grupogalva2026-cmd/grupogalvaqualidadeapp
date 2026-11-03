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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Galvabras-CSRF');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'método não permitido' });
    return;
  }

  try {
    const { email, senha, codigo2fa } = req.body || {};

    if (!db) {
      res.status(500).json({ error: 'Firebase não configurado. Adicione as variáveis de ambiente na Vercel.' });
      return;
    }

    if (!email || !senha) {
      res.status(400).json({ error: 'Informe e-mail e senha.' });
      return;
    }

    const snap = await db.collection('users').where('email', '==', email.toLowerCase()).limit(1).get();
    if (snap.empty) {
      res.status(401).json({ error: 'Usuário não encontrado.' });
      return;
    }

    const userDoc = snap.docs[0];
    const user = userDoc.data();

    res.status(200).json({
      token: 'dev-token-' + userDoc.id,
      usuario: {
        id: userDoc.id,
        nome: user.nome || '',
        email: user.email || '',
        perfil: user.perfil || 'funcionario',
        status: user.status || 'approved',
        firstLogin: !!user.firstLogin,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
