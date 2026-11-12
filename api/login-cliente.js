import { initializeApp, getApps, cert } from 'firebase-admin/app';
import crypto from 'crypto';
import { rtdbEncontrarOuCriar, rtdbAtualizarItem, rtdbLista, rtdbGet, rtdbSet } from './rtdb-rest.js';

/* ===========================================================================
   LOGIN DA ÁREA DO CLIENTE — POST /api/login-cliente
   ----------------------------------------------------------------------------
   Valida CNPJ + senha contra a base de clientes do Firebase em
   galvabras/data/clientes — a MESMA base que o app interno cadastra e
   sincroniza (cliente cadastrado no app loga aqui; cliente cadastrado
   aqui aparece para o app).

   Regras espelhadas de clienteLogin() (js/app.js):
     · senha guardada como 'sha256:' + sha256hex (sem sal);
     · senha padrão do sistema = 5 primeiros dígitos do CNPJ;
     · 1º acesso (CNPJ inédito) => o próprio banco CRIA o cliente;
     · senha errada, mas igual à padrão => restaura a senha padrão e entra;
     · cliente com ativo === false => acesso bloqueado.
   ========================================================================== */

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!getApps().length && process.env.FIREBASE_PROJECT_ID) {
  initializeApp({ credential: cert(firebaseConfig) });
}

const CAMINHO = 'galvabras/data/clientes';

/* ---------------- utilidades (exportadas p/ os testes) ---------------- */

export const soDigitos = (v) => String(v || '').replace(/\D/g, '');

/* Validação clássica dos dígitos verificadores do CNPJ */
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

/* Senha padrão do sistema: 5 primeiros dígitos do CNPJ (igual ao app). */
export const senhaPadraoDe = (cnpj) => soDigitos(cnpj).slice(0, 5);

export function sha256hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/* Confere a senha nos formatos gravados pelo app:
   'sha256:<hex>' | 'scrypt$<salt>$<hex>' | texto puro (legado). */
export function senhaConfere(senha, guardada) {
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

/* Normaliza a forma gravada no RTDB (array; ou mapa com buracos). */
export function normalizarClientes(bruto) {
  if (Array.isArray(bruto)) return bruto.filter((x) => x && typeof x === 'object');
  if (bruto && typeof bruto === 'object') {
    return Object.values(bruto).filter((x) => x && typeof x === 'object');
  }
  return [];
}

const agoraBR = () => new Date().toLocaleString('pt-BR');

/* Registro novo no MESMO formato que o app grava
   (rncSalvarCliente / clienteLogin em js/app.js). */
export function montarClienteNovo(cnpj, senha) {
  return {
    id: Date.now(),
    cnpj: soDigitos(cnpj),
    razaoSocial: '',
    filial: 'SP',
    ativo: true,
    criadoEm: agoraBR(),
    senhaHash: 'sha256:' + sha256hex(senha),
    senhaPadrao: senha === senhaPadraoDe(cnpj),
    origem: 'portal',
  };
}

/* ---------------- acesso à base (transação = sem duplicar) ------------- */

/* Encontra o cliente pelo CNPJ; se não existir, CRIA (primeiro acesso).
   Usa REST: lê a lista, verifica duplicata, grava de volta. Devolve o registro. */
async function encontrarOuCriar(cnpj, fabrica) {
  const pred = (x) => soDigitos(x && x.cnpj) === cnpj;
  const lista = rtdbLista(await rtdbGet(CAMINHO));
  const existente = lista.find(pred);
  if (existente) return { ...existente };
  const novo = fabrica();
  await rtdbSet(CAMINHO, [...lista, novo]);
  return { ...novo };
}

/* Atualiza campos do cliente existente (ex.: restaurar a senha padrão). */
async function atualizarCliente(cnpj, patch) {
  const pred = (x) => soDigitos(x && x.cnpj) === cnpj;
  const resultado = await rtdbAtualizarItem(CAMINHO, pred, patch);
  return resultado !== null;
}

/* ---------------- handler ---------------- */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ erro: 'método não permitido.' });
    return;
  }

  try {
    const body = req.body || {};
    const cnpj = soDigitos(body.cnpj);
    const senha = String(body.senha == null ? '' : body.senha);

    if (cnpj.length !== 14 || !cnpjValido(cnpj)) {
      res.status(400).json({ erro: 'CNPJ inválido. Confira os números digitados.' });
      return;
    }
    if (!senha) {
      res.status(400).json({ erro: 'Digite a senha da sua empresa.' });
      return;
    }

    /* 1º acesso: o próprio banco cria o cliente (igual ao app faz). */
    const cliente = await encontrarOuCriar(cnpj, () => montarClienteNovo(cnpj, senha));

    if (cliente.ativo === false) {
      res.status(403).json({ erro: 'Seu acesso está desativado, fale com a Galva.' });
      return;
    }

    if (!senhaConfere(senha, cliente.senhaHash)) {
      /* Senha padrão (5 primeiros dígitos) sempre restaura o acesso —
         mesmo comportamento do clienteLogin() do app. */
      if (senha !== senhaPadraoDe(cnpj)) {
        res.status(401).json({ erro: 'CNPJ ou senha incorretos. Verifique e tente novamente.' });
        return;
      }
      await atualizarCliente(cnpj, {
        senhaHash: 'sha256:' + sha256hex(senhaPadraoDe(cnpj)),
        senhaPadrao: true,
      }).catch((e) => console.error('[login-cliente] restaurar senha padrão:', e.message));
    }

    res.status(200).json({
      ok: true,
      cliente: {
        cnpj,
        razaoSocial: String(cliente.razaoSocial || '').trim(),
        filial: cliente.filial === 'PR' ? 'PR' : 'SP',
      },
    });
  } catch (e) {
    console.error('[login-cliente]', e);
    res.status(500).json({ erro: 'Não foi possível entrar. Tente novamente ou fale com a Galva.' });
  }
}
