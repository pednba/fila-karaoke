// Rotas públicas do convidado (SPEC 7 e 10.2). O convidado é identificado pelo cookie `kid`.
import crypto from 'node:crypto';
import express from 'express';
import { erro } from '../erros.js';
import { escrever, lerVersao } from '../db.js';
import { lerFesta } from '../festa.js';
import { normalizar, normalizarBusca } from '../texto.js';
import { formatarNota } from '../votos.js';
import {
  pedidoNaVez, filaOrdenada, pedir, cancelar, cantou, votar, votacoesAbertas, ranking,
} from '../operacao.js';

const PROXIMOS = 10;
const LIMITE_BUSCA = 20;
const DIA_MS = 24 * 60 * 60 * 1000;

export function pessoaDoCookie(db, req) {
  const kid = req.cookies?.kid;
  return kid ? db.prepare('SELECT id, nome, vip FROM pessoas WHERE id = ?').get(kid) ?? null : null;
}

export function exigirPessoa(db) {
  return (req, res, next) => {
    req.pessoa = pessoaDoCookie(db, req);
    if (!req.pessoa) return next(erro(401, 'sem_cadastro', 'Entre na festa com seu nome primeiro.'));
    next();
  };
}

export function validarNome(nome) {
  const limpo = String(nome ?? '').replace(/\s+/g, ' ').trim();
  if (!limpo) throw erro(422, 'nome_vazio', 'Digite seu nome.');
  if (limpo.length > 30) throw erro(422, 'nome_longo', 'O nome pode ter até 30 caracteres.');
  return limpo;
}

export function nomeEmUso() {
  return erro(409, 'nome_em_uso', 'Já tem alguém com esse nome na festa. Acrescente uma inicial, como "Ana B."');
}

// Pedido como a tela vê: sem o id de outras pessoas (o id é o cookie delas).
export function pedidoPublico(p, pessoa_id) {
  return {
    id: p.id, cod: p.musica_cod, titulo: p.titulo, artista: p.artista, cantor: p.cantor, status: p.status,
    meu: p.pessoa_id === pessoa_id,
  };
}

// Escapa % e _ para o LIKE.
const paraLike = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export function buscarMusicas(db, { q = '', filtro = '' } = {}) {
  const termo = normalizarBusca(q);
  const condicoes = ['fora_do_catalogo = 0'];
  const params = {};
  if (termo) {
    condicoes.push("busca LIKE @like ESCAPE '\\'");
    params.like = paraLike(termo);
  }
  if (filtro === 'nacionais') condicoes.push("idioma = 'BRA'");
  else if (filtro === 'internacionais') condicoes.push("idioma <> 'BRA'");
  else if (filtro) throw erro(422, 'filtro_invalido', 'Filtro inválido.');
  const onde = condicoes.join(' AND ');

  // SPEC 5.4: casamento no título, depois artista, depois letra; JAP por último.
  const relevancia = termo
    ? `CASE WHEN normalizar_busca(titulo) LIKE @like ESCAPE '\\' THEN 0
            WHEN normalizar_busca(artista) LIKE @like ESCAPE '\\' THEN 1
            WHEN normalizar_busca(inicio) LIKE @like ESCAPE '\\' THEN 2 ELSE 3 END,`
    : '';
  const musicas = db.prepare(`
    SELECT cod, titulo, artista, inicio, idioma FROM musicas WHERE ${onde}
     ORDER BY idioma = 'JAP', ${relevancia} titulo, artista, cod LIMIT ${LIMITE_BUSCA}`).all(params);
  const total = db.prepare(`SELECT COUNT(*) FROM musicas WHERE ${onde}`).pluck().get(params);
  return { musicas, total };
}

// Fim da festa + 24 h (SPEC 7); nunca menos de 24 h a partir de agora.
function validadeKid(festa) {
  const fim = Date.parse(festa.inicio_em) + festa.duracao_min * 60_000 + DIA_MS;
  return new Date(Math.max(Number.isNaN(fim) ? 0 : fim, Date.now() + DIA_MS));
}

