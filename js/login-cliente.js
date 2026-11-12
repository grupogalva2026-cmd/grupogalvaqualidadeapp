/* =====================================================================
   LOGIN DA ÁREA DO CLIENTE (index.html)
   ---------------------------------------------------------------------
   - CNPJ com máscara 00.000.000/0000-00 e validação de dígitos verificadores.
   - Autenticação via API do servidor: POST /api/login-cliente valida
     CNPJ + senha na base de clientes do Firebase (galvabras/data/clientes)
     — a MESMA base que o app interno cadastra e sincroniza. Se o CNPJ
     ainda não existir, o próprio servidor cria o registro (1º acesso).
   - Sessão do portal gravada em localStorage['gv_cliente_rnc']
     (mesmo contrato que o rnc.js já espera): {cnpj, razaoSocial, filial, exp}.
   - Mensagens amigáveis (CNPJ/senha incorretos, acesso desativado...).
   ===================================================================== */

const SESSAO_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

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

/* Erros da API -> mensagens amigáveis (requisito 6) */
function msgErroApi(status, texto) {
  if (status === 401) return 'CNPJ ou senha incorretos. Verifique e tente novamente.';
  if (status === 403) return 'Seu acesso está desativado, fale com a Galva.';
  if (status === 400 && texto) return texto;
  if (status === 0) return 'Falha de conexão. Verifique sua internet e tente novamente.';
  if (texto) return texto;
  return 'Não foi possível entrar. Tente novamente ou fale com a Galva.';
}

/* Grava a sessão do portal no formato que o rnc.js já lê */
function gravarSessaoPortal(cnpj, razaoSocial, filial) {
  const sessao = {
    cnpj: soDigitos(cnpj),
    razaoSocial: razaoSocial || '',
    filial: filial === 'PR' ? 'PR' : 'SP',
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

  carregando(true);
  try {
    const r = await fetch('/api/login-cliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cnpj, senha })
    });
    let d = null;
    try { d = await r.json(); } catch (e) { d = null; }

    if (!r.ok || !d || !d.ok) {
      mostrarErro(msgErroApi(r.status, d && (d.erro || d.error)));
      return;
    }

    const cli = d.cliente || {};
    gravarSessaoPortal(cnpj, cli.razaoSocial, cli.filial);

    /* Mantém a query string (?rnc=TOKEN etc.) ao ir para o formulário. */
    location.replace('rnc.html' + location.search);
  } catch (e) {
    mostrarErro(msgErroApi(0));
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
  }
})();
