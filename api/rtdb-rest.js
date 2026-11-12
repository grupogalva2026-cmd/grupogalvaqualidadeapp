/* ===========================================================================
   ACESSO AO RTDB VIA REST API (Firebase)
   ----------------------------------------------------------------------------
   O Firebase Admin SDK para RTDB usa WebSocket/long-polling, que nao
   funciona no ambiente serverless da Vercel (timeout nas leituras).
   Este modulo usa a REST API do Firebase (HTTP simples) com um access
   token OAuth2 obtido via JWT da conta de servico.

   Funcoes:
     rtdbGet(caminho)      -> Promise<any>   (ex.: 'galvabras/data/clientes')
     rtdbSet(caminho, v)   -> Promise<void>
     rtdbPatch(caminho, v) -> Promise<void>  (merge parcial)
   =========================================================================== */

import crypto from 'crypto';

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

const RTDB_URL = 'https://galvabras-gestao-default-rtdb.firebaseio.com';
const SCOPE = 'https://www.googleapis.com/auth/firebase.database';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let _accessToken = null;
let _tokenExpira = 0;

function b64u(v) {
  return Buffer.from(v).toString('base64url');
}

async function obterAccessToken() {
  if (_accessToken && Date.now() < _tokenExpira - 60000) return _accessToken;

  const agora = Math.floor(Date.now() / 1000);
  const payload = {
    iss: firebaseConfig.clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: agora + 3600,
    iat: agora,
  };
  const header = { alg: 'RS256', typ: 'JWT' };
  const segmento = (o) => b64u(JSON.stringify(o));
  const assinaturaInput = segmento(header) + '.' + segmento(payload);

  /* Assina com RSA-SHA256 usando a chave privada da conta de servico. */
  const assinatura = crypto.sign('RSA-SHA256', Buffer.from(assinaturaInput, 'utf8'), firebaseConfig.privateKey);
  const jwt = assinaturaInput + '.' + b64u(assinatura);

  const corpo = new URLSearchParams();
  corpo.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  corpo.append('assertion', jwt);

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo.toString(),
  });
  if (!resp.ok) throw new Error('Falha ao obter access token OAuth2: HTTP ' + resp.status);
  const d = await resp.json();
  if (!d.access_token) throw new Error('OAuth2 sem access_token: ' + JSON.stringify(d));
  _accessToken = d.access_token;
  _tokenExpira = agora + (d.expires_in || 3600);
  return _accessToken;
}

async function rtdbFetch(caminho, metodo, corpo) {
  const token = await obterAccessToken();
  const url = RTDB_URL + '/' + caminho.replace(/^\//, '') + '.json';
  const opts = {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
  };
  if (corpo !== undefined) opts.body = JSON.stringify(corpo);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error('RTDB REST ' + metodo + ' ' + caminho + ': HTTP ' + resp.status + ' ' + texto);
  }
  const texto = await resp.text();
  if (!texto) return null;
  return JSON.parse(texto);
}

export async function rtdbGet(caminho) {
  return rtdbFetch(caminho, 'GET');
}

export async function rtdbSet(caminho, valor) {
  await rtdbFetch(caminho, 'PUT', valor);
}

export async function rtdbPatch(caminho, valor) {
  await rtdbFetch(caminho, 'PATCH', valor);
}

/* Converte o resultado do RTDB (null | array | objeto) numa lista limpa. */
export function rtdbLista(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === 'object');
  if (typeof v === 'object') return Object.values(v).filter((x) => x && typeof x === 'object');
  return [];
}

/* Upsert em uma lista do RTDB:
   - Le a lista atual;
   - Aplica fn(lista) que pode retornar null (aborta) ou a nova lista;
   - Grava de volta com PUT (nao e transacao distribuida, mas funciona no serverless). */
export async function rtdbUpsertLista(caminho, fn) {
  const atual = await rtdbGet(caminho);
  const lista = rtdbLista(atual);
  const nova = fn(lista);
  if (nova === null) return null; /* aborta sem gravar */
  await rtdbSet(caminho, nova);
  return nova;
}

/* Busca um item na lista por um predicado e, se nao existir, cria. */
export async function rtdbEncontrarOuCriar(caminho, pred, fabrica) {
  return rtdbUpsertLista(caminho, (lista) => {
    const i = lista.findIndex(pred);
    if (i >= 0) return null; /* ja existe: nao grava */
    const novo = fabrica();
    return [...lista, novo];
  });
}

/* Atualiza um item da lista por indice (encontrado por pred). */
export async function rtdbAtualizarItem(caminho, pred, patch) {
  return rtdbUpsertLista(caminho, (lista) => {
    const i = lista.findIndex(pred);
    if (i < 0) return null;
    const nova = lista.slice();
    nova[i] = { ...nova[i], ...patch };
    return nova;
  });
}

/* Verifica se o caminho e legível (leitura rapida). */
export async function rtdbPing(caminho) {
  try {
    await rtdbGet(caminho);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}
