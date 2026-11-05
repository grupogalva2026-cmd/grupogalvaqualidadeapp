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
    const esperado = s.slice(7);
    const a = Buffer.from(h);
    const b = Buffer.from(esperado);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return crypto.timingSafeEqual(Buffer.from(s), Buffer.from(String(senha)));
}

function iso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v._seconds === 'number') return new Date(v._seconds * 1000).toISOString();
  if (v instanceof Date) return v.toISOString();
  return null;
}

function publico(u) {
  if (!u) return null;
  return {
    id: u.id,
    nome: u.nome || '',
    sobrenome: u.sobrenome || '',
    rg: u.rg || '',
    email: u.email || '',
    cargo: u.cargo || '',
    setor: u.setor || '',
    perfil: u.perfil || 'funcionario',
    status: u.status || 'approved',
    ultimoAcesso: iso(u.ultimoAcesso),
    criadoEm: iso(u.createdAt),
  };
}

function texto(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Galvabras-CSRF, X-Galvabras-Token');

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
        return opLogin(req, res);

      case 'session':
        return opSession(req, res);

      case 'logout':
        res.status(200).json({ ok: true });
        return;

      case 'func-listar':
      case 'list-funcionarios':
      case 'sync':
        return opListar(req, res);

      case 'func-salvar':
        return opSalvar(req, res);

      case 'func-excluir':
        return opExcluir(req, res);

      case 'relatorios':
        return opRelatorios(req, res);

      case 'trocar-senha':
        return opTrocarSenha(req, res);

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
        return;
      }

      default:
        res.status(400).json({ error: 'op inválida' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function opLogin(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  const body = req.body || {};
  const identificador = texto(body.rg || body.email || body.login);
  const senha = body.senha;

  if (!identificador || !senha) {
    res.status(400).json({ error: 'Informe código de acesso e senha.' });
    return;
  }

  const alvo = identificador.toLowerCase();
  let snap = await db.collection('users').where('rg', '==', identificador).limit(1).get();
  if (snap.empty) {
    snap = await db.collection('users').where('email', '==', alvo).limit(1).get();
  }
  if (snap.empty) {
    res.status(401).json({ error: 'Código de acesso ou senha incorretos.' });
    return;
  }

  const doc = snap.docs[0];
  const u = { id: doc.id, ...doc.data() };

  if (u.status && u.status !== 'approved') {
    res.status(403).json({ error: 'Acesso bloqueado. Procure o administrador.' });
    return;
  }

  if (!senhaConfere(senha, u.senha || u.password)) {
    res.status(401).json({ error: 'Código de acesso ou senha incorretos.' });
    return;
  }

  db.collection('users').doc(doc.id).set(
    { ultimoAcesso: new Date().toISOString() },
    { merge: true }
  ).catch(() => {});

  const token = emitirToken({ uid: doc.id, rg: u.rg || '', perfil: u.perfil || 'funcionario' });
  res.status(200).json({ token, usuario: publico(u) });
}

function opSession(req, res) {
  const sessao = sessaoDe(req);
  if (!sessao) {
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    return;
  }
  res.status(200).json({
    usuario: {
      id: sessao.uid,
      rg: sessao.rg || '',
      perfil: sessao.perfil || 'funcionario',
    },
  });
}

async function exigirMaster(req, res) {
  const sessao = sessaoDe(req);
  if (!sessao) {
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    return null;
  }
  if (!['master', 'admin'].includes(sessao.perfil)) {
    res.status(403).json({ error: 'Apenas o administrador pode gerenciar funcionários.' });
    return null;
  }
  return sessao;
}

async function exigirSessao(req, res) {
  const sessao = sessaoDe(req);
  if (!sessao) {
    res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    return null;
  }
  return sessao;
}

async function opListar(req, res) {
  const sessao = await exigirSessao(req, res);
  if (!sessao) return;

  const snap = await db.collection('users').get();
  const funcionarios = snap.docs
    .map(d => publico({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));

  res.status(200).json({ funcionarios, atualizadoEm: Date.now() });
}

async function opSalvar(req, res) {
  const sessao = await exigirMaster(req, res);
  if (!sessao) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const b = req.body || {};
  const nome = texto(b.nome);
  const rg = texto(b.rg);

  if (!nome || !rg) {
    res.status(400).json({ error: 'Nome e RG são obrigatórios.' });
    return;
  }

  const agora = new Date().toISOString();
  const dados = {
    nome,
    sobrenome: texto(b.sobrenome),
    rg,
    email: texto(b.email).toLowerCase(),
    cargo: texto(b.cargo),
    setor: texto(b.setor),
    status: b.status === 'pending' ? 'pending' : 'approved',
    perfil: ['master', 'admin'].includes(b.perfil) ? b.perfil : 'funcionario',
    updatedAt: agora,
  };

  const id = texto(b.id);
  let docId = id;

  if (!docId) {
    const dup = await db.collection('users').where('rg', '==', rg).limit(1).get();
    if (!dup.empty) {
      res.status(409).json({ error: 'Já existe um funcionário com este RG.' });
      return;
    }
    const ref = await db.collection('users').add({ ...dados, createdAt: agora, firstLogin: true });
    docId = ref.id;
  } else {
    const atual = await db.collection('users').doc(docId).get();
    if (!atual.exists) {
      res.status(404).json({ error: 'Funcionário não encontrado.' });
      return;
    }
    const existente = atual.data() || {};
    if (existente.rg && existente.rg !== rg) {
      const dup = await db.collection('users').where('rg', '==', rg).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== docId) {
        res.status(409).json({ error: 'Já existe um funcionário com este RG.' });
        return;
      }
    }
    await db.collection('users').doc(docId).set(dados, { merge: true });
  }

  if (texto(b.senha)) {
    await db.collection('users').doc(docId).set(
      { senha: hashSenha(b.senha), firstLogin: true },
      { merge: true }
    );
  }

  const final = await db.collection('users').doc(docId).get();
  res.status(200).json({ ok: true, funcionario: publico({ id: docId, ...final.data() }) });
}

async function opExcluir(req, res) {
  const sessao = await exigirMaster(req, res);
  if (!sessao) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  const id = texto((req.body || {}).id);
  if (!id) {
    res.status(400).json({ error: 'Informe o funcionário.' });
    return;
  }
  if (id === sessao.uid) {
    res.status(400).json({ error: 'Você não pode excluir o próprio acesso.' });
    return;
  }

  const ref = db.collection('users').doc(id);
  const atual = await ref.get();
  if (!atual.exists) {
    res.status(404).json({ error: 'Funcionário não encontrado.' });
    return;
  }
  if ((atual.data() || {}).perfil === 'master') {
    res.status(400).json({ error: 'O administrador master não pode ser excluído.' });
    return;
  }
  await ref.delete();
  res.status(200).json({ ok: true });
}

async function opTrocarSenha(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }
  const b = req.body || {};
  const nova = texto(b.novaSenha);
  const confirmar = texto(b.confirmarSenha);

  if (nova.length < 6) {
    res.status(400).json({ error: 'A nova senha precisa ter no mínimo 6 caracteres.' });
    return;
  }
  if (nova !== confirmar) {
    res.status(400).json({ error: 'A confirmação não confere com a nova senha.' });
    return;
  }

  let docId = '';
  let atual = null;

  if (texto(b.rg)) {
    const snap = await db.collection('users').where('rg', '==', texto(b.rg)).limit(1).get();
    if (snap.empty) {
      res.status(401).json({ error: 'Dados de acesso inválidos.' });
      return;
    }
    docId = snap.docs[0].id;
    atual = snap.docs[0].data();
    if (!senhaConfere(texto(b.tokenTemporario), atual.senha || atual.password)) {
      res.status(401).json({ error: 'Senha temporária incorreta.' });
      return;
    }
  } else {
    const sessao = await exigirSessao(req, res);
    if (!sessao) return;
    docId = sessao.uid;
    const doc = await db.collection('users').doc(docId).get();
    if (!doc.exists) {
      res.status(401).json({ error: 'Sessão inválida.' });
      return;
    }
    atual = doc.data();
    if (!senhaConfere(texto(b.senhaAtual), atual.senha || atual.password)) {
      res.status(401).json({ error: 'Senha atual incorreta.' });
      return;
    }
  }

  await db.collection('users').doc(docId).set(
    { senha: hashSenha(nova), firstLogin: false, updatedAt: new Date().toISOString() },
    { merge: true }
  );

  res.status(200).json({ ok: true, message: 'Senha alterada com sucesso.' });
}

async function opRelatorios(req, res) {
  const sessao = await exigirSessao(req, res);
  if (!sessao) return;

  const snap = await db.collection('users').get();
  const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const porPerfil = {};
  const porStatus = {};
  let ultimo = null;
  let acessos30d = 0;
  const corte = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const detalhes = lista.map(u => {
    const perfil = u.perfil || 'funcionario';
    const status = u.status || 'approved';
    porPerfil[perfil] = (porPerfil[perfil] || 0) + 1;
    porStatus[status] = (porStatus[status] || 0) + 1;
    const acesso = iso(u.ultimoAcesso) || iso(u.updatedAt) || iso(u.createdAt) || null;
    if (acesso) {
      const t = Date.parse(acesso);
      if (!isNaN(t)) {
        if (!ultimo || t > Date.parse(ultimo)) ultimo = acesso;
        if (t >= corte) acessos30d++;
      }
    }
    return {
      id: u.id,
      nome: u.nome || '',
      sobrenome: u.sobrenome || '',
      rg: u.rg || '',
      email: u.email || '',
      cargo: u.cargo || '',
      setor: u.setor || '',
      perfil,
      status,
      primeiroLogin: !!u.firstLogin,
      ultimoAcesso: acesso,
      criadoEm: iso(u.createdAt),
    };
  });

  detalhes.sort((a, b) => String(b.ultimoAcesso || '').localeCompare(String(a.ultimoAcesso || '')));

  res.status(200).json({
    resumo: {
      total: lista.length,
      porPerfil,
      porStatus,
      ativos30d: acessos30d,
      ultimoAcessoGeral: ultimo,
      geradoEm: new Date().toISOString(),
    },
    usuarios: detalhes,
  });
}
