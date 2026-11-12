/* O portal do cliente NAO acessa mais o Firebase diretamente.
   Antes ele baixava o banco INTEIRO (3,2 MB) para exibir o nome de um
   cliente - e ainda tinha acesso a CPF, fotos e hash de senha do master.
   Agora tudo passa pelo proxy do servidor, que devolve SO o que pertence
   ao CNPJ informado. */
const API_RNC='/api/rnc';
const MESES=['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
let db=null, sessao=null, rncAtual=null, anexo=null, anexoNome='';
document.getElementById('ano').textContent=new Date().getFullYear();

/* Mascara padrao de CNPJ: so numeros, 14 digitos, 00.000.000/0000-00. */
function maskCnpj(el){
  if(!el)return;
  const d=soDigitos(el.value).slice(0,14);
  let out=d;
  if(d.length>2)out=d.slice(0,2)+'.'+d.slice(2);
  if(d.length>5)out=d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5);
  if(d.length>10)out=d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8);
  if(d.length>12)out=d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8,12)+'-'+d.slice(12);
  if(el.value!==out)el.value=out;
}
function soDigitos(v){return String(v||'').replace(/\D/g,'')}
function fmtCnpj(v){const s=soDigitos(v);if(s.length!==14)return s;return s.slice(0,2)+'.'+s.slice(2,5)+'.'+s.slice(5,8)+'/'+s.slice(8,12)+'-'+s.slice(12)}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function msg(el,txt,tipo){const e=document.getElementById(el);if(!e)return;e.textContent=txt;e.className='alert alert-'+(tipo||'e');e.classList.remove('oculto')}
function esconder(el){const e=document.getElementById(el);if(e)e.classList.add('oculto')}
function alternar(id){const e=document.getElementById(id);if(e)e.type=e.type==='password'?'text':'password'}
function escolherFilial(btn){document.querySelectorAll('#cFilial button').forEach(b=>b.classList.remove('on'));btn.classList.add('on')}
function filialAtual(){const b=document.querySelector('#cFilial button.on');return b?b.dataset.fil:'SP'}
async function hashSenha(p){const enc=new TextEncoder().encode(p);const h=await crypto.subtle.digest('SHA-256',enc);return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('')}

async function carregar(){
  /* Busca apenas os dados do proprio cliente (escopo por CNPJ). */
  try{
    const cnpj=soDigitos((document.getElementById('cCnpj')||{}).value||'');
    if(cnpj.length===14){
      const r=await fetch(API_RNC+'?cnpj='+encodeURIComponent(cnpj));
      if(r.ok){const j=await r.json();db=j&&j.ok?j:{}}
    }
  }catch(e){db={}}
  if(sessao)mostrarArea();
}
function clientes(){return (db&&db.cliente)?[db.cliente]:[]}
function links(){return (db&&db.rncLinks)||(db&&db.links)||[]}
function notifs(){return (db&&db.rncNotifs)||(db&&db.notifs)||[]}

/* ============================================================
   TELA 1 -> TELA 2: formulario completo do chamado + anexos
   ============================================================ */
const CLI_MAX_FOTOS=3;
const CLI_MAX_DOCS=2;
const CLI_MAX_PDF=500*1024;
let cliFotos=[];   // {nome,data(base64),tipo,bytes}
let cliDocs=[];    // {nome,data(base64),tipo,bytes}

