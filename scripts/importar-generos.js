// Grava uma classificação de gênero feita fora do app (SPEC 5.7).
// Uso: node scripts/importar-generos.js <arquivo.csv>   (CSV "artista;genero;confianca")
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { abrirBanco } from '../db.js';
import { gravarGeneros, lerCsvGeneros, resumoGeneros } from '../generos.js';

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('Uso: node scripts/importar-generos.js <arquivo.csv>');
  process.exit(1);
}
const { itens, ignoradas } = lerCsvGeneros(fs.readFileSync(arquivo, 'utf8'));
const db = abrirBanco(path.join(process.env.DATA_DIR || './data', 'karaoke.db'));
gravarGeneros(db, itens, 'importado');
const r = resumoGeneros(db);
const pct = (x) => `${Math.round(x * 100)}%`;
console.log(`${itens.length} artistas gravados, ${ignoradas} linhas ignoradas.`);
console.log(`Cobertura: ${pct(r.cobertura)} das ${r.musicas} músicas. Precisão estimada: ${r.precisao_estimada == null ? '–' : pct(r.precisao_estimada)}.`);
console.log(`Artistas sem classificação: ${r.pendentes}. O filtro liga no setup (passo 4).`);
db.close();
