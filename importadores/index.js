// Escolhe o importador pelo tipo de arquivo e monta a prévia do passo 4 do setup (SPEC 4.2).
import fs from 'node:fs';
import { normalizarBusca } from '../texto.js';
import { importarTexto, extrairTexto } from './pdf-lista-aparelho.js';
import { importarCsv } from './csv.js';

const AMOSTRA_IGNORADAS = 20;

function ehPdf(caminho) {
  const fd = fs.openSync(caminho, 'r');
  try {
    const cabeca = Buffer.alloc(5);
    fs.readSync(fd, cabeca, 0, 5, 0);
    return cabeca.toString('latin1') === '%PDF-';
  } finally {
    fs.closeSync(fd);
  }
}

// Linhas prontas para a tabela musicas: código duplicado fica com a primeira ocorrência.
export function prepararMusicas(musicas) {
  const vistos = new Set();
  const saida = [];
  for (const m of musicas) {
    if (vistos.has(m.cod)) continue;
    vistos.add(m.cod);
    saida.push({ ...m, busca: normalizarBusca([m.titulo, m.artista, m.inicio, m.cod].join(' ')) });
  }
  return saida;
}

export function montarPrevia({ musicas, ignoradas, totalRodape }) {
  const porIdioma = {};
  const porCod = {};
  for (const m of musicas) {
    porIdioma[m.idioma] = (porIdioma[m.idioma] ?? 0) + 1;
    porCod[m.cod] = (porCod[m.cod] ?? 0) + 1;
  }
  return {
    total: musicas.length,
    por_idioma: Object.fromEntries(Object.entries(porIdioma).sort((a, b) => b[1] - a[1])),
    ignoradas: ignoradas.slice(0, AMOSTRA_IGNORADAS),
    n_ignoradas: ignoradas.length,
    duplicados: Object.values(porCod).filter((n) => n > 1).length,
    total_rodape: totalRodape,
  };
}

// Importa um arquivo enviado (PDF da lista do aparelho ou CSV).
// Devolve { musicas, previa }: musicas já sem duplicados e com `busca`.
export async function importarArquivo(caminho) {
  const resultado = ehPdf(caminho) ? importarTexto(await extrairTexto(caminho)) : importarCsv(fs.readFileSync(caminho, 'utf8'));
  return { musicas: prepararMusicas(resultado.musicas), previa: montarPrevia(resultado) };
}
