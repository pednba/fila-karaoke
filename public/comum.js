// Utilitários das três telas: API, polling, escape, ícones e aviso flutuante.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Erro da API (SPEC 10): { erro, mensagem, ...dados }.
export class ErroApi extends Error {
  constructor(status, corpo) {
    super(corpo?.mensagem || 'Não deu certo. Tente de novo.');
    this.status = status;
    this.codigo = corpo?.erro ?? 'erro';
    this.dados = corpo ?? {};
  }
}

let cabecalhosExtras = {};
export function definirCabecalhos(c) {
  cabecalhosExtras = c;
}

export async function api(metodo, url, corpo) {
  const opcoes = { method: metodo, headers: { ...cabecalhosExtras }, credentials: 'same-origin' };
  if (corpo instanceof FormData) opcoes.body = corpo;
  else if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  let res;
  try {
    res = await fetch(url, opcoes);
  } catch {
    throw new ErroApi(0, { erro: 'sem_conexao', mensagem: 'Sem conexão. Confira a internet e tente de novo.' });
  }
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ErroApi(res.status, json);
  return json;
}

// Polling (SPEC 10.1): a cada 4 s com If-None-Match; pausa com a aba escondida.
export function vigiar(url, aoMudar, { intervalo = 4000, aoErro } = {}) {
  let etag = null;
  let timer = null;
  let rodando = false;
  let repetir = false;
  async function buscar() {
    clearTimeout(timer);
    if (rodando) {
      repetir = true;
      return;
    }
    rodando = true;
    try {
      const res = await fetch(url, { headers: etag ? { 'If-None-Match': etag } : {}, credentials: 'same-origin', cache: 'no-store' });
      if (res.status === 200) {
        etag = res.headers.get('ETag');
        await aoMudar(await res.json());
      } else if (res.status !== 304) {
        aoErro?.(new ErroApi(res.status, await res.json().catch(() => null)));
      }
    } catch (e) {
      aoErro?.(e);
    } finally {
      rodando = false;
      if (repetir) {
        repetir = false;
        buscar();
      } else if (!document.hidden) timer = setTimeout(buscar, intervalo);
    }
  }
  document.addEventListener('visibilitychange', () => {
    clearTimeout(timer);
    if (!document.hidden) buscar();
  });
  buscar();
  return {
    // Força uma busca completa (depois de uma ação do próprio usuário).
    agora() {
      etag = null;
      return buscar();
    },
  };
}

// Ícones do motivo decorativo; cada preset define o seu (festa.tema.icone).
const ICONES = {
  coracao: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  estrela: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z"/>',
  sol: '<path d="M11 1h2v4h-2zM11 19h2v4h-2zM1 11h4v2H1zM19 11h4v2h-4zM4.2 5.6l1.4-1.4 2.8 2.8-1.4 1.4zM15.6 17l1.4-1.4 2.8 2.8-1.4 1.4zM4.2 18.4l2.8-2.8 1.4 1.4-2.8 2.8zM15.6 7l2.8-2.8 1.4 1.4-2.8 2.8zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z"/>',
  nota: '<path d="M19 3v12.5a3.5 3.5 0 1 1-2-3.16V7.3l-8 1.6v8.6A3.5 3.5 0 1 1 7 14.34V5z"/>',
};
let iconeAtual = 'coracao';
export function definirIcone(nome) {
  if (ICONES[nome]) iconeAtual = nome;
}
export const icone = (nome = iconeAtual) => `<svg class="icone" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nome] ?? ICONES.coracao}</svg>`;
export const filete = () => `<div class="filete">${icone()}</div>`;
export const MICROFONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
export const LUPA = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>';

// Aviso flutuante com fechamento automático.
let timerAviso = null;
export function avisar(texto, { baixo = false } = {}) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.classList.toggle('toast-baixo', baixo);
  el.innerHTML = `${icone()}<span class="cresce">${esc(texto)}</span><button type="button" aria-label="Fechar aviso">×</button>`;
  el.hidden = false;
  el.querySelector('button').onclick = () => (el.hidden = true);
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => (el.hidden = true), 4500);
}

export const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// "Karaokê da Helena" + "Helena" → ["Karaokê da", "Helena"] para o cabeçalho.
export function dividirTitulo(titulo, nome) {
  const t = String(titulo ?? '').trim();
  const n = String(nome ?? '').trim();
  if (n && t.toLowerCase().endsWith(n.toLowerCase()) && t.length > n.length) {
    return [t.slice(0, t.length - n.length).trim(), t.slice(t.length - n.length)];
  }
  return [t, n];
}

export function formatarDuracao(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// Recarrega /tema.css depois que o visual muda.
export function recarregarTema() {
  const link = $('link[href^="/tema.css"]');
  if (link) link.href = `/tema.css?v=${Date.now()}`;
}
