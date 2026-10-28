// Normalização de texto para busca e nomes: minúsculas, sem acento, espaços simples.
export function normalizar(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalização só da busca no catálogo (SPEC 5.4): além de normalizar, iguala grafias
// do mesmo nome. "Fábio Jr." = "Fabio Junior"; "Sandy & Junior" = "Sandy e Júnior";
// "Rock'n'Roll" = "rock and roll"; "Barretto" = "Barreto".
const CONECTIVOS = new Set(['e', 'and', 'y', 'n']);
const SINONIMOS = { jr: 'junior', ft: 'feat', featuring: 'feat' };

export function normalizarBusca(s) {
  return normalizar(s)
    .replace(/\s*['’]n['’]?(?![\p{L}\p{N}])\s*/gu, ' e ') // rock'n'roll, rock 'n' roll
    .replace(/(^|\s)n['’](?=\s|$)/gu, '$1e') // rock n' roll
    .replace(/['’`´]/g, '') // apóstrofo cola a palavra: Destiny's → destinys
    .split(/[^\p{L}\p{N}]+/u)
    .map((p) => SINONIMOS[p] ?? p)
    .filter((p) => p && !CONECTIVOS.has(p))
    .map((p) => p.replace(/(\p{L})\1+/gu, '$1'))
    .join(' ');
}

// Tamanho como a pessoa vê (SPEC 9.3): cada emoji, mesmo composto (❤️, 👍🏽), conta um caractere.
const grafemas = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });
export function contarCaracteres(s) {
  let n = 0;
  for (const _ of grafemas.segment(String(s ?? ''))) n++;
  return n;
}
