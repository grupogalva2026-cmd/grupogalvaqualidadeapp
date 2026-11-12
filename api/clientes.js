import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';
import crypto from 'crypto';

/* ===========================================================================
   CADASTRO DE CLIENTES — /api/clientes  (tela clientes.html)
   ----------------------------------------------------------------------------
   Acesso da equipe Galva (mesmo usuário/senha do aplicativo) para criar e
   gerenciar os clientes que entram na Área do Cliente.

   Ações:
     POST {acao:'login', login, senha}  -> token (usuário do app, perfil adm)
     GET                               -> lista de clientes (token)
     POST {acao:'salvar', cliente}     -> cria/atualiza cliente (token)

   Grava em galvabras/data/clientes (RTDB) — a base compartilhada: o login
   da Área do Cliente (api/login-cliente.js) e o app interno leem daí.
   Tokens: mesmo esquema HMAC/SESSION_SECRET do /api/auth (api/auth.js).
   ========================================================================== */

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!getApps().length && process.env.FIREBASE_PROJECT_ID) {
  initializeApp({ credential: cert(firebaseConfig) });
}

const db = getApps().length ? getFirestore() : null;

const RTDB_URL = 'https://galvabras-gestao-default-rtdb.firebaseio.com';
const CAMINHO_CLIENTES = 'galvabras/data/clientes';
const CAMINHO_USERS = 'galvabras/data/users';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PERFIS_ADM = ['master', 'admin', 'gestor_ti'];

/* ---------------- token HMAC (espelho de api/auth.js) ---------------- */

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

export function emitirToken(dados) {
  const payload = b64u(JSON.stringify({ ...dados, exp: Date.now() + SESSION_TTL_MS }));
  return payload + '.' + hmac(payload);
}

