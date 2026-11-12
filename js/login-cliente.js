/* =====================================================================
   LOGIN DA ÁREA DO CLIENTE (index.html)
   ---------------------------------------------------------------------
   - CNPJ com máscara 00.000.000/0000-00 e validação de dígitos verificadores.
   - O CNPJ é convertido em um e-mail interno invisível para o cliente:
        12345678000199  ->  12345678000199@cliente.grupogalva.com.br
   - Autenticação via Firebase Authentication (e-mail/senha).
   - Sessão do portal gravada em localStorage['gv_cliente_rnc']
     (mesmo contrato que o rnc.js já espera): {cnpj, razaoSocial, filial, exp}.
   - Mensagens amigáveis (CNPJ/senha incorretos, acesso desativado...).
   ===================================================================== */

const DOMINIO_CLIENTE = '@cliente.grupogalva.com.br';
const SESSAO_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

let fbApp = null, fbAuth = null;
try {
  if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    firebase.initializeApp({
      apiKey: 'AIzaSyBF5wH5ZNzA2JKQSGOopakpKF1LvahvKCY',
      authDomain: 'galvabras-gestao.firebaseapp.com',
      projectId: 'galvabras-gestao',
      storageBucket: 'galvabras-gestao.appspot.com',
      messagingSenderId: '1054843464047',
      appId: '1:1054843464047:web:2c0647902727d31902e0b2'
    });
  }
  if (typeof firebase !== 'undefined' && firebase.apps.length) {
    fbApp = firebase.app();
    fbAuth = firebase.auth();
  }
} catch (e) {
  console.warn('Firebase indisponível (login offline):', e);
}

/* ---------------- utilidades ---------------- */

function soDigitos(v) { return String(v || '').replace(/\D/g, ''); }

/* Máscara 00.000.000/0000-00 */
function maskCnpj(el) {
  if (!el) return;
  let d = soDigitos(el.value).slice(0, 14);
  let s = d;
  if (d.length > 12) s = d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
  else if (d.length > 8) s = d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8);
  else if (d.length > 5) s = d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5);
  else if (d.length > 2) s = d.slice(0, 2) + '.' + d.slice(2);
  if (el.value !== s) el.value = s;
}

