/* =====================================================================
   PORTAL DO CLIENTE — camada da Etapa 2 sobre o rnc.html
   ---------------------------------------------------------------------
   Este arquivo é carregado DEPOIS do js/rnc.js (nenhuma linha do rnc.js
   foi alterada) e acrescenta, sem quebrar nada o que já existia:

   1) GATE DE LOGIN: verifica a sessão do portal + Firebase Authentication
      e manda de volta para o index.html (tela de login) se não houver
      login. Preserva a query string (?rnc=TOKEN) nos redirecionamentos.
   2) WRAPPERS: envolve sair/carregar/escolherFilial/voltarParaCnpj com
      o comportamento original + o que é novo (signOut, filial gravada,
      voltar para a área em vez da tela 1).
   3) FORMULÁRIO PÓS-LOGIN: CNPJ e razão social preenchidos e travados.
   4) "MEUS CHAMADOS": lista somente os chamados (tipo 'occ') do próprio
      CNPJ, com status, data e número — somente leitura.
      Leitura direta no Firestore (where cnpj == meuCNPJ), fallback para
      a API /api/rnc se o Firestore não estiver disponível.
   ===================================================================== */

(function () {
  'use strict';

  const DOMINIO_CLIENTE = '@cliente.grupogalva.com.br';
  const SESSAO_TTL_MS = 12 * 60 * 60 * 1000;

  /* ---------------- Firebase (mesmo projeto do app interno) ------------ */
  let fbAuth = null, fbDb = null;
  try {
    if (typeof firebase !== 'undefined') {
      if (!firebase.apps.length) {
        firebase.initializeApp({
          apiKey: 'AIzaSyBF5wH5ZNzA2JKQSGOopakpKF1LvahvKCY',
          authDomain: 'galvabras-gestao.firebaseapp.com',
          projectId: 'galvabras-gestao',
          storageBucket: 'galvabras-gestao.appspot.com',
          messagingSenderId: '1054843464047',
          appId: '1:1054843464047:web:2c0647902727d31902e0b2'
        });
      }
      if (firebase.apps.length) {
        fbAuth = firebase.auth();
        fbDb = firebase.firestore();
      }
    }
  } catch (e) {
    console.warn('Firebase indisponível (modo degradado):', e);
  }

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

  function cnpjDaConta(user) {
    /* 12345678000199@cliente.grupogalva.com.br -> 12345678000199 */
    const email = String((user && user.email) || '').toLowerCase();
    return email.endsWith(DOMINIO_CLIENTE) ? email.slice(0, -DOMINIO_CLIENTE.length) : '';
  }

  /* ---------------- 1) GATE DE LOGIN ---------------------------------- */
  (function gate() {
    const s = sessaoPortal();
    if (!s) { irParaLogin(); return; }

    if (!fbAuth) {
      /* Firebase/Sem rede: modo degradado — a marcação local do portal
         (gravada só após login real) é aceita. */
      return;
    }

    let resolvido = false;
    try {
      const off = fbAuth.onAuthStateChanged(function (user) {
        if (resolvido) return;
        resolvido = true;
        try { off(); } catch (e) {}
        if (!user) { irParaLogin(); return; }
        const cnpjConta = cnpjDaConta(user);
        if (cnpjConta && cnpjConta !== soDigitos(s.cnpj)) {
          /* Logado com outra conta: encerra e volta para o login. */
          fbAuth.signOut().catch(function () {});
          irParaLogin();
        }
        /* OK: permanece na página. */
      }, function () {
        /* Erro ao ler a sessão Firebase: não bloqueia o cliente. */
        resolvido = true;
      });
    } catch (e) { resolvido = true; }

    /* Fallback: se o Firebase não responder em 6s (SDK/cdn fora), deixa
       a sessão local do portal seguir (login já foi feito para existir). */
    setTimeout(function () {
      if (!resolvido) { resolvido = true; try { off && off(); } catch (e) {} }
    }, 6000);
  })();

  /* ---------------- 2) WRAPPERS (comportamento original preservado) ---- */

  /* Sair: encerra também a sessão do Firebase Authentication. */
  if (typeof window.sair === 'function' && !window.sair.__gvPortal) {
    const origSair = window.sair;
    const novaSair = function () {
      let foi = false;
      const ir = function () { if (foi) return; foi = true; origSair(); };
      if (fbAuth) {
        try {
          fbAuth.signOut().then(ir, ir);
          setTimeout(ir, 900); /* nunca deixa o cliente esperando */
        } catch (e) { ir(); }
      } else { ir(); }
    };
    novaSair.__gvPortal = true;
    window.sair = novaSair;
  }

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

  /* Atualizar: após o ORIGINAL carregar, re-renderiza "Meus chamados". */
  if (typeof window.carregar === 'function' && !window.carregar.__gvPortal) {
    const origCarregar = window.carregar;
    const novoCarregar = function () {
      const r = origCarregar.apply(this, arguments);
      const segue = function () { try { renderMeusChamados(); } catch (e) {} };
      if (r && typeof r.then === 'function') r.then(segue, segue);
      else segue();
      return r;
    };
    novoCarregar.__gvPortal = true;
    window.carregar = novoCarregar;
  }

  /* Voltar (do formulário): em vez da antiga tela 1 (CNPJ editável),
     volta para a Área do Cliente logado. */
  if (typeof window.voltarParaCnpj === 'function' && !window.voltarParaCnpj.__gvPortal) {
    const novaVoltar = function () {
      const f = document.getElementById('paginaFormulario');
      const a = document.getElementById('paginaArea');
      if (f) f.classList.add('oculto');
      if (a) a.classList.remove('oculto');
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

    /* Razão social preenchida e travada (vem do login/display name). */
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

  /* ---------------- 4) MEUS CHAMADOS (Firestore, só o próprio CNPJ) ---- */

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
    let lista = chamadosCache.filter(function (d) {
      return soDigitos(d.cnpj) === cnpj && String(d.tipo || 'occ') === 'occ';
    });

    /* Fallback: dados da API (já escopados/filtrados por CNPJ aqui). */
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

  /* Assinatura ao vivo do Firestore: where('cnpj','==',meuCNPJ) — índice
     de campo simples (não exige índice composto). */
  (function assinarChamados() {
    const s = sessaoPortal();
    if (!s || !fbDb) return;
    try {
      fbDb.collection('rnc')
        .where('cnpj', '==', soDigitos(s.cnpj))
        .limit(100)
        .onSnapshot(function (snap) {
          chamadosCache = [];
          snap.forEach(function (doc) {
            const d = doc.data() || {};
            d._docId = doc.id;
            chamadosCache.push(d);
          });
          renderMeusChamados();
        }, function () {
          /* Sem permissão/conexão: fica o fallback da API. */
          renderMeusChamados();
        });
    } catch (e) { /* modo degradado: fallback da API */ }
  })();

  /* Primeira pintura (o snapshot assíncrono repinta depois). */
  renderMeusChamados();

})();
