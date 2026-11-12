/* =====================================================================
   CADASTRO DE CLIENTES (clientes.html) — acesso da equipe Galva
   ---------------------------------------------------------------------
   - Login com o MESMO usuário/senha do aplicativo (POST /api/clientes
     acao=login -> token HMAC, mesma base de usuários do /api/auth).
   - Lista e cadastro na base compartilhada galvabras/data/clientes
     (Firebase): o login da Área do Cliente e o app interno leem daí —
     cliente cadastrado aqui já entra no portal e aparece para o app.
   - Busca com filtro instantâneo por nome ou CNPJ enquanto você digita.
   - Ações: editar, inativar/ativar e restaurar a senha padrão
     (5 primeiros dígitos do CNPJ).
   ===================================================================== */

const TOKEN_KEY = 'gv_cliadm_token';
const USUARIO_KEY = 'gv_cliadm_usuario';

let cliCache = [];   /* lista completa vinda da API */
let cliEditId = '';  /* id em edição ('' = novo cliente) */

/* ---------------- utilidades ---------------- */

function soDigitos(v) { return String(v || '').replace(/\D/g, ''); }

function fmtCnpj(v) {
  const s = soDigitos(v);
  if (s.length !== 14) return s || '-';
  return s.slice(0, 2) + '.' + s.slice(2, 5) + '.' + s.slice(5, 8) + '/' + s.slice(8, 12) + '-' + s.slice(12);
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Máscara 00.000.000/0000-00 */
function cliMaskCnpj(el) {
  if (!el) return;
  let d = soDigitos(el.value).slice(0, 14);
  let s = d;
  if (d.length > 12) s = d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
  else if (d.length > 8) s = d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8);
  else if (d.length > 5) s = d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5);
  else if (d.length > 2) s = d.slice(0, 2) + '.' + d.slice(2);
  if (el.value !== s) el.value = s;
}

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

function gv(id) {
  const el = document.getElementById(id);
  return el ? String(el.value || '').trim() : '';
}

function admErroMsg(msg) {
  const box = document.getElementById('admErro');
  if (!box) return;
  if (!msg) { box.classList.add('oculto'); box.textContent = ''; return; }
  box.textContent = msg;
  box.classList.remove('oculto');
}

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('admToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('oculto');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.add('oculto'); }, 4200);
}

/* ---------------- chamadas à API ---------------- */

async function apiClientes(metodo, corpo) {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  const r = await fetch('/api/clientes', {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  let d = null;
  try { d = await r.json(); } catch (e) { d = null; }

  if (r.status === 401) {
    admSair();
    throw new Error('Sessão expirada. Entre novamente.');
  }
  if (!r.ok || !d || d.ok === false) {
    throw new Error((d && (d.erro || d.error)) || ('Erro HTTP ' + r.status));
  }
  return d;
}

/* ---------------- login / sessão ---------------- */

function admOlho() {
  const inp = document.getElementById('admSenha');
  const btn = document.getElementById('btnOlhoAdm');
  if (!inp) return;
  const visivel = inp.type === 'text';
  inp.type = visivel ? 'password' : 'text';
  if (btn) {
    btn.textContent = visivel ? '👁' : '🙈';
    btn.title = visivel ? 'Mostrar senha' : 'Ocultar senha';
  }
}

async function admEntrar() {
  admErroMsg('');
  const login = gv('admLogin');
  const senha = gv('admSenha');
  if (!login || !senha) { admErroMsg('Informe usuário e senha.'); return; }

  const b = document.getElementById('btnAdmEntrar');
  const c = document.getElementById('carregandoAdm');
  if (b) { b.disabled = true; b.textContent = 'Entrando...'; }
  if (c) c.classList.add('on');

  try {
    const r = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'login', login: login, senha: senha })
    });
    let d = null;
    try { d = await r.json(); } catch (e) { d = null; }

    if (!r.ok || !d || !d.token) {
      admErroMsg((d && (d.erro || d.error)) || 'Usuário ou senha incorretos.');
      return;
    }

    try {
      localStorage.setItem(TOKEN_KEY, d.token);
      localStorage.setItem(USUARIO_KEY, JSON.stringify(d.usuario || {}));
    } catch (e) {}
    const inp = document.getElementById('admSenha');
    if (inp) inp.value = '';
    abrirApp();
  } catch (e) {
    admErroMsg('Falha de conexão. Verifique sua internet e tente novamente.');
  } finally {
    if (b) { b.disabled = false; b.textContent = 'Entrar'; }
    if (c) c.classList.remove('on');
  }
}

