// Ícone do app (favicon, Tela de Início e notificações): microfone nas cores do tema da festa.
import sharp from 'sharp';
import { PRESETS, PRESET_PADRAO } from './temas.js';

export const TAMANHOS_PNG = [180, 192, 512];

// Mesmo desenho do MICROFONE de public/comum.js, num quadrado arredondado com o fundo do palco.
export function svgIcone(tokens) {
  const { palco, 'destaque-palco': traco } = { ...PRESETS[PRESET_PADRAO].tokens, ...tokens };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">`
    + `<rect width="24" height="24" rx="5" fill="${palco}"/>`
    + `<g transform="translate(2.4 2.4) scale(0.8)" fill="none" stroke="${traco}" stroke-width="2" stroke-linecap="round">`
    + `<rect x="9" y="3" width="6" height="11" rx="3" fill="${traco}"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></g></svg>`;
}

// PNGs gerados uma vez por combinação de cores e tamanho.
const cache = new Map();
export function pngIcone(tokens, tamanho) {
  const svg = svgIcone(tokens);
  const chave = `${tamanho}:${svg}`;
  if (!cache.has(chave)) {
    cache.set(chave, sharp(Buffer.from(svg), { density: Math.ceil((72 * tamanho) / 24) }).resize(tamanho, tamanho).png().toBuffer());
  }
  return cache.get(chave);
}
