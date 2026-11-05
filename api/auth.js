import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'crypto';

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!getApps().length && process.env.FIREBASE_PROJECT_ID) {
  initializeApp({ credential: cert(firebaseConfig) });
}

const db = getApps().length ? getFirestore() : null;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function segredo() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET não configurado.');
  return s;
}

function b64u(v) {
  return Buffer.from(v).toString('base64url');
}

function hmac(payload) {
  return crypto.createHmac('sha256', segredo()).update(payload).digest('base64url');
}

function emitirToken(dados) {
  const payload = b64u(JSON.stringify({ ...dados, exp: Date.now() + SESSION_TTL_MS }));
  return payload + '.' + hmac(payload);
}

function senhaConfere(senha, guardada) {
  if (!guardada) return false;
  const s = String(guardada);
  if (s.indexOf('scrypt$') === 0) {
    const partes = s.split('$');
    if (partes.length !== 3) return false;
    const h = crypto.scryptSync(String(senha), partes[1], 64);
    const esperado = Buffer.from(partes[2], 'hex');
    return h.length === esperado.length && crypto.timingSafeEqual(h, esperado);
  }
  if (s.indexOf('sha256:') === 0) {
    const h = crypto.createHash('sha256').update(String(senha)).digest('hex');
    const esperado = Buffer.from(s.slice(7));
    const a = Buffer.from(h);
    return a.length === esperado.length && crypto.timingSafeEqual(a, esperado);
  }
  const a = Buffer.from(String(senha));
  const b = Buffer.from(s);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function texto(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

function iso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  if (v instanceof Date) return v.toISOString();
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Galvabras-CSRF');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'método não permitido', error: 'método não permitido' });
    return;
  }

  try {
    if (!db) {
      res.status(500).json({ erro: 'Firebase não configurado.', error: 'Firebase não configurado.' });
      return;
    }

    const body = req.body || {};
    const login = texto(body.email || body.login || body.rg);
    const senha = body.senha;

    if (!login || !senha) {
      res.status(400).json({ erro: 'Informe e-mail e senha.', error: 'Informe e-mail e senha.' });
      return;
    }

    const alvo = login.toLowerCase();
    let snap = await db.collection('users').where('rg', '==', login).limit(1).get();
    if (snap.empty) {
      snap = await db.collection('users').where('email', '==', alvo).limit(1).get();
    }
    if (snap.empty) {
      res.status(401).json({ erro: 'Usuário ou senha incorretos.', error: 'Usuário ou senha incorretos.' });
      return;
    }

    const doc = snap.docs[0];
    const u = { id: doc.id, ...doc.data() };

    if (u.status && u.status !== 'approved') {
      res.status(403).json({ erro: 'Acesso bloqueado. Procure o administrador.', error: 'Acesso bloqueado.' });
      return;
    }

    if (!senhaConfere(senha, u.senha || u.password)) {
      res.status(401).json({ erro: 'Usuário ou senha incorretos.', error: 'Usuário ou senha incorretos.' });
      return;
    }

    db.collection('users').doc(doc.id).set(
      { ultimoAcesso: new Date().toISOString() },
      { merge: true }
    ).catch(() => {});

    const token = emitirToken({ uid: doc.id, rg: u.rg || '', perfil: u.perfil || 'funcionario' });

    res.status(200).json({
      token,
      expiraEm: Date.now() + SESSION_TTL_MS,
      usuario: {
        id: u.id,
        nome: u.nome || '',
        sobrenome: u.sobrenome || '',
        rg: u.rg || '',
        email: u.email || '',
        cargo: u.cargo || '',
        setor: u.setor || '',
        perfil: u.perfil || 'funcionario',
        status: u.status || 'approved',
        firstLogin: !!u.firstLogin,
        criadoEm: iso(u.createdAt) || iso(u.criadoEm) || null,
      },
    });
  } catch (e) {
    res.status(500).json({ erro: e.message, error: e.message });
  }
}
