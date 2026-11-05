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

const COLECOES = ['users', 'userPermissions', 'sacs', 'rncs'];
const PERFIS_SYNC = ['master', 'admin', 'sync'];
// contas que nunca podem ser rebaixadas ou apagadas pela sincronização
const DOCS_PROTEGIDOS = { 'master-000000': 1, 'sync-999999': 1 };
const PERFIS_TRANCADOS = ['master', 'sync'];

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

function lerToken(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const payload = token.slice(0, i);
  const assinatura = token.slice(i + 1);
  const esperado = hmac(payload);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!dados.exp || dados.exp < Date.now()) return null;
    return dados;
  } catch (e) {
    return null;
  }
}

function sessaoDe(req) {
  const h = req.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim() || h['x-galvabras-token'] || '';
  return lerToken(token);
}

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + h;
}

function ehHash(v) {
  const s = String(v || '');
  return s.indexOf('scrypt$') === 0 || s.indexOf('sha256:') === 0;
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

function publicoUser(id, u) {
  return {
    id,
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
    aprovadoEm: iso(u.aprovadoEm) || null,
    updatedAt: iso(u.updatedAt) || null,
  };
}

async function lerColecao(nome) {
  const snap = await db.collection(nome).get();
  return snap.docs.map(d => (nome === 'users' ? publicoUser(d.id, d.data()) : { id: d.id, ...d.data() }));
}

async function gravarUsers(lista) {
  if (!Array.isArray(lista) || !lista.length) return 0;
  let salvos = 0;

  for (const bruto of lista) {
    if (!bruto || typeof bruto !== 'object') continue;
    const rg = texto(bruto.rg);
    const id = texto(bruto.id);

    let docId = null;
    let atual = null;

    // 1) procura por RG para nunca duplicar a mesma pessoa
    if (rg) {
      const dup = await db.collection('users').where('rg', '==', rg).limit(1).get();
      if (!dup.empty) docId = dup.docs[0].id;
    }

    // 2) senão usa o id enviado pelo cliente
    if (!docId && id) docId = id;

    // 3) senão cria um documento novo
    if (!docId) {
      const ref = await db.collection('users').add({});
      docId = ref.id;
    }

    // SEMPRE carrega o que já existe antes de gravar (evita apagar dados)
    const snap = await db.collection('users').doc(docId).get();
    if (snap.exists) atual = snap.data() || {};

    // não grava nada identificável: exige RG ou um documento já existente
    if (!rg && !atual) continue;
    if (!texto(bruto.nome) && !atual) continue;

    const agora = new Date().toISOString();
    const perfilBruto = ['master', 'admin', 'sync', 'funcionario'].includes(bruto.perfil) ? bruto.perfil : null;
    const statusBruto = ['approved', 'pending', 'pendente', 'blocked'].includes(bruto.status)
      ? (bruto.status === 'pendente' ? 'pending' : bruto.status)
      : null;

    let perfilFinal = perfilBruto || (atual && atual.perfil) || 'funcionario';
    let statusFinal = statusBruto || (atual && atual.status) || 'approved';

    // nunca rebaixa uma conta master/sync nem uma conta protegida
    const perfilAtual = (atual && atual.perfil) || '';
    if (PERFIS_TRANCADOS.includes(perfilAtual) && perfilFinal !== perfilAtual) perfilFinal = perfilAtual;
    if (DOCS_PROTEGIDOS[docId]) {
      perfilFinal = (atual && atual.perfil) || (docId.indexOf('sync') === 0 ? 'sync' : 'master');
      statusFinal = 'approved';
      if (atual && atual.rg) { /* identidade preservada pelos fallbacks abaixo */ }
    }

    const dados = {
      nome: texto(bruto.nome) || (atual && atual.nome) || '',
      sobrenome: texto(bruto.sobrenome) || (atual && atual.sobrenome) || '',
      rg: rg || (atual && atual.rg) || '',
      email: texto(bruto.email).toLowerCase() || (atual && atual.email) || '',
      cargo: texto(bruto.cargo) || (atual && atual.cargo) || '',
      setor: texto(bruto.setor) || (atual && atual.setor) || '',
      perfil: perfilFinal,
      status: statusFinal,
      firstLogin: bruto.firstLogin === undefined ? (atual && atual.firstLogin) || false : !!bruto.firstLogin,
      updatedAt: agora,
    };

    // nunca apaga identidade que já existe
    if (!dados.rg && atual && atual.rg) dados.rg = atual.rg;
    if (!dados.nome && atual && atual.nome) dados.nome = atual.nome;
    if (!dados.email && atual && atual.email) dados.email = atual.email;

    await db.collection('users').doc(docId).set(
      { ...dados, createdAt: (atual && atual.createdAt) || agora },
      { merge: true }
    );

    const senhaNova = texto(bruto.senha);
    if (senhaNova) {
      await db.collection('users').doc(docId).set(
        ehHash(senhaNova) ? { senha: senhaNova } : { senha: hashSenha(senhaNova) },
        { merge: true }
      );
    }

    // o usuário voltou a existir: limpa a marcação de exclusão
    await db.collection('syncTombstones').doc(docId).delete().catch(() => {});

    salvos += 1;
  }

  return salvos;
}

async function removerUsers(lista) {
  if (!Array.isArray(lista) || !lista.length) return 0;
  let removidos = 0;

  for (const bruto of lista) {
    const obj = typeof bruto === 'string' ? { id: bruto } : (bruto || {});
    const rg = texto(obj.rg);
    const id = texto(obj.id);
    if (!rg && !id) continue;

    let docId = id || null;
    if (rg) {
      const dup = await db.collection('users').where('rg', '==', rg).limit(1).get();
      if (!dup.empty) docId = dup.docs[0].id;
    }
    if (!docId) continue;
    if (DOCS_PROTEGIDOS[docId]) continue;

    const ref = db.collection('users').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const dados = snap.data() || {};
    if (dados.perfil === 'master' || dados.perfil === 'sync') continue;

    await ref.delete();
    await db.collection('syncTombstones').doc(docId).set({
      id: docId,
      rg: rg || texto(dados.rg),
      nome: texto(dados.nome),
      removidoEm: new Date().toISOString(),
    });
    removidos += 1;
  }

  return removidos;
}

async function gravarColecao(nome, lista) {
  if (!Array.isArray(lista) || !lista.length) return 0;
  let salvos = 0;
  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const id = texto(item.id);
    const resto = { ...item };
    delete resto.id;
    const alvo = id ? db.collection(nome).doc(id) : await db.collection(nome).add({});
    await alvo.set(resto, { merge: true });
    salvos += 1;
  }
  return salvos;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Galvabras-CSRF, X-Galvabras-Token');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!db) {
    res.status(500).json({ error: 'Firebase não configurado. Adicione as variáveis de ambiente na Vercel.' });
    return;
  }

  try {
    const sessao = sessaoDe(req);
    if (!sessao) {
      res.status(401).json({ error: 'Sessão inválida ou expirada.', erro: 'Sessão inválida ou expirada.' });
      return;
    }
    if (!PERFIS_SYNC.includes(sessao.perfil)) {
      res.status(403).json({ error: 'Sem permissão para sincronizar.', erro: 'Sem permissão para sincronizar.' });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const [users, userPermissions, sacs, rncs, tomb] = await Promise.all([
        ...COLECOES.map(lerColecao),
        db.collection('syncTombstones').get(),
      ]);
      res.status(200).json({
        ok: true,
        users,
        userPermissions,
        sacs,
        rncs,
        removidos: tomb.docs.map(d => d.data()),
        atualizadoEm: Date.now(),
      });
      return;
    }

    if (req.method === 'PATCH' || req.method === 'POST') {
      const body = req.body || {};
      const total = {};

      if (Array.isArray(body.users)) total.users = await gravarUsers(body.users);
      for (const nome of ['userPermissions', 'sacs', 'rncs']) {
        if (Array.isArray(body[nome])) total[nome] = await gravarColecao(nome, body[nome]);
      }
      if (Array.isArray(body.removerUsers)) total.removidos = await removerUsers(body.removerUsers);

      res.status(200).json({ ok: true, enviados: total });
      return;
    }

    res.status(405).json({ error: 'método não permitido' });
  } catch (e) {
    res.status(500).json({ error: e.message, erro: e.message });
  }
}
