import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { rtdbGet, rtdbSet, rtdbPatch, rtdbLista, rtdbEncontrarOuCriar, rtdbAtualizarItem } from './rtdb-rest.js';

const firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
};

if (!getApps().length && process.env.FIREBASE_PROJECT_ID) {
  initializeApp({ credential: cert(firebaseConfig) });
}

const db = getApps().length ? getFirestore() : null;

/* ===========================================================================
   PONTE SAC -> APP INTERNO (Open Issues / plano de ação)
   ----------------------------------------------------------------------------
   O portal grava o chamado no Firestore (histórico do cliente), MAS o app
   interno dos 10 computadores lê o Realtime Database em galvabras/data
   (poll de 30s). Sem esta ponte, o chamado aberto pelo cliente NUNCA
   aparecia na tabela OPEN para a equipe montar o plano de ação.

   Esta função espelha o MESMO resultado do pipeline que o app executa em
   rncProcessarRespostas() (js/app.js), acrescentando os campos que o app
   antigo deixava em branco (romaneio, mês, dia e O.S). Grava, nesta ordem:

     1. galvabras/data/openIssues     -> a tabela OPEN (status "Pendente",
                                         pronto para causa raiz + plano de ação)
     2. galvabras/data/QualidadeData  -> Registro de Conformidades
     3. galvabras/anexos/<rncId>      -> fotos/docs (base64) p/ visualização
     4. galvabras/data/notifs         -> aviso "📨 Novo chamado de cliente"
     5. galvabras/data/indAudit       -> trilha de auditoria
     6. galvabras/data/rncRespostas/occ-<id> -> FALLBACK: se a gravação (1)
        falhar, o próprio app cria a linha pelo pipeline antigo.

   POR QUE NÃO DUPLICA: o pull do app baixa o documento inteiro de uma vez.
   Como (1) é gravada ANTES de (6), quando o app enxergar a entrada em
   rncRespostas ele já vê a linha em openIssues e o dedup por rncId
   (jaExiste em rncProcessarRespostas) faz ele simplesmente pular.
   Gravações são aditivas (transação/dedup por rncId) — nada é apagado.
   ========================================================================== */

const RTDB_URL = 'https://galvabras-gestao-default-rtdb.firebaseio.com';

const soDigitos = (v) => String(v || '').replace(/\D/g, '');
const pad2 = (n) => String(n).padStart(2, '0');
const hojeISO = (d = new Date()) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const agoraBR = () => new Date().toLocaleString('pt-BR');
const txt = (v) => String(v == null ? '' : v);

/* Anexa um registro em uma lista do RTDB (sem duplicar). `jaExiste` deduplica
   (aborta se já há). Usa REST: lê, verifica, grava de volta. */
async function anexarEmArray(caminho, registro, jaExiste) {
  const pred = (x) => jaExiste && jaExiste(x);
  await rtdbEncontrarOuCriar(caminho, pred, () => registro);
}

/* Grava (substitui) um valor no RTDB via REST. */
async function gravarNoRtdb(caminho, valor) {
  await rtdbSet(caminho, valor);
}

