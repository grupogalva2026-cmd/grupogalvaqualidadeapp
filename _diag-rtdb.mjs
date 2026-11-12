/* Diagnóstico: qual leitura do GET /api/rnc?cnpj= trava? (temporário) */
import fs from 'fs';

const raw = fs.readFileSync('.env.local', 'utf8');
/* Valores entre aspas podem ocupar várias linhas (chave PEM). */
for (const m of raw.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)="([\s\S]*?)"\s*$/gm)) {
  if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
for (const m of raw.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=([^"\n][^\n]*)$/gm)) {
  if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

console.log('linhas do .env.local:', raw.split('\n').length);
const iKey = raw.indexOf('FIREBASE_PRIVATE_KEY');
const seg = iKey >= 0 ? raw.slice(iKey, iKey + 80).replace(/[A-Za-z0-9+/=]{40,}/g, '<b64-longo>') : '(nao achou)';
console.log('estrutura proxima a chave:', JSON.stringify(seg));
const vKey = process.env.FIREBASE_PRIVATE_KEY || '';
console.log('chave: len=' + vKey.length + ' begin=' + vKey.includes('-----BEGIN') + ' end=' + vKey.includes('-----END') + ' comEnter=' + vKey.includes('\n') + ' comBarraN=' + vKey.includes('\\n'));

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
const { getDatabase } = await import('firebase-admin/database');

const cfg = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
};
console.log('projeto:', cfg.projectId, '| chave inicia com:', String(cfg.privateKey).split('\n')[0]);

initializeApp({ credential: cert(cfg) });
const db = getFirestore();
const appR = initializeApp({ credential: cert(cfg), databaseURL: 'https://galvabras-gestao-default-rtdb.firebaseio.com' }, 'rtdb');
const r = getDatabase(appR);

async function medir(nome, fn, ms = 15000) {
  const t0 = Date.now();
  try {
    const v = await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + ms + 'ms')), ms)),
    ]);
    console.log('OK     ' + nome + ' em ' + (Date.now() - t0) + 'ms -> ' + v);
  } catch (e) {
    console.log('FALHA  ' + nome + ' em ' + (Date.now() - t0) + 'ms -> ' + e.message);
  }
}

await medir('REST firebaseio (regras fechadas -> 401 esperado)', async () => {
  const resp = await fetch('https://galvabras-gestao-default-rtdb.firebaseio.com/galvabras/data/clientes.json');
  return 'HTTP ' + resp.status;
});

await medir('RTDB once galvabras/data/clientes', async () => {
  const snap = await r.ref('galvabras/data/clientes').once('value');
  const v = snap.val();
  return Array.isArray(v) ? 'array[' + v.length + ']' : (v && typeof v === 'object' ? 'objeto[' + Object.keys(v).length + ']' : String(v));
});

await medir('RTDB once galvabras/data/openIssues', async () => {
  const snap = await r.ref('galvabras/data/openIssues').once('value');
  const v = snap.val();
  return Array.isArray(v) ? 'array[' + v.length + ']' : (v && typeof v === 'object' ? 'objeto[' + Object.keys(v).length + ']' : String(v));
});

await medir('Firestore rnc where cnpj==digitos', async () => {
  const snap = await db.collection('rnc').where('cnpj', '==', '11222333000181').limit(50).get();
  return snap.size + ' docs';
});

await medir('Firestore rnc where cnpj==mascara', async () => {
  const snap = await db.collection('rnc').where('cnpj', '==', '11.222.333/0001-81').limit(50).get();
  return snap.size + ' docs';
});

process.exit(0);