/* Vai para o formulario mantendo CNPJ e filial. */
function irParaFormulario(){
  const cnpj=soDigitos(document.getElementById('cCnpj').value);
  if(cnpj.length!==14){msg('loginErro','CNPJ inválido. Digite os 14 números.');return}
  esconder('loginErro');
  document.getElementById('paginaLogin').classList.add('oculto');
  document.getElementById('paginaFormulario').classList.remove('oculto');
  const cli=((db&&(db.clientes||[]).find(x=>soDigitos(x.cnpj)===cnpj))||{});
  const resumo='CNPJ '+fmtCnpj(cnpj)+' · '+(filialAtual()==='PR'?'Paraná - PR':'São Paulo - SP');
  const r=document.getElementById('formCliResumo');
  if(r)r.textContent=resumo+' — preencha todos os campos e anexe as fotos e o documento da nota fiscal.';
  const c=document.getElementById('fCliente');
  if(c&&!c.value&&cli.razaoSocial)c.value=cli.razaoSocial;
  /* Mês/dia a partir de hoje */
  const hoje=new Date();
  const d=document.getElementById('fData');
  if(d&&!d.value){const p2=n=>String(n).padStart(2,'0');d.value=hoje.getFullYear()+'-'+p2(hoje.getMonth()+1)+'-'+p2(hoje.getDate())}
  syncMesDia();
  window.scrollTo({top:0,behavior:'smooth'});
}
function voltarParaCnpj(){
  document.getElementById('paginaFormulario').classList.add('oculto');
  document.getElementById('paginaLogin').classList.remove('oculto');
  window.scrollTo({top:0,behavior:'smooth'});
}
function syncMesDia(){
  const d=document.getElementById('fData');
  const sel=document.getElementById('fMes');
  if(sel&&!sel.options.length){sel.innerHTML='<option value="">—</option>'+MESES.map(m=>'<option>'+m+'</option>').join('')}
  if(!d||!d.value)return;
  const dt=new Date(d.value+'T00:00:00');
  if(isNaN(dt))return;
  const mes=document.getElementById('fMes'),dia=document.getElementById('fDia');
  if(mes&&!mes.value)mes.value=MESES[dt.getMonth()];
  if(dia&&!dia.value)dia.value=String(dt.getDate());
  validarChamado();
}
/* Reduz a foto para ficar leve (max 900px, JPEG 0.55). */
function comprimirImagem(file){
  return new Promise(function(resolve){
    let original='';
    let done=false;
    const finish=function(v){if(done)return;done=true;resolve(v||original||'')};
    /* Timeout: se a imagem nao carregar, usa o arquivo original (nunca trava). */
    setTimeout(function(){finish(original)},8000);
    try{
      const r=new FileReader();
      r.onload=function(ev){
        original=String(ev.target.result||'');
        if(!original){finish('');return}
        try{
          const img=new Image();
          img.onload=function(){
            try{
              const max=640;
              let w=img.width||max,h=img.height||max;
              if(w>max||h>max){const f=Math.min(max/w,max/h);w=Math.round(w*f);h=Math.round(h*f)}
              const cv=document.createElement('canvas');cv.width=Math.max(1,w);cv.height=Math.max(1,h);
              const cx=cv.getContext('2d');
              if(cx){
                cx.fillStyle='#ffffff';cx.fillRect(0,0,cv.width,cv.height);
                cx.drawImage(img,0,0,cv.width,cv.height);
                finish(cv.toDataURL('image/jpeg',0.4));
              }else finish(original);
            }catch(e){finish(original)}
          };
          img.onerror=function(){finish(original)};
          img.src=original;
        }catch(e){finish(original)}
      };
      r.onerror=function(){finish('')};
      r.readAsDataURL(file);
    }catch(e){finish('')}
  });
}
async function anexarFotos(input){
  const files=Array.from((input&&input.files)||[]);
  if(!files.length)return;
  const restam=CLI_MAX_FOTOS-cliFotos.length;
  if(restam<=0){msg('erroCli','Máximo de '+CLI_MAX_FOTOS+' fotos.','e');try{input.value=''}catch(e){}return}
  let aviso='';
  for(let i=0;i<files.length&&cliFotos.length<CLI_MAX_FOTOS;i++){
    const f=files[i];
    if(f.type&&String(f.type).indexOf('image/')!==0){aviso='Só imagens são permitidas nas fotos.';continue}
    const data=await comprimirImagem(f);
    cliFotos.push({nome:f.name,data:data,tipo:'foto',bytes:Math.round((data.length||0)*0.75)});
  }
  if(files.length>restam)aviso='Apenas '+CLI_MAX_FOTOS+' fotos são permitidas.';
  renderPreviaFotos();
  if(aviso)msg('erroCli',aviso,'w');else esconder('erroCli');
  validarChamado();
}
function renderPreviaFotos(){
  const box=document.getElementById('previaFotos');
  if(!box)return;
  box.innerHTML=cliFotos.map((f,i)=>'<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:8px;background:#0d1321;border:1px solid #1e293b;font-size:11px">📷 '+esc(f.nome)+' ('+Math.round((f.bytes||0)/1024)+' KB)<button class="olho" style="position:static;transform:none" onclick="removerFoto('+i+')" aria-label="Remover foto" title="Remover foto">✕</button></span>').join('');
  const h=document.getElementById('hintFotos');
  if(h)h.textContent=cliFotos.length+' de '+CLI_MAX_FOTOS+' fotos anexadas.';
}
function removerFoto(i){cliFotos.splice(i,1);renderPreviaFotos();validarChamado()}
function anexarDocs(input){
  const files=Array.from((input&&input.files)||[]);
  if(!files.length)return;
  let aviso='';
  for(let i=0;i<files.length&&cliDocs.length<CLI_MAX_DOCS;i++){
    const f=files[i];
    const okTipo=/pdf|xml/i.test(f.type||'')||/\.pdf$|\.xml$/i.test(f.name||'');
    if(!okTipo){aviso='Anexe a nota fiscal em PDF ou XML.';continue}
    if(f.size>CLI_MAX_PDF){aviso='Cada documento deve ter no máximo 500 KB.';continue}
    const reader=new FileReader();
    reader.onload=function(ev){
      cliDocs.push({nome:f.name,data:String(ev.target.result||''),tipo:/xml/i.test(f.name||'')?'xml':'pdf',bytes:f.size});
      renderPreviaDocs();validarChamado();
    };
    reader.readAsDataURL(f);
  }
  if(files.length>CLI_MAX_DOCS)aviso='Apenas '+CLI_MAX_DOCS+' documentos são permitidos.';
  renderPreviaDocs();
  if(aviso)msg('erroCli',aviso,'w');
  validarChamado();
}
function renderPreviaDocs(){
  const box=document.getElementById('previaDocs');
  if(!box)return;
  box.innerHTML=cliDocs.map((f,i)=>'<span style="display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border-radius:8px;background:#0d1321;border:1px solid #1e293b;font-size:11px">'+(f.tipo==='xml'?'📄':'📕')+' '+esc(f.nome)+' ('+Math.round((f.bytes||0)/1024)+' KB)<button class="olho" style="position:static;transform:none" onclick="removerDoc('+i+')" aria-label="Remover documento" title="Remover documento">✕</button></span>').join('');
  const h=document.getElementById('hintDocs');
  if(h)h.textContent=cliDocs.length+' de '+CLI_MAX_DOCS+' documentos anexados.';
}
function removerDoc(i){cliDocs.splice(i,1);renderPreviaDocs();validarChamado()}
/* Valida tudo antes de liberar o envio. */
function validarChamado(){
  const ids=['fData','fMes','fDia','fCliente','fOs','fRomaneio','fNf','fMaterial','fDescricao','fQtd'];
  let feitos=0;
  ids.forEach(id=>{
    const el=document.getElementById(id);
    const v=el?String(el.value||'').trim():'';
    const okv=(id==='fQtd')?(parseFloat(v)>0):(v!==''&&v!=='-');
    if(okv)feitos++;
  });
  if(cliFotos.length+cliDocs.length>0)feitos++;
  const total=ids.length+1;
  const bar=document.getElementById('progCli');
  if(bar)bar.style.width=Math.round(feitos/total*100)+'%';
  const btn=document.getElementById('btnEnviarChamado');
  const completo=feitos>=total;
  if(btn)btn.disabled=!completo;
  return completo;
}
async function enviarChamadoCompleto(){
  if(!validarChamado()){msg('erroCli','Preencha todos os campos e anexe ao menos 1 foto ou 1 documento antes de enviar.','e');return}
  const car=document.getElementById('carregandoCli');if(car)car.classList.add('on');
  const btn=document.getElementById('btnEnviarChamado');if(btn)btn.disabled=true;
  const gv=id=>{const e=document.getElementById(id);return e?String(e.value||'').trim():''};
  const occ={
    id:Date.now(),
    tipo:'occ',
    cnpj:soDigitos(document.getElementById('cCnpj').value),
    razaoSocial:gv('fCliente'),
    filial:filialAtual(),
    dataAbertura:gv('fData'),
    mes:gv('fMes'),
    dia:parseInt(gv('fDia')||'0',10)||0,
    os: gv('fOs'),
    romaneio: gv('fRomaneio'),
    notaFiscal: gv('fNf'),
    material: gv('fMaterial'),
    descricao: gv('fDescricao'),
    qtdKg:parseFloat(gv('fQtd')||'0')||0,
    fotos:cliFotos.slice(),
    docs:cliDocs.slice(),
    data:new Date().toISOString(),
    _updatedAt:Date.now()
  };
  try{
    const put=await fetch(API_RNC,{
      method:'POST',headers:{'Content-Type':'application/json','X-Galvabras-CSRF':'1'},
      body:JSON.stringify(occ)
    });
    if(!put.ok)throw new Error('Falha ao enviar ('+put.status+')');
    msg('erroCli','Chamado enviado com sucesso! Nossa equipe da Qualidade já recebeu e vai analisar.','s');
    document.getElementById('btnEnviarChamado').disabled=true;
    cliFotos=[];cliDocs=[];
    renderPreviaFotos();renderPreviaDocs();
    setTimeout(function(){
      document.getElementById('erroCli').classList.add('oculto');
      voltarParaCnpj();
    },2500);
  }catch(e){
    msg('erroCli','Não foi possível enviar. Verifique sua conexão e tente novamente.','e');
    if(btn)btn.disabled=false;
  }finally{if(car)car.classList.remove('on')}
}
function sair(){localStorage.removeItem('gv_cliente_rnc');sessao=null;rncAtual=null;location.href='index.html'}

