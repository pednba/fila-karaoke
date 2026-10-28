// Avisos por notificação no navegador do convidado (SPEC 9.3).
import { api } from './comum.js';

const DISPENSADO = 'avisos-dispensado';
const VISTOS = 'avisos-vistos';

const guardado = (chave) => { try { return localStorage.getItem(chave); } catch { return null; } };
const guardar = (chave, valor) => { try { localStorage.setItem(chave, valor); } catch {} };

export const suportaPush = (chave) => Boolean(chave) && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const ehIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const naTelaDeInicio = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const paraBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

let pediu = false;

// Precisa ser chamado direto no toque (antes de qualquer await), senão o navegador ignora.
export function pedirPermissao(chave) {
  if (!suportaPush(chave) || Notification.permission !== 'default') return Promise.resolve(suportaPush(chave) ? Notification.permission : 'indisponivel');
  pediu = true;
  return Notification.requestPermission();
}

// A permissão pode ser dada fora do app (sininho na barra do Chrome, configurações do site).
export function vigiarPermissao(aoMudar) {
  navigator.permissions?.query({ name: 'notifications' })
    .then((estado) => { estado.onchange = aoMudar; })
    .catch(() => {});
}

export async function inscrever(chave) {
  if (!suportaPush(chave) || Notification.permission !== 'granted') return false;
  const registro = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const inscricao = await registro.pushManager.getSubscription()
    ?? await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: paraBytes(chave) });
  await api('PUT', '/api/me/push', inscricao.toJSON());
  return true;
}

// Qual cartão mostrar na aba Fila: 'ativar', 'sininho', 'bloqueado', 'iphone' ou null.
export function cartaoDesejado(chave) {
  if (!chave || guardado(DISPENSADO)) return null;
  if (suportaPush(chave)) {
    if (Notification.permission === 'denied') return 'bloqueado';
    if (Notification.permission === 'default') return pediu ? 'sininho' : 'ativar';
    return null;
  }
  return ehIphone() && !naTelaDeInicio() ? 'iphone' : null;
}

export const dispensar = () => guardar(DISPENSADO, '1');

// App da Tela de Início: troca o token do endereço pelo cookie e limpa a barra.
export async function entrarPeloToken() {
  const token = new URLSearchParams(location.search).get('entrar');
  if (!token || !naTelaDeInicio()) return;
  try {
    await api('POST', '/api/entrar', { token });
  } catch {}
  history.replaceState(null, '', '/');
}

// No Safari do iPhone: o endereço passa a levar o token, para a Tela de Início abrir já com a pessoa.
let tokenPosto = false;
export async function prepararTelaDeInicio() {
  if (tokenPosto) return;
  tokenPosto = true;
  try {
    const { token } = await api('GET', '/api/me/entrada');
    history.replaceState(null, '', `/?entrar=${encodeURIComponent(token)}`);
  } catch {
    tokenPosto = false;
  }
}

// Mensagem de quem organiza: uma vez por aparelho.
const vistosNaMemoria = new Set();
export function avisoNovo(aviso) {
  if (!aviso) return false;
  const vistos = (guardado(VISTOS) ?? '').split(',');
  return !vistosNaMemoria.has(aviso.id) && !vistos.includes(String(aviso.id));
}
export function marcarVisto(aviso) {
  vistosNaMemoria.add(aviso.id);
  const vistos = (guardado(VISTOS) ?? '').split(',').filter(Boolean).slice(-20);
  guardar(VISTOS, [...vistos, aviso.id].join(','));
}
