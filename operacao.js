// Operação da fila e da votação sobre o banco (SPEC 8 e 9). As regras ficam em fila.js e votos.js;
// aqui só se lê o estado, aplica a decisão e grava. Funções que escrevem devem rodar dentro de `escrever`.
import { ordenar, mover, decidirPulo, validarPedido, liberadoParaCantou, MINUTOS_PARA_AVANCAR } from './fila.js';
import { validarVoto, votacoesAFechar, resumoAberta, rankingPerformances, rankingPessoas } from './votos.js';
import { gravarMeta, lerMeta } from './db.js';
import { lerFesta } from './festa.js';
import { erro } from './erros.js';

const MENSAGENS = {
  ja_pedida: 'Você já pediu essa música.',
  limite_atingido: 'Você chegou ao limite de pedidos na fila. Espere cantar ou cancele um.',
  votacao_fechada: 'A votação dessa performance já fechou.',
  voto_proprio: 'Não dá para votar na própria performance.',
  nota_invalida: 'A nota vai de 0 a 10.',
};

const COM_MUSICA = `
  SELECT p.*, m.titulo, m.artista, m.inicio, m.idioma, s.nome AS cantor, s.vip
    FROM pedidos p
    JOIN musicas m ON m.cod = p.musica_cod
    JOIN pessoas s ON s.id = p.pessoa_id`;

export function pedidoNaVez(db) {
  return db.prepare(`${COM_MUSICA} WHERE p.status = 'na_vez'`).get() ?? null;
}

export function lerPedido(db, id) {
  return db.prepare(`${COM_MUSICA} WHERE p.id = ?`).get(id) ?? null;
}

// Pendentes na ordem da fila (SPEC 8.2), com os dados da música e do cantor.
export function filaOrdenada(db, festa = lerFesta(db)) {
  const pendentes = db.prepare(`${COM_MUSICA} WHERE p.status = 'pendente'`).all();
  const cantadas = Object.fromEntries(
    db.prepare("SELECT pessoa_id, COUNT(*) AS n FROM pedidos WHERE status = 'cantou' GROUP BY pessoa_id").all()
      .map((r) => [r.pessoa_id, r.n])
  );
  const vips = festa.regras.vip ? new Set(db.prepare('SELECT id FROM pessoas WHERE vip = 1').pluck().all()) : new Set();
  return ordenar({
    pendentes,
    cantadas,
    cantorDaVez: pedidoNaVez(db)?.pessoa_id ?? null,
    ultimoCantor: lerMeta(db, 'ultimo_cantor_id'),
    vips,
  });
}

// SPEC 8.3: sem ninguém no palco, o primeiro da fila vira na_vez e a votação dele abre (SPEC 9).
export function avancar(db, festa = lerFesta(db)) {
  if (pedidoNaVez(db)) return null;
  const proximo = filaOrdenada(db, festa)[0];
  if (!proximo) return null;
  db.prepare(`
    UPDATE pedidos SET status = 'na_vez', ordem_manual = NULL, na_vez_em = datetime('now'), votacao_aberta = ?
     WHERE id = ?`).run(festa.regras.votacao ? 1 : 0, proximo.id);
  return proximo.id;
}

export function exigirAberta(festa) {
  if (festa.status !== 'aberta') {
    throw erro(403, 'festa_fechada', festa.status === 'encerrada' ? 'A festa foi encerrada.' : 'A festa ainda não começou.');
  }
}

// Pedir (SPEC 8.4). Devolve o pedido criado e a posição estimada (0 = já está no palco).
export function pedir(db, { pessoa_id, musica_cod, agora = Date.now() }) {
  const festa = lerFesta(db);
  exigirAberta(festa);
  const cod = String(musica_cod ?? '').trim();
  const musica = db.prepare('SELECT cod FROM musicas WHERE cod = ? AND fora_do_catalogo = 0').get(cod);
  if (!musica) throw erro(404, 'musica_inexistente', 'Essa música não está no catálogo.');

  const meusPedidos = db.prepare('SELECT musica_cod, status FROM pedidos WHERE pessoa_id = ?').all(pessoa_id);
  const problema = validarPedido({ meusPedidos, musica_cod: cod, limite: festa.regras.pendentes_por_pessoa });
  if (problema) throw erro(409, problema, MENSAGENS[problema]);

  const { lastInsertRowid: id } = db
    .prepare("INSERT INTO pedidos (pessoa_id, musica_cod, status, t_fila) VALUES (?, ?, 'pendente', ?)")
    .run(pessoa_id, cod, agora);
  avancar(db, festa);
  return { pedido: lerPedido(db, id), posicao_estimada: posicao(db, Number(id), festa) };
}