function chipStatus(s){
  const m={'Pendente':'b-p','Em Aberto':'b-w','Em Atraso':'b-d','Concluído':'b-s','Sem Plano de Ação':'b-m','Aguardando Cliente':'b-w','Enviado pelo cliente':'b-s'};
  return '<span class="badge '+(m[s]||'b-m')+'">'+esc(s||'-')+'</span>';
}
function mostrarArea(){
  document.getElementById('paginaLogin').classList.add('oculto');
  document.getElementById('paginaArea').classList.remove('oculto');
  document.getElementById('topoUsuario').classList.remove('oculto');
  document.getElementById('topoUsuario').style.display='flex';
  document.getElementById('topoNome').textContent=(sessao.razaoSocial||sessao.cnpj)+' · '+(sessao.filial==='PR'?'Paraná - PR':'São Paulo - SP');
  document.getElementById('subArea').textContent='CNPJ '+fmtCnpj(sessao.cnpj)+' · Filial '+(sessao.filial==='PR'?'Paraná - PR':'São Paulo - SP');
  renderNotifs();renderLista();renderHistorico();
  const token=(new URLSearchParams(location.search).get('rnc')||'').toUpperCase();
  if(token){const l=links().find(x=>String(x.token||'').toUpperCase()===token);if(l)abrirRnc(l)}
}
function renderNotifs(){
  const lista=notifs().filter(n=>soDigitos(n.cnpj)===sessao.cnpj);
  const card=document.getElementById('cardNotifs');
  if(!lista.length){card.style.display='none';return}
  card.style.display='';
  document.getElementById('listaNotifs').innerHTML=lista.map(n=>'<div class="notif"><div class="i">🔔</div><div><b>'+esc(n.titulo)+'</b><p>'+esc(n.mensagem)+'</p><div class="quando">'+esc(n.data||'')+'</div></div></div>').join('');
}
/* Histórico: SACs e PLANO DE AÇÃO do CNPJ do cliente (OPEN ISSUES).
   É o que o cliente ve ao entrar: o que foi registrado, o que a Galva
   vai fazer (plano de ação), o prazo e a situação. */
