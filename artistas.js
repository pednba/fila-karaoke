// Navegação por artista e sugestão "Você pode gostar" (SPEC 5.5 e 5.6).
import { normalizarBusca } from './texto.js';

// "Bruninho e Davi - Gusttavo Lima" tem dois participantes. O PDF corta nomes longos
// com "..." ("Sandy e Junior - Chitã..."): parte cortada não vira artista.
export function participantes(artista) {
  return String(artista ?? '')
    .split(' - ')
    .map((p) => p.trim())
    .filter((p) => p && !/(\.\.\.|…)$/.test(p));
}

// Chaves de artista no formato "|chave1|chave2|", para filtrar no SQL com LIKE.
export function chavesArtista(artista) {
  const chaves = participantes(artista).map(normalizarBusca).filter(Boolean);
  return chaves.length ? `|${chaves.join('|')}|` : '';
}

// Chave do primeiro participante: é ele que dá o gênero da música (SPEC 5.7).
export function artistaPrincipal(artista) {
  const [primeiro] = participantes(artista);
  return primeiro ? normalizarBusca(primeiro) : '';
}

// Lista A–Z: [{ nome, chave, total }]. O nome exibido é a grafia mais frequente.
// Com gênero, conta só as músicas daquele gênero, que vem do artista principal (SPEC 5.7).
export function listarArtistas(db, { filtro = '', genero = '' } = {}) {
  const idioma = filtro === 'nacionais' ? "AND idioma = 'BRA'" : filtro === 'internacionais' ? "AND idioma <> 'BRA'" : '';
  const doGenero = genero ? 'AND artista_principal(artista) IN (SELECT chave FROM generos_artista WHERE genero = @genero)' : '';
  const linhas = db.prepare(`SELECT artista, COUNT(*) AS n FROM musicas WHERE fora_do_catalogo = 0 ${idioma} ${doGenero} GROUP BY artista`).all(genero ? { genero } : {});
  const porChave = new Map();
  for (const { artista, n } of linhas) {
    for (const nome of new Set(participantes(artista))) {
      const chave = normalizarBusca(nome);
      if (!chave) continue;
      const a = porChave.get(chave) ?? { chave, total: 0, grafias: new Map() };
      a.total += n;
      a.grafias.set(nome, (a.grafias.get(nome) ?? 0) + n);
      porChave.set(chave, a);
    }
  }
  return [...porChave.values()]
    .map(({ chave, total, grafias }) => ({ nome: [...grafias].sort((x, y) => y[1] - x[1])[0][0], chave, total }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));
}

// Uma música de um artista que a pessoa já cantou e que ela ainda não pediu.
// Com vários artistas, alterna entre eles a cada pedido novo dela.
export function sugerir(db, pessoa_id) {
  const cantadas = db.prepare(`
    SELECT m.artista FROM pedidos p JOIN musicas m ON m.cod = p.musica_cod
     WHERE p.pessoa_id = ? AND p.status = 'cantou' ORDER BY p.finalizado_em DESC, p.id DESC`).pluck().all(pessoa_id);
  const artistas = [];
  for (const artista of cantadas) {
    for (const nome of participantes(artista)) {
      const chave = normalizarBusca(nome);
      if (chave && !artistas.some((a) => a.chave === chave)) artistas.push({ nome, chave });
    }
  }
  if (!artistas.length) return null;

  const pedidos = db.prepare('SELECT COUNT(*) FROM pedidos WHERE pessoa_id = ?').pluck().get(pessoa_id);
  const candidatas = db.prepare(`
    SELECT cod, titulo, artista, inicio, idioma FROM musicas
     WHERE fora_do_catalogo = 0 AND artistas_busca(artista) LIKE ?
       AND cod NOT IN (SELECT musica_cod FROM pedidos WHERE pessoa_id = ?)
     ORDER BY cod`);
  for (let i = 0; i < artistas.length; i++) {
    const a = artistas[(pedidos + i) % artistas.length];
    const lista = candidatas.all(`%|${a.chave}|%`, pessoa_id);
    if (!lista.length) continue;
    // Varia entre pessoas e entre pedidos, mas não muda a cada atualização da tela.
    const musica = lista[espalhar(`${pessoa_id}:${pedidos}`) % lista.length];
    return { musica, artista: a.nome };
  }
  return null;
}

function espalhar(texto) {
  let h = 0;
  for (const c of texto) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return h;
}
