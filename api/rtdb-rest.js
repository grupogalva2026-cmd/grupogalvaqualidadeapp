/* ===========================================================================
   ACESSO AO RTDB VIA REST API (Firebase)
   ----------------------------------------------------------------------------
   O Firebase Admin SDK para RTDB usa WebSocket/long-polling, que nao
   funciona no ambiente serverless da Vercel (timeout nas leituras).
   Este modulo usa a REST API do Firebase (HTTP simples) com um access
   token obtido via Firebase Admin SDK (credencial de servico), que
   bypassa as regras de seguranca do RTDB.

   Funcoes:
     rtdbGet(caminho)      -> Promise<any>
     rtdbSet(caminho, v)   -> Promise<void>
     rtdbPatch(caminho, v) -> Promise<void>
   =========================================================================== */

import { initializeApp, getApps, cert } from 'firebase-admin/app';

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

const RTDB_URL = 'https://galvabras-gestao-default-rtdb.firebaseio.com';

let _app = null;
let _accessToken = null;
let _tokenExpira = 0;

async function obterAccessToken() {
  if (_accessToken && Date.now() < _tokenExpira - 60000) return _accessToken;

  if (!_app) {
    if (!getApps().length && process.env.FIREBASE_PROJECT_ID) {
      _app = initializeApp({ credential: cert(firebaseConfig) });
    } else {
      _app = getApps()[0];
    }
  }

  const tokenObj = await _app.credential().getAccessToken();
  _accessToken = tokenObj.access_token;
  /* O Admin SDK nao retorna expiracao; assume 1 hora e renova aos 50 min. */
  _tokenExpira = Date.now() + 50 * 60 * 1000;
  return _accessToken;
}

async function rtdbFetch(caminho, metodo, corpo) {
  const token = await obterAccessToken();
  const url = RTDB_URL + '/' + caminho.replace(/^\//, '') + '.json';
  const opts = {
    method: metodo,
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
