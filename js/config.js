/* =====================================================================
   GALVABRAS QUALIDADE - App Desktop Config
   Carregado ANTES do app.js para forçar todas as chamadas /api/*
   a irem para a API da Vercel e manter o localStorage funcionando
   localmente (offline/online).
   ===================================================================== */
(function(){
  'use strict';

  /* Na web usa a MESMA origem (sem proxy entre dominios).
     No app desktop (file://) aponta para o dominio oficial. */
  const OFICIAL = 'https://grupogalvaqualidadeapp.vercel.app';
  const API_BASE = (location.protocol === 'file:' || location.protocol === 'app:')
    ? OFICIAL
    : location.origin;
  window.GV_API_BASE = API_BASE;

  /* Intercepta fetch para redirecionar /api/* para a Vercel */
  const _origFetch = window.fetch;
  window.fetch = function(input, init){
    try{
      const url = String(input || '');
      if(url.startsWith('/api/') || url.startsWith('api/')){
        input = API_BASE + url.replace(/^\/?/,'/');
      }
    }catch(e){}
    return _origFetch(input, init);
  };

  /* Intercepta XMLHttpRequest para redirecionar /api/* */
  const _origOpen = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function(method, url){
    try{
      if(typeof url === 'string' && (url.startsWith('/api/') || url.startsWith('api/'))){
        arguments[1] = API_BASE + url.replace(/^\/?/,'/');
      }
    }catch(e){}
    return _origOpen.apply(this, arguments);
  };

  /* Detecta se está rodando como app desktop (file://) */
  window.GV_IS_DESKTOP = (location.protocol === 'file:');
  window.GV_ONLINE = navigator.onLine;

  window.addEventListener('online', ()=>{ window.GV_ONLINE = true; });
  window.addEventListener('offline', ()=>{ window.GV_ONLINE = false; });

  console.log('[GV Config] API Base:', API_BASE, '| Desktop:', window.GV_IS_DESKTOP);
})();