/* Validação clássica dos dígitos verificadores do CNPJ */
function cnpjValido(str) {
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

function cnpjFmt(c) {
  c = soDigitos(c);
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function emailInterno(cnpj) { return soDigitos(cnpj) + DOMINIO_CLIENTE; }

function mostrarErro(msg) {
  const box = document.getElementById('loginErro');
  if (!box) return;
  if (!msg) { box.classList.add('oculto'); box.textContent = ''; return; }
  box.textContent = msg;
  box.classList.remove('oculto');
}

function carregando(sim) {
  const b = document.getElementById('btnEntrar');
  const c = document.getElementById('carregandoLogin');
  if (b) { b.disabled = !!sim; b.textContent = sim ? 'Entrando...' : 'Entrar'; }
  if (c) c.classList.toggle('on', !!sim); /* .carregando.on{display:block} */
}

/* Erros do Firebase -> mensagens amigáveis (requisito 6) */
function msgErroFirebase(code) {
  switch (code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'CNPJ ou senha incorretos. Verifique e tente novamente.';
    case 'auth/user-disabled':
      return 'Seu acesso está desativado, fale com a Galva.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
    case 'auth/network-request-failed':
      return 'Falha de conexão. Verifique sua internet e tente novamente.';
    case 'auth/invalid-email':
      return 'CNPJ ou senha incorretos.';
    default:
      return 'Não foi possível entrar. Tente novamente ou fale com a Galva.';
  }
}

/* Grava a sessão do portal no formato que o rnc.js já lê */
function gravarSessaoPortal(cnpj, razaoSocial) {
  const sessao = {
    cnpj: soDigitos(cnpj),
    razaoSocial: razaoSocial || '',
    filial: 'SP',
    exp: Date.now() + SESSAO_TTL_MS
  };
  try {
    localStorage.setItem('gv_cliente_rnc', JSON.stringify(sessao));
    localStorage.setItem('gv_cliente_cnpj', sessao.cnpj);
  } catch (e) { /* storage cheio/bloqueado: o gate do rnc.js vai reenviar ao login */ }
  return sessao;
}

function sessaoValida() {
  try {
    const s = JSON.parse(localStorage.getItem('gv_cliente_rnc') || 'null');
    return !!(s && s.cnpj && s.exp && s.exp > Date.now());
  } catch (e) { return false; }
}

/* ---------------- ações da tela ---------------- */

function alternarSenha() {
  const inp = document.getElementById('lSenha');
  const btn = document.getElementById('btnOlho');
  if (!inp) return;
  const visivel = inp.type === 'text';
  inp.type = visivel ? 'password' : 'text';
  if (btn) {
    btn.textContent = visivel ? '👁' : '🙈';
    btn.setAttribute('aria-label', visivel ? 'Mostrar senha' : 'Ocultar senha');
    btn.title = visivel ? 'Mostrar senha' : 'Ocultar senha';
  }
}

async function entrar() {
  mostrarErro('');

  const cnpj = soDigitos((document.getElementById('cCnpj') || {}).value);
  const senha = (document.getElementById('lSenha') || {}).value || '';

  if (cnpj.length !== 14) {
    mostrarErro('Informe o CNPJ com 14 dígitos.');
    return;
  }
  if (!cnpjValido(cnpj)) {
    mostrarErro('CNPJ inválido. Confira os números digitados.');
    return;
  }
  if (!senha) {
    mostrarErro('Digite a senha da sua empresa.');
    return;
  }
  if (!fbAuth) {
    mostrarErro('Serviço de login indisponível no momento. Recarregue a página ou fale com a Galva.');
    return;
  }

  carregando(true);
  try {
    const cred = await fbAuth.signInWithEmailAndPassword(emailInterno(cnpj), senha);
    const user = cred && cred.user;

    if (!user) throw { code: 'auth/user-not-found' };

    /* Acesso desativado pelo administrador (auth/user-disabled já é
       capturado acima; aqui reforçamos caso o usuário exista mas inativo) */
    if (user.isDisabled) {
      try { await fbAuth.signOut(); } catch (e) {}
      mostrarErro('Seu acesso está desativado, fale com a Galva.');
      return;
    }

    /* Razão social: definida como "Display name" na criação da conta. */
    const razaoSocial = (user.displayName || '').trim();
    gravarSessaoPortal(cnpj, razaoSocial);

    /* Mantém a query string (?rnc=TOKEN etc.) ao ir para o formulário. */
    location.replace('rnc.html' + location.search);
  } catch (e) {
    const code = (e && (e.code || (e.error && e.error.code))) || '';
    /* Desativação: tenta sair para não deixar sessão pendurada */
    if (code === 'auth/user-disabled') { try { await fbAuth.signOut(); } catch (err) {} }
    mostrarErro(msgErroFirebase(code));
  } finally {
    carregando(false);
  }
}

/* ---------------- init ---------------- */

(function initLogin() {
  const ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();

  const inp = document.getElementById('cCnpj');
  if (inp) {
    maskCnpj(inp);
    /* Colar CNPJ já formatado também é tratado */
    inp.addEventListener('input', function () { maskCnpj(this); });
  }

  /* Já tem sessão válida do portal? Pula direto para o formulário. */
  if (sessaoValida()) {
    location.replace('rnc.html' + location.search);
    return;
  }

  /* Tem login no Firebase mas sem sessão do portal (ex.: sessão anterior
     expirada): encerra para forçar novo login com senha. */
  if (fbAuth) {
    const off = fbAuth.onAuthStateChanged(function (user) {
      try { off(); } catch (e) {}
      if (user && !sessaoValida()) {
        fbAuth.signOut().catch(function () {});
      }
    }, function () {});
  }
})();
