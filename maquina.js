// Máquina de karaokê por infravermelho (SPEC 10.5). O app só diz qual é o código da vez;
// quem aperta os botões é o script de integracoes/, que consulta esta rota.
import express from 'express';
import { erro } from './erros.js';
import { iguais } from './auth.js';
import { gravarMeta, lerMeta } from './db.js';
import { lerFesta } from './festa.js';
import { pedidoNaVez } from './operacao.js';

const CONECTADA_MS = 30_000;

// O comando muda quando outro pedido vira na_vez (ou o mesmo volta, com outro na_vez_em) e a cada reenvio.
export function comandoAtual(db) {
  if (lerFesta(db).status !== 'aberta') return null;
  const p = pedidoNaVez(db);
  if (!p) return null;
  const reenvio = Number(lerMeta(db, 'maquina_reenvio') ?? 0);
  return { id: `${p.id}-${String(p.na_vez_em ?? '').replace(/\D/g, '')}-${reenvio}`, cod: p.musica_cod, titulo: p.titulo, cantor: p.cantor };
}

// token: MAQUINA_TOKEN do .env; sem ele, a integração fica desligada.
export function criarMaquina({ db, token, agora = () => Date.now() }) {
  let visto = 0;
  let feito = null;

  const rotas = express.Router();
  rotas.use((req, res, next) => {
    if (!token) return next(erro(404, 'maquina_desligada', 'A integração com a máquina não está ligada.'));
    const enviado = req.get('X-Maquina-Token');
    if (!enviado || !iguais(enviado, token)) return next(erro(401, 'token_invalido', 'Token da máquina inválido.'));
    next();
  });
  rotas.get('/comando', (req, res) => {
    visto = agora();
    if (typeof req.query.feito === 'string' && req.query.feito) feito = req.query.feito.slice(0, 100);
    res.set('Cache-Control', 'no-store').json({ comando: comandoAtual(db) });
  });

  return {
    ativa: Boolean(token),
    rotas,
    // Para o admin: null com a integração desligada.
    status() {
      if (!token) return null;
      const comando = comandoAtual(db);
      return { conectada: agora() - visto < CONECTADA_MS, enviado: Boolean(comando && feito === comando.id) };
    },
    // Roda dentro de `escrever`.
    reenviar() {
      if (!token) throw erro(404, 'maquina_desligada', 'A integração com a máquina não está ligada.');
      if (!comandoAtual(db)) throw erro(409, 'palco_vazio', 'Não há ninguém no palco.');
      gravarMeta(db, 'maquina_reenvio', Number(lerMeta(db, 'maquina_reenvio') ?? 0) + 1);
    },
  };
}