function renderHistorico(){
  const box=document.getElementById('listaHist');
  if(!box)return;
  const cnpj=sessao?soDigitos(sessao.cnpj):'';
  const abertos=((db&&db.openIssues)||[]).filter(r=>cnpj&&soDigitos(r.cnpj)===cnpj);
  if(!abertos.length){
    box.innerHTML='<div class="alert alert-i">Nenhuma RNC encontrada para o CNPJ '+fmtCnpj(cnpj)+'.</div>';
    return;
  }
  const linhas=abertos.slice();
  box.innerHTML='<div style="overflow:auto"><table style="width:100%;min-width:640px;font-size:12px"><thead><tr style="text-align:left"><th style="padding:8px">RNC</th><th style="padding:8px">Data</th><th style="padding:8px">Material</th><th style="padding:8px">Qtd</th><th style="padding:8px">Status</th><th style="padding:8px">Prazo</th></tr></thead><tbody>'
    +linhas.map(r=>'<tr style="border-top:1px solid rgba(255,255,255,.07)">'
      +'<td style="padding:8px"><b>'+esc(r.codSac||r.rncToken||r.id)+'</b>'
        +(r.classificacao?'<div style="font-size:10px;color:#94a3b8">'+esc(r.classificacao)+'</div>':'')+'</td>'
      +'<td style="padding:8px">'+esc(r.dataAbertura||'')+'</td>'
      +'<td style="padding:8px">'+esc(r.material||'-')+'</td>'
      +'<td style="padding:8px">'+esc(r.qtdKg||0)+' KG</td>'
      +'<td style="padding:8px">'+chipStatus(r.status||'-')+'</td>'
      +'<td style="padding:8px">'+(r.prazo?esc(String(r.prazo).slice(0,10)):'-')+'</td></tr>'
      +((r.planoAcao||r.causaRaiz)?'<tr style="border-top:1px solid rgba(255,255,255,.07)"><td colspan="6" style="padding:8px 8px 12px">'
        +(r.causaRaiz?'<div style="font-size:11px;margin-bottom:4px"><b style="color:#60a5fa">Causa raiz:</b> '+esc(r.causaRaiz)+'</div>':'')
        +(r.planoAcao?'<div style="font-size:11px"><b style="color:#34d399">Plano de ação:</b> '+esc(r.planoAcao)+'</div>':'')
        +'</td></tr>':'')).join('')
    +'</tbody></table></div>';
}
function renderLista(){
  const box=document.getElementById('listaRnc');
  const meus=links().filter(l=>soDigitos(l.cnpj)===sessao.cnpj);
  if(!meus.length){box.innerHTML='<div class="alert alert-i">Nenhuma RNC enviada para o seu CNPJ até o momento. Quando a Galva abrir uma RNC, ela aparece aqui.</div>';return}
  box.innerHTML=meus.slice().reverse().map(l=>'<div class="linha" onclick="abrirRncByToken(\''+l.token+'\')">'
    +'<div class="t"><b>'+esc(l.clienteNome||'RNC')+' · '+esc(l.token)+'</b>'
    +'<span>'+(l.dataStr||l.data||'')+' · Filial '+(l.filial||'SP')+(l.romaneio?' · Romaneio '+esc(l.romaneio):'')+'</span></div>'
    +(l.dados&&l.dados.material?'<span style="font-size:11px;color:#34d399">✓ preenchida</span>':'')
    +chipStatus(l.status||'Aguardando Cliente')+'</div>').join('');
}
function abrirRncByToken(t){const l=links().find(x=>String(x.token||'').toUpperCase()===String(t||'').toUpperCase());if(l)abrirRnc(l)}
function abrirRnc(l){
  rncAtual=l;
  document.getElementById('cardForm').style.display='';
  document.getElementById('formTitulo').textContent='RNC '+(l.token||'')+' · '+(l.clienteNome||'');
  document.getElementById('instrucao').textContent=l.instrucao||'Preencha todos os campos abaixo. O envio só é liberado quando estiver tudo preenchido.';
  const d=document.getElementById('dadosInternos');
  d.innerHTML=[
    ['Data',(l.dataStr||l.data||'-')],['Mês',l.mes||(l.dataStr?MESES[new Date((l.dataStr||l.data)+'T00:00:00').getMonth()]:'-')],
    ['Dia',l.dia||'-'],['Turno',l.turno||'-'],['Cliente',l.clienteNome||'-'],
    ['O.S',l.os||'-'],['Romaneio',l.romaneio||'-'],['Nota Fiscal (Galva)',l.notaFiscal||'-']
  ].map(x=>'<div><label>'+x[0]+'</label><b>'+esc(x[1])+'</b></div>').join('');
  const dd=l.dados||{};
  document.getElementById('fMaterial').value=dd.material||'';
  document.getElementById('fDescricao').value=dd.descricao||'';
  document.getElementById('fQtd').value=dd.qtdKg||'';
  document.getElementById('fNf').value=dd.notaFiscal||l.notaFiscal||'';
  anexo=null;anexoNome='';
  document.getElementById('fAnexo').value='';
  document.getElementById('hintAnexo').textContent='Imagem ou PDF, até 600 KB';
  const jaEnviado=!!(l.dados&&l.dados.material);
  document.getElementById('btnEnviar').disabled=jaEnviado;
  if(jaEnviado){msg('erroForm','Esta RNC já foi preenchida por você. Se precisar corrigir, fale com a Galva.','i')}
  else esconder('erroForm');
  validar();
  window.scrollTo({top:document.getElementById('cardForm').offsetTop-20,behavior:'smooth'});
}
function fecharForm(){document.getElementById('cardForm').style.display='none';rncAtual=null}
function anexar(){
  const inp=document.getElementById('fAnexo');
  const f=inp.files&&inp.files[0];
  if(!f){anexo=null;anexoNome='';validar();return}
  if(f.size>600*1024){msg('erroForm','O anexo deve ter no máximo 600 KB.','e');inp.value='';anexo=null;validar();return}
  const r=new FileReader();
  r.onload=function(ev){anexo=String(ev.target.result||'');anexoNome=f.name;document.getElementById('hintAnexo').textContent='Anexo: '+f.name+' ('+Math.round(f.size/1024)+' KB)';validar()};
  r.readAsDataURL(f);
}
function validar(){
  const m=document.getElementById('fMaterial').value.trim();
  const d=document.getElementById('fDescricao').value.trim();
  const q=parseFloat(document.getElementById('fQtd').value||'0');
  const nf=document.getElementById('fNf').value.trim();
  const ok=!!(m&&d&&q>0&&(nf||anexo));
  const btn=document.getElementById('btnEnviar');
  if(btn)btn.disabled=!ok;
  const total=5,feitos=(m?1:0)+(d?1:0)+(mo?1:0)+(q>0?1:0)+((nf||anexo)?1:0);
  const bar=document.getElementById('progBarra');
  if(bar)bar.style.width=Math.round(feitos/total*100)+'%';
  return ok;
}
async function enviar(){
  if(!validar()){msg('erroForm','Preencha todos os campos obrigatórios para liberar o envio.','e');return}
  if(!rncAtual)return;
  const car=document.getElementById('carregando');car.classList.add('on');
  document.getElementById('btnEnviar').disabled=true;
  const resposta={
    id:Date.now(),
    token:rncAtual.token,
    cnpj:sessao.cnpj,
    razaoSocial:sessao.razaoSocial,
    filial:sessao.filial,
    material:document.getElementById('fMaterial').value.trim(),
    descricao:document.getElementById('fDescricao').value.trim(),

    qtdKg:parseFloat(document.getElementById('fQtd').value||'0'),
    notaFiscal:document.getElementById('fNf').value.trim(),
    nfAnexo:anexo||'',
    nfAnexoNome:anexoNome||'',
    data:new Date().toISOString(),
    _updatedAt:Date.now()
  };
  try{
    /* PATCH so na chave rncRespostas — nao sobrescreve o restante do banco. */
    const resposta={id:Date.now(),token:rncAtual.token,cnpj:(sessao&&sessao.cnpj)||(rncAtual.cnpj||''),razaoSocial:(sessao&&sessao.razaoSocial)||(rncAtual.clienteNome||''),filial:(sessao&&sessao.filial)||(rncAtual.filial||'SP'),
      material:document.getElementById('fMaterial').value.trim(),
      descricao:document.getElementById('fDescricao').value.trim(),
      qtdKg:parseFloat(document.getElementById('fQtd').value||'0'),
      notaFiscal:document.getElementById('fNf').value.trim(),
      nfAnexo:anexo||'',nfAnexoNome:anexoNome||'',
      data:new Date().toISOString(),_updatedAt:Date.now()};
    const put=await fetch(API_RNC,{
      method:'POST',
      headers:{'Content-Type':'application/json','X-Galvabras-CSRF':'1'},
      body:JSON.stringify(Object.assign({},resposta,{tipo:'resposta'}))
    });
    if(!put.ok)throw new Error('Falha ao enviar ('+put.status+')');
    msg('erroForm','RNC enviada com sucesso! A Galva já pode ver os dados e vai analisar o seu caso.','s');
    document.getElementById('btnEnviar').disabled=true;
    await carregar();
    setTimeout(()=>{document.getElementById('erroForm').classList.add('oculto')},6000);
  }catch(e){
    msg('erroForm','Não foi possível enviar. Verifique sua conexão e tente novamente.','e');
    document.getElementById('btnEnviar').disabled=false;
  }finally{car.classList.remove('on')}
}

