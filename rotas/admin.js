// Rotas de operação do admin (SPEC 10.4).
import crypto from 'node:crypto';
import express from 'express';
import { erro } from '../erros.js';
import { verificarPin } from '../auth.js';
import { escrever, lerVersao } from '../db.js';
import { lerFesta } from '../festa.js';
import { normalizar } from '../texto.js';
import { validarNome } from './publico.js';
import { validarTextoAviso } from '../push.js';
import {
  pedidoNaVez, filaOrdenada, pedir, cantou, pular, moverPedido, marcarBypass, marcarVip, votacoesAbertas,
} from '../operacao.js';

const idDe = (req) => Number(req.params.id);

export function rotasAdmin({ db, auth, maquina, push }) {
  const r = express.Router();

  r.post('/login', auth.limitarLogin, (req, res) => {
    const { admin_pin_hash } = lerFesta(db);
    if (!admin_pin_hash) throw erro(409, 'sem_pin', 'A festa ainda não foi configurada.');
    if (!verificarPin(req.body?.pin, admin_pin_hash)) throw erro(401, 'pin_incorreto', 'PIN incorreto.');
    auth.emitirCookieAdmin(res, admin_pin_hash);
    res.json({ ok: true });
  });

  r.use(auth.exigirAdmin);

  // Mesmo polling do convidado: ETag pela versão e, com a máquina ligada, pelo estado dela (SPEC 10.5).
  r.get('/estado', (req, res) => {
    const m = maquina?.status() ?? null;
    const etag = `"${lerVersao(db)}-adm${m ? `-${Number(m.ativa)}${Number(m.conectada)}${Number(m.enviado)}` : ''}"`;
    res.set({ ETag: etag, 'Cache-Control': 'no-cache' });
    if (req.get('If-None-Match') === etag) return res.status(304).end();
    res.json({ ...estadoAdmin(db), maquina: m });
  });

  r.put('/maquina', (req, res) => {
    escrever(db, () => maquina.ligar(req.body?.ativa));
    res.json({ maquina: maquina.status() });
  });

  r.post('/maquina/reenviar', (req, res) => {
    escrever(db, () => maquina.reenviar());
    res.json({ ok: true });
  });

  r.post('/cantou', (req, res) => {
    escrever(db, () => cantou(db, {}));
    res.json({ ok: true });
  });

  r.post('/pular', (req, res) => {
    res.json(escrever(db, () => pular(db)));
  });

  r.post('/pedidos/:id/mover', (req, res) => {
    escrever(db, () => moverPedido(db, { id: idDe(req), direcao: req.body?.direcao }));
    res.json({ ok: true });
  });

  r.patch('/pedidos/:id', (req, res) => {
    escrever(db, () => marcarBypass(db, { id: idDe(req), bypass: req.body?.bypass }));
    res.json({ ok: true });
  });

  // Mensagem para os convidados (SPEC 9.3): push para todos e janela no app por 15 minutos.
  r.post('/avisos', (req, res) => {
    if (lerFesta(db).status !== 'aberta') throw erro(403, 'festa_fechada', 'A festa não está aberta.');
    const texto = validarTextoAviso(req.body?.texto);
    const aviso = escrever(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO avisos (texto) VALUES (?)').run(texto);
      return { id: Number(lastInsertRowid), texto };
    });
    const inscricoes = db.prepare('SELECT COUNT(*) FROM inscricoes_push').pluck().get();
    push?.enviarAviso(aviso).catch((e) => console.error(e));
    res.status(201).json({ aviso, inscricoes });
  });

  r.get('/pessoas', (req, res) => {
    res.json({ pessoas: listarPessoas(db) });
  });

  r.patch('/pessoas/:id', (req, res) => {
    escrever(db, () => marcarVip(db, { id: req.params.id, vip: req.body?.vip }));
    res.json({ ok: true });
  });

  // Para convidado sem celular: cria ou reaproveita a pessoa pelo nome (SPEC 8.4).
  r.post('/pedidos', (req, res) => {
    const nome = validarNome(req.body?.nome);
    const resultado = escrever(db, () => {
      let pessoa = db.prepare('SELECT id FROM pessoas WHERE nome_norm = ?').get(normalizar(nome));
      if (!pessoa) {
        pessoa = { id: `adm-${crypto.randomUUID()}` };
        db.prepare('INSERT INTO pessoas (id, nome, nome_norm) VALUES (?, ?, ?)').run(pessoa.id, nome, normalizar(nome));
      }
      return pedir(db, { pessoa_id: pessoa.id, musica_cod: req.body?.musica_cod });
    });
    res.status(201).json({ pedido: pedidoAdmin(resultado.pedido), posicao_estimada: resultado.posicao_estimada });
  });

  return r;
}

function pedidoAdmin(p) {
  return {
    id: p.id, cod: p.musica_cod, titulo: p.titulo, artista: p.artista, status: p.status,
    pessoa_id: p.pessoa_id, cantor: p.cantor, vip: Boolean(p.vip),
    rodada: p.rodada, bypass: Boolean(p.bypass), manual: p.ordem_manual != null, pulos: p.pulos,
  };
}

export function listarPessoas(db) {
  return db.prepare(`
    SELECT s.id, s.nome, s.vip, s.id LIKE 'adm-%' AS sem_celular,
           COUNT(CASE WHEN p.status IN ('pendente', 'na_vez') THEN 1 END) AS na_fila,
           COUNT(CASE WHEN p.status = 'cantou' THEN 1 END) AS cantadas
      FROM pessoas s LEFT JOIN pedidos p ON p.pessoa_id = s.id
     GROUP BY s.id ORDER BY s.nome_norm`).all()
    .map((s) => ({ ...s, vip: Boolean(s.vip), sem_celular: Boolean(s.sem_celular) }));
}

// Operação (SPEC 12): contadores, palco, fila inteira e votações (só contagem).
export function estadoAdmin(db) {
  const festa = lerFesta(db);
  const naVez = pedidoNaVez(db);
  const fila = filaOrdenada(db, festa);
  const contar = (sql) => db.prepare(sql).pluck().get();
  return {
    versao: lerVersao(db),
    status: festa.status,
    contadores: {
      pessoas: contar('SELECT COUNT(*) FROM pessoas'),
      na_fila: fila.length,
      cantadas: contar("SELECT COUNT(*) FROM pedidos WHERE status = 'cantou'"),
      vips: festa.regras.vip ? contar('SELECT COUNT(*) FROM pessoas WHERE vip = 1') : 0,
    },
    atual: naVez ? pedidoAdmin(naVez) : null,
    fila: fila.map(pedidoAdmin),
    votacoes: festa.regras.votacao ? votacoesAbertas(db).map(({ meu, meu_voto, ...v }) => v) : [],
    regras: festa.regras,
    avisos: {
      inscritos: contar('SELECT COUNT(DISTINCT pessoa_id) FROM inscricoes_push'),
      ultimo: db.prepare('SELECT id, texto, criado_em FROM avisos ORDER BY id DESC LIMIT 1').get() ?? null,
    },
  };
}
