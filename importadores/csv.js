// Importador CSV (SPEC 5.3): UTF-8, cabeçalho obrigatório, separador ',' ou ';'.
// Colunas: cod,titulo,artista,idioma,inicio (inicio opcional; idioma vazio = BRA).
import { normalizar } from '../texto.js';

const OBRIGATORIAS = ['cod', 'titulo', 'artista'];

function detectarSeparador(texto) {
  const cabecalho = texto.split(/\r?\n/, 1)[0];
  const contar = (c) => cabecalho.split(c).length - 1;
  return contar(';') > contar(',') ? ';' : ',';
}

// Divide o texto em linhas de campos, respeitando aspas ("a, b" e "" para aspas literais).
function lerRegistros(texto, sep) {
  const registros = [];
  let campos = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') {
        aspas = false;
      } else {
        campo += c;
      }
    } else if (c === '"') {
      aspas = true;
    } else if (c === sep) {
      campos.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      campos.push(campo);
      registros.push(campos);
      campos = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || campos.length) {
    campos.push(campo);
    registros.push(campos);
  }
  return registros;
}

// Devolve { musicas, ignoradas, totalRodape } no mesmo formato do importador PDF.
export function importarCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const sep = detectarSeparador(texto);
  const [cabecalho = [], ...linhas] = lerRegistros(texto, sep);
  const colunas = cabecalho.map(normalizar);
  const faltando = OBRIGATORIAS.filter((c) => !colunas.includes(c));
  if (faltando.length) {
    throw Object.assign(new Error(`O cabeçalho do CSV precisa ter as colunas ${OBRIGATORIAS.join(', ')}.`), { codigo: 'csv_cabecalho' });
  }
  const pos = Object.fromEntries(colunas.map((c, i) => [c, i]));
  const valor = (campos, col) => (pos[col] === undefined ? '' : (campos[pos[col]] ?? '').trim());

  const musicas = [];
  const ignoradas = [];
  for (const campos of linhas) {
    if (campos.every((c) => !c.trim())) continue;
    const r = {
      artista: valor(campos, 'artista'),
      cod: valor(campos, 'cod'),
      titulo: valor(campos, 'titulo'),
      inicio: valor(campos, 'inicio'),
      idioma: valor(campos, 'idioma').toUpperCase() || 'BRA',
    };
    if (!/^\d+$/.test(r.cod) || !r.titulo || !r.artista) {
      ignoradas.push(campos.join(sep));
      continue;
    }
    musicas.push(r);
  }
  return { musicas, ignoradas, totalRodape: null };
}
