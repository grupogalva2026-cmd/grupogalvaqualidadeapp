/* =====================================================================
   PORTAL DO CLIENTE — camada da Etapa 2 sobre o rnc.html
   ---------------------------------------------------------------------
   Este arquivo é carregado DEPOIS do js/rnc.js (nenhuma linha do rnc.js
   foi alterada) e acrescenta, sem quebrar nada o que já existia:

   1) GATE DE LOGIN: verifica a sessão do portal (localStorage
      'gv_cliente_rnc', gravada pelo login do index.html via
      /api/login-cliente) e manda de volta para o index.html se não
      houver login. Preserva a query string (?rnc=TOKEN) nos redirecionamentos.
   2) WRAPPERS: envolve escolherFilial/carregar/voltarParaCnpj com o
      comportamento original + o que é novo (filial gravada na sessão,
      repintar "Meus chamados" a cada atualização, voltar para a área
      em vez da tela 1).
   3) FORMULÁRIO PÓS-LOGIN: CNPJ e razão social preenchidos e travados.
   4) "MEUS CHAMADOS": leitura via GET /api/rnc?cnpj= (o servidor já
      devolve somente os dados do próprio CNPJ) — somente chamados de
      abertura (tipo 'occ'), somente leitura.
   ===================================================================== */

(function () {
  'use strict';

  const SESSAO_TTL_MS = 12 * 60 * 60 * 1000;

  /* ---------------- utilidades de sessão ---------------- */
  const soDigitos = (v) => String(v || '').replace(/\D/g, '');

  function sessaoPortal() {
    try {
      const s = JSON.parse(localStorage.getItem('gv_cliente_rnc') || 'null');
      return (s && s.cnpj && s.exp && s.exp > Date.now()) ? s : null;
    } catch (e) { return null; }
  }

  function irParaLogin() {
    try { localStorage.removeItem('gv_cliente_rnc'); } catch (e) {}
    location.replace('index.html' + location.search);
  }

  /* ---------------- 1) GATE DE LOGIN ---------------------------------- */
  (function gate() {
    if (!sessaoPortal()) irParaLogin();
  })();

  /* ---------------- 2) WRAPPERS (comportamento original preservado) ---- */

  /* Filial: além do ORIGINAL (marcar o chip), grava a escolha na sessão
     para o envio do chamado usar a filial certa. */
  if (typeof window.escolherFilial === 'function' && !window.escolherFilial.__gvPortal) {
    const origFilial = window.escolherFilial;
    const novaFilial = function (btn) {
      origFilial(btn);
      try {
        const fil = (btn && btn.dataset && btn.dataset.fil) || 'SP';
        const s = sessaoPortal();
        if (s) {
          s.filial = fil;
          localStorage.setItem('gv_cliente_rnc', JSON.stringify(s));
        }
        if (typeof sessao !== 'undefined' && sessao) sessao.filial = fil;
      } catch (e) {}
    };
    novaFilial.__gvPortal = true;
    window.escolherFilial = novaFilial;
  }

  /* Atualizar: após o ORIGINAL carregar (também roda a cada 30s), o db
     já vem escopado ao CNPJ — repinta "Meus chamados" com esses dados. */
  if (typeof window.carregar === 'function' && !window.carregar.__gvPortal) {
    const origCarregar = window.carregar;
    const novoCarregar = function () {
      const r = origCarregar.apply(this, arguments);
      const segue = function () {
        try {
          if (typeof db !== 'undefined' && db && Array.isArray(db.rncs)) {
            chamadosCache = db.rncs;
          }
          renderMeusChamados();
        } catch (e) {}
      };
      if (r && typeof r.then === 'function') r.then(segue, segue);
      else segue();
      return r;
    };
    novoCarregar.__gvPortal = true;
    window.carregar = novoCarregar;
  }

  /* Voltar (do formulário): em vez da antiga tela 1 (CNPJ editável),
     volta para a Área do Cliente logada. */
  if (typeof window.voltarParaCnpj === 'function' && !window.voltarParaCnpj.__gvPortal) {
    const novaVoltar = function () {
      const f = document.getElementById('paginaFormulario');
      const a = document.getElementById('paginaArea');
      if (f) f.classList.add('oculto');
      if (a) a.classList.remove('oculto');
      try { renderMeusChamados(); } catch (e) {}
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    novaVoltar.__gvPortal = true;
    window.voltarParaCnpj = novaVoltar;
  }

  /* ---------------- 3) FORMULÁRIO PÓS-LOGIN --------------------------- */

  function aplicarFilial(fil) {
    try {
      document.querySelectorAll('#cFilial button').forEach(function (b) {
        b.classList.toggle('on', (b.dataset && b.dataset.fil) === (fil || 'SP'));
      });
    } catch (e) {}
  }

  /* Ponto de entrada do cartão "Abrir nova reclamação". */
  window.abrirFormularioCliente = function () {
    const s = sessaoPortal() || (typeof sessao !== 'undefined' && sessao) || null;
    const cnpj = s ? soDigitos(s.cnpj) : '';

    /* CNPJ da tela 1 (oculta) fica preenchido e travado — o rnc.js lê
       dele para montar o chamado. */
    const inp = document.getElementById('cCnpj');
    if (inp && cnpj) { inp.value = inp.value || cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'); inp.readOnly = true; }

    aplicarFilial((s && s.filial) || 'SP');

    if (typeof window.irParaFormulario === 'function') window.irParaFormulario();

    /* CNPJ travado no formulário */
    const vis = document.getElementById('fCnpjVis');
    if (vis && cnpj) {
      vis.value = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
      vis.readOnly = true;
      vis.classList.add('travado');
    }

    /* Razão social preenchida e travada (vem do cadastro de acesso). */
    const cli = document.getElementById('fCliente');
    const razao = (s && s.razaoSocial) ? String(s.razaoSocial).trim() : '';
    if (cli) {
      if (razao) {
        if (!cli.value) cli.value = razao;
        cli.readOnly = true;
        cli.classList.add('travado');
        cli.title = 'Razão social vinda do seu cadastro de acesso';
      } else {
         /* Cadastro sem razão social: deixa o cliente informar (evita
            formulário travado sem valor). */
        cli.placeholder = 'Informe a razão social da empresa';
      }
    }
    return false;
  };

  /* Travamos cCnpj e mostramos a área já no carregamento (caso o cliente
     acesse o formulário pelo link ?rnc=). */
  (function initPosLogin() {
    const s = sessaoPortal();
    if (!s) return;
    const inp = document.getElementById('cCnpj');
    if (inp) inp.readOnly = true;
    aplicarFilial(s.filial || 'SP');
  })();

  /* ---------------- 4) MEUS CHAMADOS (API escopada ao CNPJ) ----------- */

  let chamadosCache = [];

  function statusChamado(d) {
    const st = String((d && d.status) || '').toLowerCase();
    if (!st || st === 'aberto' || st === 'em aberto' || st === 'novo' || st === 'nova') {
      return { txt: 'Aberto', cls: 'b-w' };
    }
    if (st.indexOf('conclu') >= 0 || st.indexOf('fechad') >= 0 || st.indexOf('resolvid') >= 0) {
      return { txt: 'Concluído', cls: 'b-s' };
    }
    return { txt: 'Em análise', cls: 'b-p' };
  }

  function dataChamado(d) {
    const bruto = String((d && (d.dataAbertura || d.data)) || '');
    if (!bruto) return '—';
    const dt = new Date(bruto.length <= 10 ? bruto + 'T00:00:00' : bruto);
    if (isNaN(dt)) return bruto.slice(0, 10);
    const p2 = (n) => String(n).padStart(2, '0');
    return p2(dt.getDate()) + '/' + p2(dt.getMonth() + 1) + '/' + dt.getFullYear();
  }

  function numeroChamado(d, docId) {
    const n = d && (d.numero || d.protocolo || d.codSac);
    if (n) return '#' + String(n).replace(/^#/, '');
    const base = (d && d.id) || docId || '';
    return '#' + String(base).slice(-6);
  }

  function renderMeusChamados() {
    const box = document.getElementById('listaMeusChamados');
    if (!box) return;
    const s = sessaoPortal() || (typeof sessao !== 'undefined' && sessao) || null;
    const cnpj = s ? soDigitos(s.cnpj) : '';
    if (!cnpj) return;

    /* Só chamados de abertura (tipo 'occ') e SOMENTE do próprio CNPJ. */
    let lista = (Array.isArray(chamadosCache) ? chamadosCache : []).filter(function (d) {
      return soDigitos(d.cnpj) === cnpj && String(d.tipo || 'occ') === 'occ';
    });

    /* Fallback: dados do carregar() (já escopados ao CNPJ pelo servidor). */
    if (!lista.length && typeof db !== 'undefined' && db && Array.isArray(db.rncs)) {
      lista = db.rncs.filter(function (d) {
        return soDigitos(d.cnpj) === cnpj && String(d.tipo || 'occ') === 'occ';
      });
    }

    if (!lista.length) {
      box.innerHTML = '<div class="alert alert-i">Nenhum chamado aberto para o CNPJ ' +
        (typeof fmtCnpj === 'function' ? fmtCnpj(cnpj) : cnpj) +
        '. Quando você abrir uma reclamação, ela aparece aqui com o status.</div>';
      return;
    }

    lista.sort(function (a, b) { return (Number(b.id) || 0) - (Number(a.id) || 0); });

    box.innerHTML = lista.map(function (d, i) {
      const st = statusChamado(d);
      const docId = (d && d._docId) || '';
      return '<div class="linha linha-ro">' +
        '<div class="t"><b>' + esc(numeroChamado(d, docId)) + '</b>' +
        '<span>' + esc(dataChamado(d)) +
        (d.razaoSocial ? ' · ' + esc(d.razaoSocial) : '') +
        (d.material ? ' · ' + esc(d.material) : '') + '</span></div>' +
        '<span class="badge ' + st.cls + '">' + st.txt + '</span>' +
        '</div>';
    }).join('');
  }

  /* Busca inicial na API (escopada ao CNPJ no servidor). */
  async function atualizarMeusChamados() {
    const s = sessaoPortal();
    if (!s) return;
    try {
      const r = await fetch('/api/rnc?cnpj=' + encodeURIComponent(soDigitos(s.cnpj)), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      if (d && Array.isArray(d.rncs)) chamadosCache = d.rncs;
    } catch (e) { /* sem rede: fica o cache/db.rncs */ }
    try { renderMeusChamados(); } catch (e) {}
  }

  /* Primeira pintura. */
  atualizarMeusChamados();

})();