/* Monta todos os registros da ponte a partir do corpo do chamado (occ). */
export function montarPonteSAC(body) {
  const idOcc = txt(body.id || Date.now());
  const codSac = 'RNC-' + idOcc.slice(-6);
  const cnpj = soDigitos(body.cnpj);
  const abertura = /^\d{4}-\d{2}-\d{2}/.test(txt(body.dataAbertura))
    ? txt(body.dataAbertura).slice(0, 10)
    : hojeISO();

  const fotos = Array.isArray(body.fotos) ? body.fotos : [];
  const docs = Array.isArray(body.docs) ? body.docs : [];
  const metaFotos = fotos.map((f) => ({ nome: txt(f.nome) || 'foto', bytes: +f.bytes || 0 }));
  const metaDocs = docs.map((x) => ({ nome: txt(x.nome) || 'documento', bytes: +x.bytes || 0, tipo: txt(x.tipo) }));
  const descricao = txt(body.descricao);

  /* 1) TABELA OPEN — o funcionário abre e monta causa raiz + plano de ação. */
  const openIssue = {
    id: 'oi-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    codSac,
    dataAbertura: abertura,
    dataStr: abertura,
    mes: txt(body.mes),                 /* nome do mês (JANEIRO...) */
    dia: parseInt(body.dia, 10) || 0,
    cliente: txt(body.razaoSocial),
    cnpj,
    uf: body.filial === 'PR' ? 'PR' : 'SP',
    os: txt(body.os),
    romaneio: txt(body.romaneio),
    notaFiscal: txt(body.notaFiscal),
    nfAnexo: '',
    material: txt(body.material),
    descricao,
    motivo: 'Abertura pelo cliente',
    qtdKg: parseFloat(body.qtdKg) || 0,
    nFotos: fotos.length,
    nDocs: docs.length,
    fotos: metaFotos,                   /* sem base64: anexos ficam em galvabras/anexos */
    docs: metaDocs,
    classificacao: 'PROCEDENTE',
    tipoSac: 'Externa',
    unidadeGeradora: '', setor: '', turno: '', modoFalha: '',
    responsavel: '', setorPlano: '', prazo: '', dataFechamento: '',
    causaRaiz: '', planoAcao: '', obs: '',
    custoFrete: 0, custo: 0, tipoContencao: '', contencaoKg: '',
    status: 'Pendente',                 /* aguardando o preenchimento interno */
    rncId: idOcc,
    rncToken: '',
    origemCliente: true,
    _updatedAt: Date.now(),
  };

  /* 2) REGISTRO DE CONFORMIDADES — mesmo formato do pipeline do app. */
  const registro = {
    id: Date.now(),
    data: abertura,
    dataStr: abertura,
    mes: txt(body.mes),
    mesNome: txt(body.mes),
    dia: txt(body.dia),
    turno: '',
    cliente: txt(body.razaoSocial),
    os: txt(body.os),
    romaneio: txt(body.romaneio),
    material: txt(body.material),
    descricao,
    motivo: 'Abertura pelo cliente',
    qtdKg: parseFloat(body.qtdKg) || 0,
    notaFiscal: txt(body.notaFiscal),
    nFotos: fotos.length,
    nDocs: docs.length,
    fotos: metaFotos,
    docs: metaDocs,
    codSac,
    cnpj,
    rncToken: '',
    rncId: idOcc,
    origemCliente: true,
    _updatedAt: Date.now(),
  };

  /* 3) ANEXOS — fotos e docs completos (base64), como rncSalvarAnexos faz. */
  const anexos = { fotos, docs, data: agoraBR() };

  /* 4) NOTIFICAÇÃO para a equipe (mesmo formato de addNotif). */
  const notif = {
    id: Date.now(),
    title: '📨 Novo chamado de cliente',
    text: 'CNPJ ' + (cnpj || '-') + ' (' + codSac + ') — ' + descricao.slice(0, 80),
    time: agoraBR(),
    read: false,
    to: 'all',
  };

  /* 5) AUDITORIA (mesmo formato de indAudit). */
  const audit = {
    id: Date.now(),
    time: agoraBR(),
    user: 'Sistema',
    userId: null,
    dept: '',
    profile: '',
    action: 'rnc_chamado',
    detail: 'Chamado aberto pelo cliente CNPJ ' + cnpj +
      ' (' + fotos.length + ' fotos, ' + docs.length + ' docs) — ' + codSac,
  };

  /* 6) FALLBACK: corpo original para o pipeline antigo do app consumir. */
  const rncResposta = { ...body, id: idOcc, tipo: 'occ' };

  return { idOcc, codSac, openIssue, registro, anexos, notif, audit, rncResposta };
}

/* Executa a ponte. Nunca derruba a resposta do portal: o chamado já está
   no Firestore; falha da ponte é registrada no log da Vercel. */
