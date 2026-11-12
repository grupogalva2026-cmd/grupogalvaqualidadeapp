'use strict';
/**
 * public/js/qualidade.js
 * Helpers compartilhados para as telas do módulo Qualidade (Firebase separado: galvaqualidade).
 * Toda chamada passa pelo backend da Vercel (/api/qualidade). O navegador nunca acessa o Firestore diretamente.
 */

const QUAL_API='/api/qualidade';
const QUAL_TOKEN_KEY='qual_token';
const QUAL_USER_KEY='qual_user';

function qualToken(){try{return localStorage.getItem(QUAL_TOKEN_KEY)||null}catch(e){return null}}
function setQualToken(t){try{t?localStorage.setItem(QUAL_TOKEN_KEY,t):localStorage.removeItem(QUAL_TOKEN_KEY)}catch(e){}}
function qualUser(){try{return JSON.parse(localStorage.getItem(QUAL_USER_KEY)||'null')}catch(e){return null}}
function setQualUser(u){try{u?localStorage.setItem(QUAL_USER_KEY,JSON.stringify(u)):localStorage.removeItem(QUAL_USER_KEY)}catch(e){}}

function qualHeaders(extra={}){
  const h={'Content-Type':'application/json','X-Galvabras-CSRF':'1',...extra};
  const t=qualToken();
  if(t)h['Authorization']='Bearer '+t;
  return h;
}

async function qualCall(op,body={},method='POST'){
  const res=await fetch(QUAL_API+'?op='+op,{
    method,headers:qualHeaders(),body:method==='POST'?JSON.stringify(body):undefined
  });
  let j=null;try{j=await res.json()}catch(e){}
  if(!res.ok){
    const err=new Error((j&&j.message)||('Erro '+(res.status||'de rede')));
    err.status=res.status;err.code=(j&&(j.code||j.error))||'';throw err
  }
  return j;
}

function qualIsMaster(user){
  if(!user)return false;
  if(user.perfil==='master'||user.master===true)return true;
  if(user.email&&user.email.toLowerCase()==='complexocorpcity@gmail.com')return true;
  return false;
}

/** Verifica se o usuário tem permissão para uma área. Chama /api/qualidade?op=permissoes */
async function qualTemPermissao(area){
  const u=qualUser();
  if(!u)return false;
  if(qualIsMaster(u))return true;
  try{
    const j=await qualCall('permissoes&acao=listar',{},'GET');
    const p=(j.permissoes||[]).find(x=>String(x.usuarioId)===String(u.id));
    return !!((p&&p.areas&&p.areas[area]));
  }catch(e){return false}
}

/** Renderiza checkboxes de permissão para um usuário dado o container id. */
async function qualRenderPermissoes(containerId, usuarioId, usuarioNome){
  const el=document.getElementById(containerId);
  if(!el)return;
  const AREAS=[
    {key:'qualidade',label:'Qualidade'},
    {key:'contencoes',label:'Contencões Internas'},
    {key:'ocorrencias',label:'Ocorrências (SAC)'},
    {key:'funcionarios',label:'Funcionários'},
    {key:'seguranca',label:'Segurança do Trabalho'},
    {key:'indicadores',label:'Indicadores'},
    {key:'logs',label:'Logs de auditoria'},
    {key:'config',label:'Configurações'},
  ];
  let html='<label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:10px">Áreas do sistema:</label>';
  AREAS.forEach(a=>{
    html+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <input type="checkbox" id="qperm_${a.key}" value="${a.key}">
      <label for="qperm_${a.key}" style="font-size:13px;color:#374151">${a.label}</label>
    </div>`;
  });
  el.innerHTML=html;
  try{
    const j=await qualCall('permissoes&acao=listar',{},'GET');
    const p=(j.permissoes||[]).find(x=>String(x.usuarioId)===String(usuarioId));
    if(p&&p.areas){
      Object.keys(p.areas).forEach(k=>{
        const cb=document.getElementById('qperm_'+k);
        if(cb)cb.checked=!!p.areas[k];
      });
    }
  }catch(e){}
}

function qualFormatRG(rg){
  return String(rg||'').replace(/\D/g,'');
}

module.exports={qualToken,setQualToken,qualUser,setQualUser,qualHeaders,qualCall,qualIsMaster,qualTemPermissao,qualRenderPermissoes,qualFormatRG};
