// Temas visuais (SPEC seção 11): presets, cor de destaque e validação de contraste.
import { erro } from './erros.js';

export const FONTES = ['Great Vibes', 'Playfair Display', 'Pacifico', 'Bebas Neue'];
export const FONTE_BASE = 'Montserrat';
export const CONTRASTE_MINIMO = 4.5;

// Os valores da tabela da seção 11 vêm da spec. borda, texto-palco(-2) e alerta(-fundo)
// do Dourado clássico vêm de docs/design/; nos outros presets foram escolhidos aqui.
export const PRESETS = {
  dourado: {
    nome: 'Dourado clássico',
    fonte: 'Great Vibes',
    icone: 'coracao',
    tokens: {
      fundo: '#F7F0E1', superficie: '#FFFBF2', borda: '#E3D5B5', decor: '#C49A3C',
      palco: '#16130F', 'destaque-palco': '#D9B45A', texto: '#1A1611', 'texto-2': '#6B5D45',
      'texto-palco': '#F7F0E1', 'texto-palco-2': '#CFC4AE', alerta: '#7A2A1E', 'alerta-fundo': '#F3D9D2',
    },
  },
  neon: {
    nome: 'Noite neon',
    fonte: 'Bebas Neue',
    icone: 'estrela',
    tokens: {
      fundo: '#121018', superficie: '#1D1A26', borda: '#2E2A3B', decor: '#7C5CFF',
      palco: '#000000', 'destaque-palco': '#3EE6C1', texto: '#F2F0F7', 'texto-2': '#A9A3B5',
      'texto-palco': '#F2F0F7', 'texto-palco-2': '#A9A3B5', alerta: '#FF9C94', 'alerta-fundo': '#3A1A22',
    },
  },
  tropical: {
    nome: 'Tropical',
    fonte: 'Pacifico',
    icone: 'sol',
    tokens: {
      fundo: '#FFF6EC', superficie: '#FFFFFF', borda: '#F2DDC6', decor: '#FF7A59',
      palco: '#0F3D3E', 'destaque-palco': '#FFD166', texto: '#1C2B2B', 'texto-2': '#4F6162',
      'texto-palco': '#FFF6EC', 'texto-palco-2': '#BFD6D3', alerta: '#9A2B16', 'alerta-fundo': '#FFE2D8',
    },
  },
  minimalista: {
    nome: 'Minimalista',
    fonte: 'Playfair Display',
    icone: 'nota',
    tokens: {
      fundo: '#FFFFFF', superficie: '#F6F6F6', borda: '#E2E2E2', decor: '#111111',
      palco: '#111111', 'destaque-palco': '#FFFFFF', texto: '#111111', 'texto-2': '#5C5C5C',
      'texto-palco': '#FFFFFF', 'texto-palco-2': '#BDBDBD', alerta: '#A11D1D', 'alerta-fundo': '#FBE4E4',
    },
  },
};

export const PRESET_PADRAO = 'dourado';

const HEX = /^#[0-9a-f]{6}$/i;

function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Razão de contraste WCAG entre duas cores #RRGGBB.
export function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Monta o tema salvo em festa.tema. A cor de destaque substitui --decor e --destaque-palco.
export function montarTema({ preset = PRESET_PADRAO, destaque = null, fonte = null } = {}) {
  const base = PRESETS[preset];
  if (!base) throw erro(422, 'preset_invalido', 'Escolha um dos temas disponíveis.');
  if (fonte && !FONTES.includes(fonte)) throw erro(422, 'fonte_invalida', 'Escolha uma das fontes disponíveis.');
  if (destaque && !HEX.test(destaque)) throw erro(422, 'cor_invalida', 'A cor de destaque deve estar no formato #RRGGBB.');

  const tokens = { ...base.tokens };
  if (destaque) {
    tokens.decor = destaque.toUpperCase();
    tokens['destaque-palco'] = destaque.toUpperCase();
  }
  const pares = [
    ['texto-2', 'fundo'],
    ['destaque-palco', 'palco'],
  ];
  for (const [frente, fundo] of pares) {
    const razao = contraste(tokens[frente], tokens[fundo]);
    if (razao < CONTRASTE_MINIMO) {
      throw erro(422, 'contraste_insuficiente', `Essa cor fica pouco legível sobre o fundo do palco (contraste ${razao.toFixed(1)}:1, mínimo ${CONTRASTE_MINIMO}:1). Escolha uma cor mais clara ou mais forte.`, { razao });
    }
  }
  return { preset, destaque: destaque ? destaque.toUpperCase() : null, fonte: fonte || base.fonte, icone: base.icone, tokens };
}

// Folha com todas as fontes, servidas pelo próprio app (SPEC 11): o navegador só baixa as usadas.
export const URL_FONTES = '/fontes/fontes.css';

// Variáveis CSS para :root a partir de festa.tema.
export function cssDoTema(tema) {
  const linhas = Object.entries(tema.tokens).map(([k, v]) => `--${k}: ${v};`);
  linhas.push(`--fonte-destaque: '${tema.fonte}', cursive;`, `--fonte-base: '${FONTE_BASE}', system-ui, sans-serif;`);
  return `:root { ${linhas.join(' ')} }`;
}