function validarSug(){
  const a=document.getElementById('sAssunto').value.trim();
  const t=document.getElementById('sTexto').value.trim();
  const b=document.getElementById('btnSug');
  if(b)b.disabled=!(a&&t);
}
async function enviarSugestao(){
  if(!validarSug()){msg('erroSug','Preencha o assunto e a sugestão.','e');return}
  const car=document.getElementById('carregando');car.classList.add('on');
  document.getElementById('btnSug').disabled=true;
  const sug={id:Date.now(),assunto:document.getElementById('sAssunto').value.trim(),texto:document.getElementById('sTexto').value.trim(),
    cnpj:(sessao&&sessao.cnpj)||'',razaoSocial:(sessao&&sessao.razaoSocial)||'',filial:(sessao&&sessao.filial)||'SP',
    status:'Nova',data:new Date().toISOString(),_updatedAt:Date.now()};
  try{
    const put=await fetch(API_RNC,{
      method:'POST',headers:{'Content-Type':'application/json','X-Galvabras-CSRF':'1'},
      body:JSON.stringify(Object.assign({},sug,{tipo:'sugestao'}))
    });
    if(!put.ok)throw new Error('Falha ao enviar ('+put.status+')');
    msg('erroSug','Sugestão enviada! A equipe da Galva vai analisar e responder.','s');
    document.getElementById('sAssunto').value='';
    document.getElementById('sTexto').value='';
    document.getElementById('btnSug').disabled=true;
  }catch(e){
    msg('erroSug','Não foi possível enviar. Verifique sua conexão e tente novamente.','e');
    document.getElementById('btnSug').disabled=false;
  }finally{car.classList.remove('on')}
}

