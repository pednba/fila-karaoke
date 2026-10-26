import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { importarTexto } from '../importadores/pdf-lista-aparelho.js';
import { importarCsv } from '../importadores/csv.js';
import { importarArquivo, prepararMusicas, montarPrevia } from '../importadores/index.js';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = (nome) => path.join(raiz, 'test', 'fixtures', nome);
const ler = (nome) => fs.readFileSync(fixture(nome), 'utf8');

test('14. importador PDF: fixture com os casos da seção 5.2', () => {
  const { musicas, ignoradas, totalRodape } = importarTexto(ler('lista-aparelho.txt'));
  const porCod = Object.fromEntries(musicas.map((m) => [m.cod, m]));

  // Primeira linha (contato da locadora) nunca entra, mesmo parecendo uma música.
  assert.equal(porCod['12345'], undefined);
  assert.ok(!ignoradas.some((l) => l.includes('Locacoes')));

  // Linha normal.
  assert.deepEqual(porCod['4574'], {
    artista: 'Banda Exemplo', cod: '4574', titulo: 'DANCA DA NOITE', inicio: 'Vem dancar comigo ate o sol', idioma: 'EUA',
  });
  // Título colado ao início da letra.
  assert.equal(porCod['9380'].titulo, 'ACENDA A LUZ');
  assert.equal(porCod['9380'].inicio, 'Acenda a luz do meu caminho');
  // Letra isolada ("E ...") vai junto com o início da letra.
  assert.equal(porCod['1234'].titulo, 'JOSÉ');
  assert.equal(porCod['1234'].inicio, 'E agora, José, a festa acabou');
  // Título quebrado em linhas acima e abaixo.
  assert.equal(porCod['5555'].titulo, 'EU SEI QUE VOU TE AMAR');
  assert.equal(porCod['5555'].inicio, 'Eu sei que vou te amar');
  // Sem início da letra.
  assert.deepEqual([porCod['777'].titulo, porCod['777'].inicio], ['SO O TITULO', '']);
  assert.equal(porCod['20001'].idioma, 'JAP');

  // Cabeçalho repetido na 2ª página é ignorado sem virar "linha ignorada".
  assert.deepEqual(ignoradas, ['Pagina 1 de 2']);
  // Rodapé com total, e bate com o importado.
  assert.equal(totalRodape, 6);
  assert.equal(musicas.length, 6);
});

test('14b. porte JS = referência Python na mesma fixture', (t) => {
  let saida;
  try {
    execFileSync('python3', ['--version']);
  } catch {
    return t.skip('python3 indisponível');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-'));
  try {
    const json = path.join(tmp, 'ref.json');
    execFileSync('python3', [path.join(raiz, 'importadores', 'pdf_lista_aparelho.py'), fixture('lista-aparelho.txt'), json]);
    saida = JSON.parse(fs.readFileSync(json, 'utf8'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.deepEqual(importarTexto(ler('lista-aparelho.txt')).musicas, saida);
});

test('15. importador CSV: separador ";" com aspas, idioma vazio, código duplicado reportado', () => {
  const r = importarCsv(ler('catalogo-ponto-e-virgula.csv'));
  assert.equal(r.musicas.length, 3);
  assert.equal(r.musicas[1].titulo, 'ACENDA; A LUZ');
  assert.equal(r.musicas[1].idioma, 'BRA'); // vazio vira BRA
  assert.deepEqual(r.ignoradas, [';SEM CODIGO;Alguem;BRA;']);

  const previa = montarPrevia(r);
  assert.equal(previa.duplicados, 1);
  // Na gravação, o duplicado fica com a primeira ocorrência.
  const prontas = prepararMusicas(r.musicas);
  assert.equal(prontas.length, 2);
  assert.equal(prontas.find((m) => m.cod === '9380').artista, 'Cantor Ficticio');
});

test('15b. importador CSV: separador ",", BOM, sem coluna inicio, idioma em minúsculas', () => {
  const r = importarCsv(ler('catalogo-virgula.csv'));
  assert.deepEqual(r.musicas, [
    { artista: 'Dupla Imaginaria', cod: '1648', titulo: 'BOA NOITE, AMOR', inicio: '', idioma: 'BRA' },
    { artista: 'Grupo Oriental', cod: '20001', titulo: 'SAKURA NO UTA', inicio: '', idioma: 'JAP' },
    { artista: 'Artista Sem Letra', cod: '777', titulo: 'SO O TITULO', inicio: '', idioma: 'BRA' },
  ]);
  assert.deepEqual(r.ignoradas, []);
  assert.equal(montarPrevia(r).duplicados, 0);
});

test('15c. importador CSV: cabeçalho sem as colunas obrigatórias', () => {
  assert.throws(() => importarCsv('codigo,nome\n1,x\n'), { codigo: 'csv_cabecalho' });
});

test('busca: título + artista + início + código, minúsculas e sem acento', () => {
  const [m] = prepararMusicas([{ cod: '6842', titulo: 'À FLOR DA PELE', artista: 'Roupa Nova', inicio: 'Ando tão à flor', idioma: 'BRA' }]);
  assert.equal(m.busca, 'a flor da pele roupa nova ando tao a flor 6842');
});

test('prévia: totais por idioma e amostra de ignoradas', () => {
  const previa = montarPrevia(importarTexto(ler('lista-aparelho.txt')));
  assert.deepEqual(previa, {
    total: 6,
    por_idioma: { BRA: 4, EUA: 1, JAP: 1 },
    ignoradas: ['Pagina 1 de 2'],
    n_ignoradas: 1,
    duplicados: 0,
    total_rodape: 6,
  });
});

test('importarArquivo escolhe o CSV quando o arquivo não é PDF', async () => {
  const { musicas, previa } = await importarArquivo(path.join(raiz, 'data', 'catalogos', 'exemplo.csv'));
  assert.ok(musicas.length > 0);
  assert.equal(previa.total_rodape, null);
  assert.ok(musicas.every((m) => m.busca && m.idioma));
});
