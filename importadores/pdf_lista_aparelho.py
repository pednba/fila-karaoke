"""Importador de referencia: lista de musicas de aparelho de karaoke (PDF).

Uso:
    pdftotext -layout lista.pdf lista.txt
    python3 pdf_lista_aparelho.py lista.txt [saida.json]

Gera um JSON com cod, titulo, artista, inicio, idioma e imprime um relatorio.
Regras documentadas em SPEC.md, secao 5.2. O servidor usa o porte em JS
(pdf-lista-aparelho.js); este arquivo e a implementacao de referencia.
"""
import collections
import json
import re
import sys

LINHA = re.compile(r'^\s*(?P<artista>\S.*?)\s+(?P<cod>\d{3,6})\s+(?P<titulo>\S.*?)\s{2,}(?P<inicio>\S.*?)\s+(?P<idioma>[A-Z]{3})\s*$')
LINHA_CURTA = re.compile(r'^\s*(?P<artista>\S.*?)\s+(?P<cod>\d{3,6})\s+(?P<titulo>\S.*?)\s+(?P<idioma>[A-Z]{3})\s*$')
TOTAL = re.compile(r'Total de musicas listadas\s+(\d+)', re.I)
CABECALHO = ('APARELHO', 'AUDIOVISUAL', 'DE KARAOKE', 'LISTA DE MUSICAS', 'Ordem alfabetica', 'por interprete', 'codigo', 'Interprete')
MINUSCULA = re.compile(r'[a-zà-ÿ]')


def eh_quebra_de_titulo(s):
    """Linha recuada so com texto em maiusculas: pedaco de titulo quebrado."""
    t = s.strip()
    return s.startswith('   ') and t and not MINUSCULA.search(t) and not re.search(r'\d{3,}', t)


def separar_titulo_inicio(r):
    """Titulo (maiusculas) colado ao inicio da letra com um espaco so."""
    w = r['titulo'].split(' ')
    for i, x in enumerate(w):
        if MINUSCULA.search(x):
            if i == 0:
                # titulo inteiro ficou em outras linhas; o que veio e a letra
                r['inicio'], r['titulo'] = r['titulo'], ''
                return
            if i > 1 and len(w[i - 1]) == 1:
                i -= 1
            r['titulo'], r['inicio'] = ' '.join(w[:i]), ' '.join(w[i:])
            return


def importar(caminho):
    musicas, ignoradas, quebras = [], [], []
    total_rodape = None
    sem_titulo = None
    for n, linha in enumerate(open(caminho, encoding='utf-8')):
        s = linha.rstrip('\n').replace('\f', '')
        if n == 0 or not s.strip():
            continue  # 1a linha costuma ter o contato da locadora: nunca importar
        t = TOTAL.search(s)
        if t:
            total_rodape = int(t.group(1))
            continue
        if any(k in s for k in CABECALHO):
            continue
        m = LINHA.match(s) or LINHA_CURTA.match(s)
        if m:
            r = {k: v.strip() for k, v in m.groupdict().items()}
            r.setdefault('inicio', '')
            if not r['inicio'] or MINUSCULA.search(r['titulo'].split(' ')[0]):
                separar_titulo_inicio(r)
            if not r['titulo']:
                r['titulo'] = ' '.join(quebras)
                sem_titulo = r
            quebras = []
            musicas.append(r)
        elif eh_quebra_de_titulo(s):
            if sem_titulo is not None:
                sem_titulo['titulo'] = (sem_titulo['titulo'] + ' ' + s.strip()).strip()
                sem_titulo = None
            else:
                quebras.append(s.strip())
        else:
            ignoradas.append(s)
    return musicas, ignoradas, total_rodape


if __name__ == '__main__':
    musicas, ignoradas, total = importar(sys.argv[1])
    saida = sys.argv[2] if len(sys.argv) > 2 else 'catalogo.json'
    cods = collections.Counter(r['cod'] for r in musicas)
    print(f'{len(musicas)} musicas · {len(ignoradas)} linhas ignoradas · total no rodape: {total}')
    if total is not None and total != len(musicas):
        print('ATENCAO: total importado difere do rodape')
    print('codigos duplicados:', sum(1 for c in cods.values() if c > 1))
    print('por idioma:', dict(collections.Counter(r['idioma'] for r in musicas).most_common()))
    print('sem titulo:', sum(1 for r in musicas if not r['titulo']))
    for b in ignoradas[:10]:
        print('IGNORADA:', repr(b))
    json.dump(musicas, open(saida, 'w', encoding='utf-8'), ensure_ascii=False)