// Posição na fila: 0 no palco, 1 = próximo a cantar, ...; null se o pedido não está ativo.
export function posicao(db, id, festa) {
  if (pedidoNaVez(db)?.id === id) return 0;
  const i = filaOrdenada(db, festa).findIndex((p) => p.id === id);
  return i === -1 ? null : i + 1;
}

// Cancelar (SPEC 8.4): só o dono, só pendente.
export function cancelar(db, { id, pessoa_id }) {
  exigirAberta(lerFesta(db));
  const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(id);
  if (!pedido || pedido.pessoa_id !== pessoa_id) throw erro(404, 'pedido_inexistente', 'Pedido não encontrado.');
  if (pedido.status !== 'pendente') throw erro(409, 'pedido_nao_pendente', 'Só dá para cancelar pedido que ainda está na fila.');
  db.prepare("UPDATE pedidos SET status = 'cancelado', finalizado_em = datetime('now') WHERE id = ?").run(id);
}

// Cantou (SPEC 8.4 e 9): fecha a votação da performance anterior, mantém a deste pedido aberta e avança.
// pessoa_id null = admin.
// pessoa_id null = admin. Convidado: regra de liberadoParaCantou.
export function cantou(db, { id = null, pessoa_id = null, agora = Date.now() }) {
  const festa = lerFesta(db);
  exigirAberta(festa);
  const atual = pedidoNaVez(db);
  if (!atual) throw erro(409, 'palco_vazio', 'Não há ninguém no palco.');
  if (id != null && atual.id !== id) throw erro(409, 'nao_esta_na_vez', 'Esse pedido não está no palco.');
  if (pessoa_id != null) {
    const desde = liberadoParaCantou({ pessoa_id, atual, fila: filaOrdenada(db, festa) });
    if (desde == null) throw erro(403, 'pedido_alheio', 'Só quem está no palco ou esperando na fila pode confirmar.');
    if (agora < desde) throw erro(403, 'cedo_demais', `Espere ${MINUTOS_PARA_AVANCAR} minutos de música antes de avançar a fila.`);
  }

  db.prepare("UPDATE pedidos SET status = 'cantou', finalizado_em = datetime('now') WHERE id = ?").run(atual.id);
  gravarMeta(db, 'ultimo_cantor_id', atual.pessoa_id);
  const abertas = db.prepare('SELECT id FROM pedidos WHERE votacao_aberta = 1').pluck().all();
  const fechar = db.prepare('UPDATE pedidos SET votacao_aberta = 0 WHERE id = ?');
  for (const pid of votacoesAFechar(abertas, atual.id)) fechar.run(pid);
  avancar(db, festa);
  return atual.id;
}

// Pular ausente (SPEC 8.4): o pedido perde os votos e volta ao fim da rodada, ou sai no limite.
export function pular(db, { agora = Date.now() } = {}) {
  const festa = lerFesta(db);
  exigirAberta(festa);
  const atual = pedidoNaVez(db);
  if (!atual) throw erro(409, 'palco_vazio', 'Não há ninguém no palco.');

  const decisao = decidirPulo(atual, festa.regras.pulos_ate_sair, agora);
  db.prepare('DELETE FROM votos WHERE pedido_id = ?').run(atual.id);
  if (decisao.status === 'removido') {
    db.prepare("UPDATE pedidos SET status = 'removido', pulos = ?, votacao_aberta = 0, finalizado_em = datetime('now') WHERE id = ?")
      .run(decisao.pulos, atual.id);
  } else {
    db.prepare("UPDATE pedidos SET status = 'pendente', pulos = ?, t_fila = ?, ordem_manual = NULL, votacao_aberta = 0, na_vez_em = NULL WHERE id = ?")
      .run(decisao.pulos, decisao.t_fila, atual.id);
  }
  avancar(db, festa);
  return { id: atual.id, status: decisao.status, pulos: decisao.pulos };
}

export function moverPedido(db, { id, direcao }) {
  const festa = lerFesta(db);
  exigirAberta(festa);
  if (direcao !== 'cima' && direcao !== 'baixo') throw erro(422, 'direcao_invalida', 'Use cima ou baixo.');
  const nova = mover(filaOrdenada(db, festa), id, direcao);
  if (!nova) throw erro(409, 'nao_move', 'Esse pedido não pode ir para esse lado.');
  const gravar = db.prepare('UPDATE pedidos SET ordem_manual = ? WHERE id = ?');
  for (const p of nova) gravar.run(p.ordem_manual, p.id);
}

