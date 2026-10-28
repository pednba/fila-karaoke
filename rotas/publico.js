// Rotas públicas do convidado (SPEC 7 e 10.2). O convidado é identificado pelo cookie `kid`.
import crypto from 'node:crypto';
import express from 'express';
import { erro } from '../erros.js';
import { escrever, lerVersao } from '../db.js';
import { lerFesta } from '../festa.js';
import { normalizar, normalizarBusca } from '../texto.js';
import { formatarNota } from '../votos.js';
import { liberadoParaCantou } from '../fila.js';
import { listarArtistas, sugerir } from '../artistas.js';
import { validarEmail } from '../email.js';
import { GENEROS, listarGeneros } from '../generos.js';
import { validarInscricao, avisoVigente } from '../push.js';
import { listarRecados, criarRecado, RECADOS_TELAO } from '../recados.js';
import {
  pedidoNaVez, filaOrdenada, pedir, cancelar, cantou, votar, votacoesAbertas, ranking,
} from '../operacao.js';

const PROXIMOS = 10;
const LIMITE_BUSCA = 20;
const DIA_MS = 24 * 60 * 60 * 1000;

export function pessoaDoCookie(db, req) {
  const kid = req.cookies?.kid;
  return kid ? db.prepare('SELECT id, nome, vip, email FROM pessoas WHERE id = ?').get(kid) ?? null : null;
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

export function buscarMusicas(db, { q = '', filtro = '', artista = '', genero = '', offset = 0 } = {}) {
  const termo = normalizarBusca(q);
  const condicoes = ['fora_do_catalogo = 0'];
  const params = {};
  if (termo) {
    condicoes.push("busca LIKE @like ESCAPE '\\'");
    params.like = paraLike(termo);
  }
  const chave = normalizarBusca(artista);
  if (chave) {
    condicoes.push("artistas_busca(artista) LIKE @artista ESCAPE '\\'");
    params.artista = `%|${chave.replace(/[\\%_]/g, (c) => `\\${c}`)}|%`;
  }
  if (!Number.isInteger(offset) || offset < 0) throw erro(422, 'offset_invalido', 'Posição da lista inválida.');
  if (filtro === 'nacionais') condicoes.push("idioma = 'BRA'");
  else if (filtro === 'internacionais') condicoes.push("idioma <> 'BRA'");
  else if (filtro) throw erro(422, 'filtro_invalido', 'Filtro inválido.');
  if (genero) {
    if (!GENEROS.includes(genero)) throw erro(422, 'genero_invalido', 'Gênero inválido.');
    condicoes.push('artista_principal(artista) IN (SELECT chave FROM generos_artista WHERE genero = @genero)');
    params.genero = genero;
  }
  const onde = condicoes.join(' AND ');

  // SPEC 5.4: casamento no título, depois artista, depois letra; JAP por último.
  const relevancia = termo
    ? `CASE WHEN normalizar_busca(titulo) LIKE @like ESCAPE '\\' THEN 0
            WHEN normalizar_busca(artista) LIKE @like ESCAPE '\\' THEN 1
            WHEN normalizar_busca(inicio) LIKE @like ESCAPE '\\' THEN 2 ELSE 3 END,`
    : '';
  const musicas = db.prepare(`
    SELECT cod, titulo, artista, inicio, idioma FROM musicas WHERE ${onde}
     ORDER BY idioma = 'JAP', ${relevancia} titulo, artista, cod LIMIT ${LIMITE_BUSCA} OFFSET ${offset}`).all(params);
  const total = db.prepare(`SELECT COUNT(*) FROM musicas WHERE ${onde}`).pluck().get(params);
  return { musicas, total };
}

// Fim da festa + 24 h (SPEC 7); nunca menos de 24 h a partir de agora.
function validadeKid(festa) {
  const fim = Date.parse(festa.inicio_em) + festa.duracao_min * 60_000 + DIA_MS;
  return new Date(Math.max(Number.isNaN(fim) ? 0 : fim, Date.now() + DIA_MS));
}

export function rotasPublicas({ db, config, auth, email, push }) {
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

  // App da Tela de Início (SPEC 9.3): não enxerga o cookie do Safari, então entra pelo token.
  r.get('/me/entrada', comPessoa, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ token: auth.tokenEntrada(req.pessoa.id) });
  });
  r.post('/entrar', (req, res) => {
    const kid = auth.kidDoToken(req.body?.token);
    const pessoa = kid && db.prepare('SELECT id, nome FROM pessoas WHERE id = ?').get(kid);
    if (!pessoa) throw erro(401, 'token_invalido', 'Esse link de entrada não vale mais. Entre com seu nome.');
    res.cookie('kid', pessoa.id, { httpOnly: true, sameSite: 'lax', secure: config.cookiesSeguros, expires: validadeKid(lerFesta(db)) });
    res.json({ me: { nome: pessoa.nome } });
  });

  // Avisos por notificação (SPEC 9.3).
  r.put('/me/push', comPessoa, (req, res) => {
    if (!push?.ativo) throw erro(404, 'push_desligado', 'Os avisos por notificação não estão disponíveis.');
    if (lerFesta(db).status !== 'aberta') throw erro(403, 'festa_fechada', 'A festa não está aberta.');
    const i = validarInscricao(req.body);
    escrever(db, () => db.prepare(`
      INSERT INTO inscricoes_push (endpoint, pessoa_id, p256dh, auth) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET pessoa_id = excluded.pessoa_id, p256dh = excluded.p256dh, auth = excluded.auth`)
      .run(i.endpoint, req.pessoa.id, i.p256dh, i.auth));
    res.json({ ok: true });
  });
  r.delete('/me/push', comPessoa, (req, res) => {
    escrever(db, () => db.prepare('DELETE FROM inscricoes_push WHERE endpoint = ? AND pessoa_id = ?').run(String(req.body?.endpoint ?? ''), req.pessoa.id));
    res.status(204).end();
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
    const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
    const { musicas, total } = buscarMusicas(db, {
      q: String(req.query.q ?? ''),
      filtro: String(req.query.filtro ?? ''),
      artista: String(req.query.artista ?? ''),
      genero: lerFesta(db).filtro_genero ? String(req.query.genero ?? '') : '', // SPEC 5.7
      offset,
    });
    const naFila = new Set(pessoa
      ? db.prepare("SELECT musica_cod FROM pedidos WHERE pessoa_id = ? AND status IN ('pendente', 'na_vez')").pluck().all(pessoa.id)
      : []);
    res.json({ musicas: musicas.map((m) => ({ ...m, na_fila: naFila.has(m.cod) })), total, offset });
  });

  r.get('/artistas', (req, res) => {
    const filtro = String(req.query.filtro ?? '');
    if (!['', 'nacionais', 'internacionais'].includes(filtro)) throw erro(422, 'filtro_invalido', 'Filtro inválido.');
    const genero = lerFesta(db).filtro_genero ? String(req.query.genero ?? '') : ''; // SPEC 5.7
    if (genero && !GENEROS.includes(genero)) throw erro(422, 'genero_invalido', 'Gênero inválido.');
    res.json({ artistas: listarArtistas(db, { filtro, genero }) });
  });

  r.get('/generos', (req, res) => {
    const filtro = String(req.query.filtro ?? '');
    if (!['', 'nacionais', 'internacionais'].includes(filtro)) throw erro(422, 'filtro_invalido', 'Filtro inválido.');
    res.json({ generos: lerFesta(db).filtro_genero ? listarGeneros(db, { filtro }) : [] });
  });

  // Ranking final por e-mail (SPEC 9.1).
  const exigirEmailAberto = () => {
    if (!email?.ativo || !lerFesta(db).regras.votacao) throw erro(404, 'email_desligado', 'O envio do ranking por e-mail não está disponível.');
    if (lerFesta(db).status !== 'aberta') throw erro(403, 'festa_fechada', 'A festa não está aberta.');
  };
  r.put('/me/email', comPessoa, (req, res) => {
    exigirEmailAberto();
    const valor = validarEmail(req.body?.email);
    escrever(db, () => db.prepare('UPDATE pessoas SET email = ? WHERE id = ?').run(valor, req.pessoa.id));
    res.json({ email: valor });
  });
  r.delete('/me/email', comPessoa, (req, res) => {
    escrever(db, () => db.prepare('UPDATE pessoas SET email = NULL WHERE id = ?').run(req.pessoa.id));
    res.status(204).end();
  });

  r.get('/sugestao', comPessoa, (req, res) => {
    res.json({ sugestao: sugerir(db, req.pessoa.id) });
  });

  r.post('/pedidos', comPessoa, (req, res) => {
    const { pedido, posicao_estimada } = escrever(db, () => pedir(db, { pessoa_id: req.pessoa.id, musica_cod: req.body?.musica_cod }));
    res.status(201).json({ pedido: pedidoPublico(pedido, req.pessoa.id), posicao_estimada });
  });

  r.delete('/pedidos/:id', comPessoa, (req, res) => {
    escrever(db, () => cancelar(db, { id: Number(req.params.id), pessoa_id: req.pessoa.id }));
    res.status(204).end();
  });

  // Admin, dono do pedido na vez ou, depois de 2 minutos, quem está na fila menos o próximo (SPEC 8.4).
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

  // Recados no telão (SPEC 9.4).
  r.get('/recados', (req, res) => {
    res.json({ recados: lerFesta(db).regras.recados ? listarRecados(db, RECADOS_TELAO) : [] });
  });

  r.post('/recados', comPessoa, (req, res) => {
    const recado = escrever(db, () => criarRecado(db, { pessoa_id: req.pessoa.id, texto: req.body?.texto }));
    res.status(201).json({ recado });
  });

  return r;
}

// Para quem não é o dono: a partir de quando pode marcar "Cantou" (ISO), ou null.
function liberadoEm(naVez, me, fila) {
  if (naVez.pessoa_id === me) return null;
  const desde = liberadoParaCantou({ pessoa_id: me, atual: naVez, fila });
  return desde == null ? null : new Date(desde).toISOString();
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
    me: pessoa ? { nome: pessoa.nome, vip: Boolean(pessoa.vip), email: pessoa.email ?? null } : null,
    atual: naVez ? { ...pedidoPublico(naVez, me), liberado_em: liberadoEm(naVez, me, fila) } : null,
    proximos: fila.slice(0, PROXIMOS).map((p) => pedidoPublico(p, me)),
    total_fila: fila.length,
    meus_pedidos,
    votacoes: festa.regras.votacao ? votacoesAbertas(db, me) : [],
    limite: { maximo: festa.regras.pendentes_por_pessoa, ativos },
    aviso: festa.status === 'aberta' ? avisoVigente(db) : null, // SPEC 9.3
  };
}
