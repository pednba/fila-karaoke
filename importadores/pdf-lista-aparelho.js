// Importador PDF "lista de aparelho" (SPEC 5.2).
// Porte de pdf_lista_aparelho.py: mesmo comportamento, linha a linha. Alterar os dois juntos.
import { execFile } from 'node:child_process';

const LINHA = /^\s*(?<artista>\S.*?)\s+(?<cod>\d{3,6})\s+(?<titulo>\S.*?)\s{2,}(?<inicio>\S.*?)\s+(?<idioma>[A-Z]{3})\s*$/;
const LINHA_CURTA = /^\s*(?<artista>\S.*?)\s+(?<cod>\d{3,6})\s+(?<titulo>\S.*?)\s+(?<idioma>[A-Z]{3})\s*$/;
const TOTAL = /Total de musicas listadas\s+(\d+)/i;
const CABECALHO = ['APARELHO', 'AUDIOVISUAL', 'DE KARAOKE', 'LISTA DE MUSICAS', 'Ordem alfabetica', 'por interprete', 'codigo', 'Interprete'];
const MINUSCULA = /[a-zà-ÿ]/;

// Linha recuada só com texto em maiúsculas: pedaço de título quebrado.
function ehQuebraDeTitulo(s) {
  const t = s.trim();
  return s.startsWith('   ') && t !== '' && !MINUSCULA.test(t) && !/\d{3,}/.test(t);
}

// Título (maiúsculas) colado ao início da letra com um espaço só.
function separarTituloInicio(r) {
  const w = r.titulo.split(' ');
  for (let i = 0; i < w.length; i++) {
    if (!MINUSCULA.test(w[i])) continue;
    if (i === 0) {
      // título inteiro ficou em outras linhas; o que veio é a letra
      r.inicio = r.titulo;
      r.titulo = '';
      return;
    }
    if (i > 1 && [...w[i - 1]].length === 1) i -= 1;
    r.titulo = w.slice(0, i).join(' ');
    r.inicio = w.slice(i).join(' ');
    return;
  }
}

// Recebe a saída de `pdftotext -layout`. Devolve { musicas, ignoradas, totalRodape }.
export function importarTexto(texto) {
  const musicas = [];
  const ignoradas = [];
  let quebras = [];
  let totalRodape = null;
  let semTitulo = null;

  const linhas = texto.split(/\r\n|\r|\n/);
  if (linhas.at(-1) === '') linhas.pop();

  linhas.forEach((linha, n) => {
    const s = linha.replaceAll('\f', '');
    if (n === 0 || !s.trim()) return; // 1ª linha costuma ter o contato da locadora: nunca importar
    const t = TOTAL.exec(s);
    if (t) {
      totalRodape = Number(t[1]);
      return;
    }
    if (CABECALHO.some((k) => s.includes(k))) return;

    const m = LINHA.exec(s) || LINHA_CURTA.exec(s);
    if (m) {
      const g = m.groups;
      const r = { artista: g.artista.trim(), cod: g.cod.trim(), titulo: g.titulo.trim(), inicio: (g.inicio ?? '').trim(), idioma: g.idioma.trim() };
      if (!r.inicio || MINUSCULA.test(r.titulo.split(' ')[0])) separarTituloInicio(r);
      if (!r.titulo) {
        r.titulo = quebras.join(' ');
        semTitulo = r;
      }
      quebras = [];
      musicas.push(r);
    } else if (ehQuebraDeTitulo(s)) {
      if (semTitulo !== null) {
        semTitulo.titulo = (semTitulo.titulo + ' ' + s.trim()).trim();
        semTitulo = null;
      } else {
        quebras.push(s.trim());
      }
    } else {
      ignoradas.push(s);
    }
  });

  return { musicas, ignoradas, totalRodape };
}

// Extrai o texto do PDF com `pdftotext -layout arquivo.pdf -` (pacote poppler-utils).
export function extrairTexto(caminhoPdf) {
  return new Promise((resolve, reject) => {
    execFile('pdftotext', ['-layout', caminhoPdf, '-'], { maxBuffer: 64 * 1024 * 1024 }, (erro, stdout) => {
      if (!erro) return resolve(stdout);
      if (erro.code === 'ENOENT') {
        return reject(Object.assign(new Error('Instale o poppler-utils no servidor para importar PDF.'), { codigo: 'pdftotext_ausente' }));
      }
      reject(Object.assign(new Error('Não foi possível ler o PDF.'), { codigo: 'pdf_invalido', causa: erro }));
    });
  });
}