export function rotasPublicas({ db, config, auth }) {
  const r = express.Router();
  const comPessoa = exigirPessoa(db);

  r.post('/pessoas', (req, res) => {
    const festa = lerFesta(db);
    if (festa.status !== 'aberta') throw erro(403, 'festa_fechada', 'A festa não está aberta para entrada.');
    const atual = pessoaDoCookie(db, req);
    if (atual) return res.json({ me: { nome: atual.nome } });

    const nome = validarNome(req.body?.nome);
    const id = crypto.randomUUID();
    try {
      escrever(db, () => db.prepare('INSERT INTO pessoas (id, nome, nome_norm) VALUES (?, ?, ?)').run(id, nome, normalizar(nome)));
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw nomeEmUso();
      throw e;
    }
    res.cookie('kid', id, { httpOnly: true, sameSite: 'lax', secure: config.cookiesSeguros, expires: validadeKid(festa) });
    res.status(201).json({ me: { nome } });
  });

  // Polling (SPEC 10.1): ETag "<versao>-<pessoa>"; nada mudou → 304.
  r.get('/estado', (req, res) => {
    const pessoa = pessoaDoCookie(db, req);
    const etag = `"${lerVersao(db)}-${pessoa?.id ?? 'anon'}"`;
    res.set({ ETag: etag, 'Cache-Control': 'no-cache' });
    if (req.get('If-None-Match') === etag) return res.status(304).end();
    res.json(estadoPublico(db, pessoa));
  });

  r.get('/musicas', (req, res) => {
    const pessoa = pessoaDoCookie(db, req);
    const { musicas, total } = buscarMusicas(db, { q: String(req.query.q ?? ''), filtro: String(req.query.filtro ?? '') });
    const naFila = new Set(pessoa
      ? db.prepare("SELECT musica_cod FROM pedidos WHERE pessoa_id = ? AND status IN ('pendente', 'na_vez')").pluck().all(pessoa.id)
      : []);
    res.json({ musicas: musicas.map((m) => ({ ...m, na_fila: naFila.has(m.cod) })), total });
  });

  r.post('/pedidos', comPessoa, (req, res) => {
    const { pedido, posicao_estimada } = escrever(db, () => pedir(db, { pessoa_id: req.pessoa.id, musica_cod: req.body?.musica_cod }));
    res.status(201).json({ pedido: pedidoPublico(pedido, req.pessoa.id), posicao_estimada });
  });

  r.delete('/pedidos/:id', comPessoa, (req, res) => {
    escrever(db, () => cancelar(db, { id: Number(req.params.id), pessoa_id: req.pessoa.id }));
    res.status(204).end();
  });

  // Dono do pedido na vez, ou admin.
  r.post('/pedidos/:id/cantou', (req, res) => {
    const id = Number(req.params.id);
    if (auth.ehAdmin(req)) {
      escrever(db, () => cantou(db, { id }));
    } else {
      const pessoa = pessoaDoCookie(db, req);
      if (!pessoa) throw erro(401, 'sem_cadastro', 'Entre na festa com seu nome primeiro.');
      escrever(db, () => cantou(db, { id, pessoa_id: pessoa.id }));
    }
    res.json({ ok: true });
  });

  r.put('/votos', comPessoa, (req, res) => {
    const { pedido_id, nota } = req.body ?? {};
    res.json(escrever(db, () => votar(db, { pedido_id: Number(pedido_id), pessoa_id: req.pessoa.id, nota })));
  });

  r.get('/ranking', (req, res) => {
    const tipo = String(req.query.tipo ?? 'performances');
    const campo = tipo === 'pessoas' ? 'media' : 'nota';
    const lista = ranking(db, tipo).map((item, i) => ({ posicao: i + 1, ...item, [`${campo}_texto`]: formatarNota(item[campo]) }));
    res.json({ tipo, ranking: lista });
  });

  return r;
}

// GET /api/estado (SPEC 10.2).
export function estadoPublico(db, pessoa) {
  const festa = lerFesta(db);
  const me = pessoa?.id ?? null;
  const naVez = pedidoNaVez(db);
  const fila = filaOrdenada(db, festa);
  const minutos = festa.regras.minutos_por_musica;

  const meus = me
    ? db.prepare(`
        SELECT p.*, m.titulo, m.artista FROM pedidos p JOIN musicas m ON m.cod = p.musica_cod
         WHERE p.pessoa_id = ? AND p.status IN ('pendente', 'na_vez', 'cantou')`).all(me)
    : [];
  const ordem = new Map(fila.map((p, i) => [p.id, i + 1]));
  const meus_pedidos = meus
    .map((p) => {
      const pos = p.status === 'na_vez' ? 0 : ordem.get(p.id) ?? null;
      return {
        id: p.id, cod: p.musica_cod, titulo: p.titulo, artista: p.artista, status: p.status,
        posicao: p.status === 'cantou' ? null : pos,
        espera_min: p.status === 'pendente' && pos != null ? pos * minutos : null,
      };
    })
    .sort((a, b) => (a.posicao ?? Infinity) - (b.posicao ?? Infinity) || a.id - b.id);
  const ativos = meus.filter((p) => p.status !== 'cantou').length;

  return {
    versao: lerVersao(db),
    status: festa.status,
    me: pessoa ? { nome: pessoa.nome, vip: Boolean(pessoa.vip) } : null,
    atual: naVez ? pedidoPublico(naVez, me) : null,
    proximos: fila.slice(0, PROXIMOS).map((p) => pedidoPublico(p, me)),
    total_fila: fila.length,
    meus_pedidos,
    votacoes: festa.regras.votacao ? votacoesAbertas(db, me) : [],
    limite: { maximo: festa.regras.pendentes_por_pessoa, ativos },
  };
}