async function publicarSacNoApp(body) {
  try {
    const m = montarPonteSAC(body);

    /* (1) Tabela OPEN primeiro — âncora da dedup (ver comentário no topo). */
    let openOk = false;
    try {
      await anexarEmArray('galvabras/data/openIssues', m.openIssue,
        (x) => x && String(x.rncId) === m.idOcc);
      openOk = true;
    } catch (e) {
      console.error('[rnc] ponte: openIssues falhou:', e.message);
    }

    /* (2..6) Registro, anexos, notificação, auditoria e fallback. */
    await Promise.all([
      anexarEmArray('galvabras/data/QualidadeData', m.registro,
        (x) => x && String(x.rncId) === m.idOcc)
        .catch((e) => console.error('[rnc] ponte: QualidadeData falhou:', e.message)),
      gravarNoRtdb('galvabras/anexos/' + m.idOcc, m.anexos)
        .catch((e) => console.error('[rnc] ponte: anexos falhou:', e.message)),
      anexarEmArray('galvabras/data/notifs', m.notif,
        (x) => x && txt(x.text).indexOf(m.codSac) >= 0)
        .catch((e) => console.error('[rnc] ponte: notifs falhou:', e.message)),
      anexarEmArray('galvabras/data/indAudit', m.audit,
        (x) => x && txt(x.detail).indexOf(m.codSac) >= 0)
        .catch((e) => console.error('[rnc] ponte: indAudit falhou:', e.message)),
      /* Fallback SEMPRE gravado depois de (1): se (1) falhou, o app cria a
         linha; se (1) deu certo, o app deduplica por rncId e ignora. */
      gravarNoRtdb('galvabras/data/rncRespostas/occ-' + m.idOcc, m.rncResposta)
        .catch((e) => console.error('[rnc] ponte: rncRespostas falhou:', e.message)),
    ]);

    return openOk ? 'ok' : 'fallback';
  } catch (e) {
    console.error('[rnc] ponte SAC->app falhou:', e);
    return 'erro';
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Galvabras-CSRF');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (!db) {
    res.status(500).json({ error: 'Firebase não configurado.' });
    return;
  }

  try {
    if (req.method === 'POST') {
      const body = req.body || {};
      await db.collection('rnc').add({
        ...body,
        createdAt: new Date().toISOString(),
      });

      /* Chamado de abertura (SAC): espelha para o app interno (tabela OPEN). */
      let ponteApp = 'nao';
      if (String(body.tipo || '') === 'occ') {
        ponteApp = await publicarSacNoApp(body);
      }

      res.status(200).json({ ok: true, message: 'RNC recebido.', ponteApp });
    } else {
      /* GET /api/rnc?cnpj= — contrato da área do cliente (carregar() em
         js/rnc.js): {ok, cliente, links, notifs, oi, openIssues, rncs},
         tudo escopado ao CNPJ informado. Sem CNPJ válido devolve o mesmo
         erro da API original do portal (galvabras-gestao-ti). */
      const cnpj = soDigitos((req.query || {}).cnpj);
      if (cnpj.length !== 14) {
        res.status(400).json({ ok: false, error: 'cnpj', code: 'cnpj', message: 'CNPJ invalido' });
        return;
      }

      const fmt = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

      /* Leitura com timeout: nenhuma chamada pode travar o endpoint inteiro. */
      const RTDB_TIMEOUT_MS = 12000;
      const ler = async (caminho, rotulo) => {
        try {
          const v = await Promise.race([
            rtdbGet(caminho),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + RTDB_TIMEOUT_MS + 'ms')), RTDB_TIMEOUT_MS)),
          ]);
          return { rotulo, ok: true, val: v };
        } catch (e) {
          return { rotulo, ok: false, val: null, erro: e.message };
        }
      };

      const rFirestore = Promise.all([
        db.collection('rnc').where('cnpj', '==', cnpj).limit(50).get(),
        db.collection('rnc').where('cnpj', '==', fmt).limit(50).get(),
      ]);

      const [
        leSignLinks,
        leRncNotifs,
        leOpenIssues,
        leClientes,
        pares,
      ] = await Promise.all([
        ler('galvabras/data/signLinks', 'signLinks'),
        ler('galvabras/data/rncNotifs', 'rncNotifs'),
        ler('galvabras/data/openIssues', 'openIssues'),
        ler('galvabras/data/clientes', 'clientes'),
        rFirestore,
      ]);

      const listaDe = (resultado) => {
        const v = resultado.val;
        if (!resultado.ok) console.warn('[rnc] leitura falhou (' + resultado.rotulo + '):', resultado.erro);
        return rtdbLista(v);
      };
      const meu = (x) => soDigitos(x && x.cnpj) === cnpj;

      const signLinks = listaDe(leSignLinks);
      const rncNotifs = listaDe(leRncNotifs);
      const openIssues = listaDe(leOpenIssues);
      const clientesSnap = listaDe(leClientes);

      const rtLeiturasFalharam = [leSignLinks, leRncNotifs, leOpenIssues, leClientes]
        .some((x) => !x.ok);
      const rtdbDiagnostico = rtLeiturasFalharam
        ? { ok: false, erro: 'leituras RTDB com timeout ou erro de rede' }
        : null;

      /* Cliente do CNPJ (SEM expor hash de senha). */
      const bruto = clientesSnap.find(meu) || null;
      const cliente = bruto
        ? (({ senhaHash, senhaTemporaria, ...resto }) => resto)(bruto)
        : null;

      const links = signLinks.filter(meu);
      const notifs = rncNotifs.filter(meu);
      const oi = openIssues.filter(meu);

      /* Chamados do próprio CNPJ ("Meus chamados" do portal). O formato
         pode ser dígitos (portal) ou mascarado (formulário antigo). */
      const [a, b] = pares;
      const vistos = new Set();
      const docs = [];
      [...a.docs, ...b.docs].forEach((d) => {
        if (!vistos.has(d.id)) { vistos.add(d.id); docs.push(d); }
      });
      const rncs = docs.map((d) => ({ id: d.id, ...d.data() }));

      const corpo = { ok: true, cliente, links, notifs, oi, openIssues: oi, rncs };
      if (rtdbDiagnostico) corpo._diag = rtdbDiagnostico;
      res.status(200).json(corpo);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
