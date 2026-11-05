import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const CONTA = process.argv[2] ||
  'C:\\Users\\jeffe\\Downloads\\qualidadegrupogalva-firebase-adminsdk-fbsvc-82c852a073.json';

const RG = process.argv[3] || '000000';
const SENHA = process.argv[4] || 'admin123';
const NOME = process.argv[5] || 'Administrador';
const SOBRENOME = process.argv[6] || 'Sistema';
const EMAIL = process.argv[7] || 'admin@grupogalva.com.br';
const PERFIL = process.argv[8] || 'master';
const CARGO = process.argv[9] || (PERFIL === 'sync' ? 'Sincronismo' : 'Administrador');

const key = JSON.parse(fs.readFileSync(CONTA, 'utf8'));
const PROJETO = key.project_id;

function b64u(v) {
  return Buffer.from(v).toString('base64url');
}

function assinarRSA256(dados) {
  return crypto.createSign('RSA-SHA256').update(dados).sign(key.private_key)
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function accessToken() {
  const agora = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64u(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: agora,
    exp: agora + 3600,
  }));
  const jwt = header + '.' + claims + '.' + assinarRSA256(header + '.' + claims);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error('OAuth falhou: ' + res.status + ' ' + await res.text());
  const j = await res.json();
  return j.access_token;
}

function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(senha), salt, 64).toString('hex');
  return 'scrypt$' + salt + '$' + h;
}

const S = v => ({ stringValue: String(v ?? '') });
const B = v => ({ booleanValue: !!v });
const T = v => ({ timestampValue: v });

async function main() {
  const token = await accessToken();
  const base = `https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/(default)/documents`;
  const docId = (PERFIL === 'master' ? 'master-' : PERFIL + '-') + RG;
  const agora = new Date().toISOString();

  const doc = {
    fields: {
      nome: S(NOME),
      sobrenome: S(SOBRENOME),
      rg: S(RG),
      email: S(EMAIL),
      cargo: S(CARGO),
      setor: S('Tecnologia'),
      perfil: S(PERFIL),
      status: S('approved'),
      senha: S(hashSenha(SENHA)),
      firstLogin: B(false),
      createdAt: T(agora),
      updatedAt: T(agora),
    },
  };

  const res = await fetch(`${base}/users/${docId}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(doc),
  });

  const texto = await res.text();
  if (!res.ok) throw new Error('Firestore ' + res.status + ': ' + texto);

  console.log('[seed] usuario criado/atualizado:', docId);
  console.log('[seed] RG:', RG, '| senha:', SENHA, '| perfil:', PERFIL);
  console.log('[seed] projeto:', PROJETO);
}

main().catch(e => {
  console.error('[seed] ERRO:', e.message);
  process.exit(1);
});