function admSair() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USUARIO_KEY);
  } catch (e) {}
  document.documentElement.classList.add('sem-app');
}

function abrirApp() {
  document.documentElement.classList.remove('sem-app');
  let u = null;
  try { u = JSON.parse(localStorage.getItem(USUARIO_KEY) || 'null'); } catch (e) {}
  const q = document.getElementById('admQuem');
  if (q) q.textContent = (u && u.nome ? u.nome : 'Usuário') + (u && u.perfil ? ' · ' + u.perfil : '');
  cliCarregar();
}

/* ---------------- lista ---------------- */

async function cliCarregar() {
  const box = document.getElementById('cliLista');
  try {
    const d = await apiClientes('GET');
    cliCache = Array.isArray(d.clientes) ? d.clientes : [];
    cliRenderizar();
  } catch (e) {
    if (box) box.innerHTML = '<div class="alert alert-e">' + esc(e.message || 'Erro ao carregar.') + '</div>';
  }
}

function cliRenderizar() {
  const box = document.getElementById('cliLista');
  if (!box) return;

  const q = gv('fBusca').toLowerCase();
  const qd = soDigitos(q);

  const lista = cliCache.filter(function (c) {
    if (!q) return true;
    const nome = String(c.razaoSocial || '').toLowerCase();
    const cnpj = soDigitos(c.cnpj);
    return nome.indexOf(q) >= 0 || (qd.length >= 2 && cnpj.indexOf(qd) >= 0);
  }).sort(function (a, b) {
    return String(a.razaoSocial || '').localeCompare(String(b.razaoSocial || ''), 'pt-BR');
  });

  const cont = document.getElementById('cliContagem');
  if (cont) {
    cont.textContent = cliCache.length
      ? ('· ' + lista.length + ' de ' + cliCache.length)
      : '';
  }

  if (!lista.length) {
    box.innerHTML = '<div class="alert alert-i">' +
      (cliCache.length
        ? 'Nenhum cliente encontrado para "' + esc(gv('fBusca')) + '".'
        : 'Nenhum cliente cadastrado ainda. Preencha o formulário acima para criar o primeiro.') +
      '</div>';
    return;
  }

  box.innerHTML = lista.map(function (c) {
    const ativo = c.ativo !== false;
    const padrao = c.senhaPadrao !== false;
    const dgit = soDigitos(c.cnpj);
    return '<div class="cli-linha">' +
      '<div class="info">' +
        '<b>' + esc(c.razaoSocial || ('CNPJ ' + fmtCnpj(c.cnpj))) + '</b>' +
        '<div class="sub">CNPJ ' + fmtCnpj(c.cnpj) +
          ' · Filial ' + (c.filial === 'PR' ? 'Paraná - PR' : 'São Paulo - SP') +
          (c.criadoEm ? ' · desde ' + esc(c.criadoEm) : '') + '</div>' +
        '<div class="senhainfo">Senha: ' +
          (padrao ? 'padrão (' + esc(dgit.slice(0, 5)) + ')' : 'personalizada') + '</div>' +
      '</div>' +
      '<span class="badge ' + (ativo ? 'b-s' : 'b-d') + '">' + (ativo ? 'Ativo' : 'Inativo') + '</span>' +
      '<div class="cli-acoes">' +
        '<button class="btn-mini" onclick="cliEditar(\'' + esc(c.id) + '\')">Editar</button>' +
        '<button class="btn-mini" onclick="cliAlternar(\'' + esc(c.id) + '\')">' +
          (ativo ? 'Inativar' : 'Ativar') + '</button>' +
        '<button class="btn-mini destaque" title="Restaurar a senha padrão (5 primeiros dígitos do CNPJ)" ' +
          'onclick="cliSenhaPadrao(\'' + esc(c.id) + '\')">🔑 Senha padrão</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

/* ---------------- formulário ---------------- */

function cliLimparForm() {
  cliEditId = '';
  const c = document.getElementById('fCnpj');
  const n = document.getElementById('fNome');
  const f = document.getElementById('fFilial');
  const s = document.getElementById('fSenha');
  const t = document.getElementById('fTitulo');
  const st = document.getElementById('fStatus');
  if (c) { c.value = ''; c.readOnly = false; }
  if (n) n.value = '';
  if (f) f.value = 'SP';
  if (s) { s.value = ''; s.placeholder = 'deixe em branco para usar a padrão'; }
  if (t) t.textContent = 'Novo cliente';
  if (st) st.textContent = '';
}

function cliNovo() {
  cliLimparForm();
  const c = document.getElementById('fCnpj');
  if (c) c.focus();
}

function cliAchar(id) {
  return cliCache.find(function (x) { return String(x.id) === String(id); }) || null;
}

function cliEditar(id) {
  const c = cliAchar(id);
  if (!c) { toast('Cliente não encontrado. Recarregue a lista.'); return; }
  cliEditId = String(c.id);
  const fCnpj = document.getElementById('fCnpj');
  const fNome = document.getElementById('fNome');
  const fFilial = document.getElementById('fFilial');
  const fSenha = document.getElementById('fSenha');
  const t = document.getElementById('fTitulo');
  const st = document.getElementById('fStatus');
  if (fCnpj) { fCnpj.value = fmtCnpj(c.cnpj); fCnpj.readOnly = false; }
  if (fNome) fNome.value = c.razaoSocial || '';
  if (fFilial) fFilial.value = c.filial === 'PR' ? 'PR' : 'SP';
  if (fSenha) { fSenha.value = ''; fSenha.placeholder = 'deixe em branco para manter a senha atual'; }
  if (t) t.textContent = 'Editando: ' + (c.razaoSocial || fmtCnpj(c.cnpj));
  if (st) st.textContent = 'CNPJ ' + fmtCnpj(c.cnpj);
  try {
    document.getElementById('fNome').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {}
}

async function cliSalvar() {
  const cnpj = soDigitos(gv('fCnpj'));
  const nome = gv('fNome');
  const filial = gv('fFilial') || 'SP';
  const senha = gv('fSenha');

  if (cnpj.length !== 14 || !cnpjValido(cnpj)) {
    toast('CNPJ inválido. Confira os números digitados.');
    return;
  }
  if (!nome) {
    toast('Informe o nome (razão social) do cliente.');
    return;
  }

  const existente = cliEditId ? cliAchar(cliEditId) : null;
  const cliente = {
    id: cliEditId,
    cnpj: cnpj,
    razaoSocial: nome,
    filial: filial,
    ativo: existente ? existente.ativo !== false : true,
    senha: senha
  };

  const b = document.getElementById('btnSalvar');
  if (b) { b.disabled = true; b.textContent = 'Salvando...'; }
  try {
    const d = await apiClientes('POST', { acao: 'salvar', cliente: cliente });
    if (d.senhaEfetiva) {
      toast('Cliente salvo! Senha de acesso: ' + d.senhaEfetiva);
    } else {
      toast('Cliente salvo!');
    }
    cliLimparForm();
    await cliCarregar();
  } catch (e) {
    toast(e.message || 'Erro ao salvar.');
  } finally {
    if (b) { b.disabled = false; b.textContent = 'Salvar cliente'; }
  }
}

async function cliAlternar(id) {
  const c = cliAchar(id);
  if (!c) return;
  const novoAtivo = c.ativo === false;
  try {
    await apiClientes('POST', {
      acao: 'salvar',
      cliente: {
        id: String(c.id),
        cnpj: soDigitos(c.cnpj),
        razaoSocial: c.razaoSocial || '',
        filial: c.filial === 'PR' ? 'PR' : 'SP',
        ativo: novoAtivo
        /* sem senha => mantém a senha atual */
      }
    });
    toast(novoAtivo ? 'Cliente ativado.' : 'Cliente inativado — o acesso à Área do Cliente foi bloqueado.');
    await cliCarregar();
  } catch (e) {
    toast(e.message || 'Erro ao alterar o cliente.');
  }
}

async function cliSenhaPadrao(id) {
  const c = cliAchar(id);
  if (!c) return;
  try {
    const d = await apiClientes('POST', {
      acao: 'salvar',
      cliente: {
        id: String(c.id),
        cnpj: soDigitos(c.cnpj),
        razaoSocial: c.razaoSocial || '',
        filial: c.filial === 'PR' ? 'PR' : 'SP',
        ativo: c.ativo !== false,
        aplicarPadrao: true
      }
    });
    toast('Senha padrão restaurada: ' + (d.senhaEfetiva || soDigitos(c.cnpj).slice(0, 5)));
    await cliCarregar();
  } catch (e) {
    toast(e.message || 'Erro ao restaurar a senha.');
  }
}

/* ---------------- init ---------------- */

(function initClientesAdmin() {
  const ano = document.getElementById('ano');
  if (ano) ano.textContent = new Date().getFullYear();

  const c = document.getElementById('fCnpj');
  if (c) c.addEventListener('input', function () { cliMaskCnpj(this); });

  /* Já tem token da Galva? Entra direto no app (a trava do <head> já
     mostrou a tela certa; aqui só carrega a lista). */
  if (localStorage.getItem(TOKEN_KEY)) abrirApp();
})();