export function marcarBypass(db, { id, bypass }) {
  exigirAberta(lerFesta(db));
  if (typeof bypass !== 'boolean') throw erro(422, 'valor_invalido', 'Use sim ou não.');
  const r = db.prepare("UPDATE pedidos SET bypass = ? WHERE id = ? AND status IN ('pendente', 'na_vez')").run(bypass ? 1 : 0, id);
  if (!r.changes) throw erro(404, 'pedido_inexistente', 'Pedido não encontrado na fila.');
}

export function marcarVip(db, { id, vip }) {
  const festa = lerFesta(db);
  exigirAberta(festa);
  if (!festa.regras.vip) throw erro(409, 'vip_desligado', 'O VIP está desligado nas regras da festa.');
  if (typeof vip !== 'boolean') throw erro(422, 'valor_invalido', 'Use sim ou não.');
  const r = db.prepare('UPDATE pessoas SET vip = ? WHERE id = ?').run(vip ? 1 : 0, id);
  if (!r.changes) throw erro(404, 'pessoa_inexistente', 'Convidado não encontrado.');
}

// Votar (SPEC 9): um voto por pessoa e performance, alterável enquanto aberta.
export function votar(db, { pedido_id, pessoa_id, nota }) {
  const festa = lerFesta(db);
  exigirAberta(festa);
  if (!festa.regras.votacao) throw erro(409, 'votacao_desligada', 'A votação está desligada nesta festa.');
  const pedido = db.prepare('SELECT pessoa_id, votacao_aberta FROM pedidos WHERE id = ?').get(pedido_id);
  const problema = validarVoto({ pedido, pessoa_id, nota });
  if (problema) throw erro(problema === 'voto_proprio' ? 403 : 409, problema, MENSAGENS[problema]);
  db.prepare(`
    INSERT INTO votos (pedido_id, pessoa_id, nota) VALUES (?, ?, ?)
    ON CONFLICT (pedido_id, pessoa_id) DO UPDATE SET nota = excluded.nota, atualizado_em = datetime('now')`)
    .run(pedido_id, pessoa_id, nota);
  return { n_votos: db.prepare('SELECT COUNT(*) FROM votos WHERE pedido_id = ?').pluck().get(pedido_id) };
}

// Votações abertas: só contagem e o voto de quem pergunta, nunca a parcial (SPEC 9).
export function votacoesAbertas(db, pessoa_id = null) {
  const lerVotos = db.prepare('SELECT pessoa_id, nota FROM votos WHERE pedido_id = ?');
  return db.prepare(`${COM_MUSICA} WHERE p.votacao_aberta = 1 ORDER BY p.status = 'na_vez' DESC, p.finalizado_em DESC, p.id DESC`).all().map((p) => ({
    pedido_id: p.id,
    status: p.status,
    titulo: p.titulo,
    artista: p.artista,
    cantor: p.cantor,
    meu: p.pessoa_id === pessoa_id,
    ...resumoAberta(lerVotos.all(p.id), pessoa_id),
  }));
}

function performances(db) {
  const notas = db.prepare('SELECT nota FROM votos WHERE pedido_id = ?').pluck();
  return db.prepare(`${COM_MUSICA} WHERE p.status = 'cantou'`).all().map((p) => ({
    pedido_id: p.id,
    pessoa_id: p.pessoa_id,
    status: p.status,
    votacao_aberta: p.votacao_aberta,
    titulo: p.titulo,
    artista: p.artista,
    cantor: p.cantor,
    notas: notas.all(p.id),
  }));
}

// Rankings (SPEC 9). Sem ids de pessoa: o id é o cookie de quem entrou.
export function ranking(db, tipo) {
  const { regras } = lerFesta(db);
  if (!regras.votacao) throw erro(404, 'ranking_desligado', 'A votação está desligada nesta festa.');
  if (tipo === 'performances') {
    return rankingPerformances(performances(db), regras.minimo_votos).map((p) => ({
      pedido_id: p.pedido_id, titulo: p.titulo, artista: p.artista, cantor: p.cantor, nota: p.nota, n_votos: p.n_votos,
    }));
  }
  if (tipo === 'pessoas') {
    if (!regras.ranking_pessoas) throw erro(404, 'ranking_desligado', 'O ranking de pessoas está desligado nesta festa.');
    const nomes = new Map(db.prepare('SELECT id, nome FROM pessoas').all().map((p) => [p.id, p.nome]));
    return rankingPessoas(performances(db), regras.minimo_votos, regras.minimo_performances).map((p) => ({
      nome: nomes.get(p.pessoa_id), media: p.media, melhor: p.melhor, n_performances: p.n_performances,
    }));
  }
  throw erro(422, 'tipo_invalido', 'Use pessoas ou performances.');
}