export function lerToken(token) {
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

/* ---------------- senhas (formatos do app) ---------------- */

function sha256hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function senhaConfere(senha, guardada) {
  if (!guardada) return false;
  const s = String(guardada);
  if (s.indexOf('scrypt$') === 0) {
    const p = s.split('$');
    if (p.length !== 3) return false;
    const h = crypto.scryptSync(String(senha), p[1], 64);
    const esperado = Buffer.from(p[2], 'hex');
    return h.length === esperado.length && crypto.timingSafeEqual(h, esperado);
  }
  if (s.indexOf('sha256:') === 0) {
    const a = Buffer.from(sha256hex(senha));
    const b = Buffer.from(s.slice(7));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const a = Buffer.from(s);
  const b = Buffer.from(String(senha));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------------- utilidades ---------------- */

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const texto = (v) => (v === undefined || v === null ? '' : String(v).trim());
const agoraBR = () => new Date().toLocaleString('pt-BR');

export function cnpjValido(str) {
  const c = soDigitos(str);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (base) => {
    let peso = base.length - 7, soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += parseInt(base[i], 10) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(c.slice(0, 12)) === parseInt(c[12], 10) &&
         calc(c.slice(0, 13)) === parseInt(c[13], 10);
}

export const senhaPadraoDe = (cnpj) => soDigitos(cnpj).slice(0, 5);

let _rtdb = null;
function rtdb() {
  if (_rtdb) return _rtdb;
  if (!process.env.FIREBASE_PROJECT_ID) return null;
  try {
    const existente = getApps().find((a) => a.options && a.options.databaseURL);
    const app = existente
      || initializeApp({ credential: cert(firebaseConfig), databaseURL: RTDB_URL }, 'rtdb');
    _rtdb = getDatabase(app);
  } catch (e) {
    console.error('[clientes] RTDB indisponível:', e.message);
    _rtdb = null;
  }
  return _rtdb;
}

export function normalizarLista(bruto) {
  if (Array.isArray(bruto)) return bruto.filter((x) => x && typeof x === 'object');
  if (bruto && typeof bruto === 'object') {
    return Object.values(bruto).filter((x) => x && typeof x === 'object');
  }
  return [];
}

async function lerLista(caminho) {
  const r = rtdb();
  if (!r) throw new Error('RTDB indisponível');
  const snap = await r.ref(caminho).once('value');
  return normalizarLista(snap.val());
}

/* Versão "pública" do cliente (SEM o hash da senha). */
export function publicoCliente(c) {
  return {
    id: texto(c.id),
    cnpj: soDigitos(c.cnpj),
    razaoSocial: texto(c.razaoSocial),
    filial: c.filial === 'PR' ? 'PR' : 'SP',
    ativo: c.ativo !== false,
    senhaPadrao: c.senhaPadrao !== false,
    criadoEm: texto(c.criadoEm),
  };
}

/* ---------------- login do administrador (usuário do app) ------------- */

async function acharUsuario(login, senha) {
  const alvo = texto(login);
  const alvoLower = alvo.toLowerCase();

  /* 1) Base do app sincronizada no Firestore (mesma do /api/auth). */
  if (db) {
    let snap = await db.collection('users').where('rg', '==', alvo).limit(1).get();
    if (snap.empty) {
      snap = await db.collection('users').where('email', '==', alvoLower).limit(1).get();
    }
    if (!snap.empty) {
      const u = { id: snap.docs[0].id, ...snap.docs[0].data() };
      return senhaConfere(senha, u.senha || u.password) ? u : { recusado: true };
    }
  }

  /* 2) Base antiga no RTDB (galvabras/data/users) — cobre contas que
        ainda não foram sincronizadas para o Firestore. */
  const lista = await lerLista(CAMINHO_USERS).catch(() => []);
  const u = lista.find((x) => {
    const campos = [x.email, x.rg, x.login, x.usuario, x.matricula];
    return campos.some((v) => v && String(v).toLowerCase() === alvoLower) ||
      (x.id != null && String(x.id) === alvo);
  });
  if (u) {
    return senhaConfere(senha, u.senha || u.password || u.senhaHash) ? u : { recusado: true };
  }
  return null;
}

async function opLogin(req, res) {
  const body = req.body || {};
  const login = texto(body.email || body.login || body.rg);
  const senha = String(body.senha == null ? '' : body.senha);

  if (!login || !senha) {
    res.status(400).json({ erro: 'Informe usuário e senha.' });
    return;
  }

  const u = await acharUsuario(login, senha);
  if (!u || u.recusado) {
    res.status(401).json({ erro: 'Usuário ou senha incorretos.' });
    return;
  }

  const perfil = texto(u.perfil) || 'funcionario';
  if (!PERFIS_ADM.includes(perfil)) {
    res.status(403).json({ erro: 'Acesso restrito ao administrador (master/admin).' });
    return;
  }

  const token = emitirToken({ uid: texto(u.id) || alvoId(u), rg: texto(u.rg), perfil });
  res.status(200).json({
    ok: true,
    token,
    expiraEm: Date.now() + SESSION_TTL_MS,
    usuario: {
      nome: texto(u.nome) || texto(u.email) || login,
      perfil,
      rg: texto(u.rg),
    },
  });
}

function alvoId(u) {
  return texto(u.id) || texto(u.rg) || texto(u.email) || 'adm';
}

/* ---------------- lista ---------------- */

async function opListar(req, res) {
  const lista = await lerLista(CAMINHO_CLIENTES);
  const clientes = lista.map(publicoCliente).sort((a, b) =>
    String(a.razaoSocial || '').localeCompare(String(b.razaoSocial || ''), 'pt-BR'));
  res.status(200).json({ ok: true, clientes, atualizadoEm: Date.now() });
}

/* ---------------- salvar (criar / editar / inativar / senha padrão) --- */

async function upsertCliente(cnpj, id, montar) {
  const r = rtdb();
  if (!r) throw new Error('RTDB indisponível');
  let resultado = null;
  await r.ref(CAMINHO_CLIENTES).transaction((atual) => {
    if (atual != null && typeof atual !== 'object') return; /* não destrói dado inesperado */
    const lista = normalizarLista(atual);
    const iId = id ? lista.findIndex((x) => texto(x.id) === id) : -1;
    const iCnpj = lista.findIndex((x) => soDigitos(x && x.cnpj) === cnpj && texto(x.id) !== id);
    if (iCnpj >= 0) { resultado = { dup: true }; return; } /* CNPJ já usado: aborta */
    if (iId >= 0) {
      const atualizado = { ...lista[iId], ...montar(lista[iId]) };
      lista[iId] = atualizado;
      resultado = { cliente: { ...atualizado }, novo: false };
      return lista;
    }
    const novo = { id: Date.now(), ...montar(null) };
    lista.push(novo);
    resultado = { cliente: { ...novo }, novo: true };
    return lista;
  });
  if (!resultado) throw new Error('Falha ao gravar o cliente');
  return resultado;
}

async function opSalvar(req, res) {
  const b = (req.body || {}).cliente || {};
  const cnpj = soDigitos(b.cnpj);
  const nome = texto(b.razaoSocial);
  const filial = b.filial === 'PR' ? 'PR' : 'SP';
  const id = texto(b.id);
  const senha = texto(b.senha);
  const aplicarPadrao = b.aplicarPadrao === true;

  if (cnpj.length !== 14 || !cnpjValido(cnpj)) {
    res.status(400).json({ erro: 'CNPJ inválido. Confira os números digitados.' });
    return;
  }
  if (!nome) {
    res.status(400).json({ erro: 'Informe o nome (razão social) do cliente.' });
    return;
  }

  const padrao = senhaPadraoDe(cnpj);
  const ativo = b.ativo !== false;

  const r = await upsertCliente(cnpj, id, (existente) => {
    const patch = {
      cnpj,
      razaoSocial: nome,
      filial,
      ativo,
      atualizadoEm: agoraBR(),
    };
    if (senha) {
      patch.senhaHash = 'sha256:' + sha256hex(senha);
      patch.senhaPadrao = false;
    } else if (aplicarPadrao || !existente) {
      /* novo cliente sem senha => senha padrão (5 primeiros dígitos) */
      patch.senhaHash = 'sha256:' + sha256hex(padrao);
      patch.senhaPadrao = true;
    }
    if (!existente) patch.criadoEm = agoraBR();
    return patch;
  });

  if (r.dup) {
    res.status(409).json({ erro: 'Já existe um cliente com este CNPJ.' });
    return;
  }

  const senhaEfetiva = senha || (aplicarPadrao || !id ? padrao : null);
  res.status(200).json({
    ok: true,
    cliente: publicoCliente(r.cliente),
    novo: r.novo,
    senhaEfetiva,
  });
}

/* ---------------- handler ---------------- */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Galvabras-CSRF, X-Galvabras-Token');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    if (req.method === 'POST' && texto((req.body || {}).acao) === 'login') {
      await opLogin(req, res);
      return;
    }

    const sessao = sessaoDe(req);
    if (!sessao) {
      res.status(401).json({ erro: 'Sessão inválida ou expirada.' });
      return;
    }
    if (!PERFIS_ADM.includes(texto(sessao.perfil))) {
      res.status(403).json({ erro: 'Acesso restrito ao administrador (master/admin).' });
      return;
    }
    if (!rtdb()) {
      res.status(500).json({ erro: 'Firebase não configurado.' });
      return;
    }

    if (req.method === 'GET') {
      await opListar(req, res);
      return;
    }
    if (req.method === 'POST' && texto((req.body || {}).acao) === 'salvar') {
      await opSalvar(req, res);
      return;
    }
    res.status(400).json({ erro: 'Ação inválida.' });
  } catch (e) {
    console.error('[clientes]', e);
    res.status(500).json({ erro: e.message || 'Erro interno.' });
  }
}