/* sessao salva + atualizacao automatica */
(function init(){
  const token=(new URLSearchParams(location.search).get('rnc')||'').toUpperCase();
  try{
    let s=JSON.parse(localStorage.getItem('gv_cliente_rnc')||'null');
    if(!s||!s.exp||s.exp<Date.now())s=JSON.parse(localStorage.getItem('gv_cliente')||'null');
    if(s&&s.exp&&s.exp>Date.now()){sessao={cnpj:s.cnpj,razaoSocial:s.razaoSocial,filial:s.filial};document.getElementById('cCnpj').value=fmtCnpj(s.cnpj)}
    const cnpj=localStorage.getItem('gv_cliente_cnpj');
    if(cnpj&&!sessao)document.getElementById('cCnpj').value=fmtCnpj(cnpj);
  }catch(e){}
  carregar().then(()=>{
    /* Link do RNC: abre direto o formulario, sem precisar de cadastro. */
    if(token){
      const l=links().find(x=>String(x.token||'').toUpperCase()===token);
      if(l){
        if(!sessao)sessao={cnpj:l.cnpj||'',razaoSocial:l.clienteNome||'',filial:l.filial||'SP'};
        mostrarArea();
        return;
      }
    }
    /* Area do Cliente (acompanhamento): so com sessao valida. */
    if(sessao){mostrarArea();return}
    /* Sem sessao: tela 1 (CNPJ + filial). */
    document.getElementById('paginaLogin').classList.remove('oculto');
  });
  setInterval(()=>{if(sessao){carregar()}},30000);
})();
