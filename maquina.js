// Máquina de karaokê por infravermelho (SPEC 10.5). O app só diz qual é o código da vez;
// quem aperta os botões é o script de integracoes/, que consulta esta rota.
import express from 'express';
import { erro } from './erros.js';
import { iguais } from './auth.js';
import { gravarMeta, lerMeta } from './db.js';
import { lerFesta } from './festa.js';
import { pedidoNaVez } from './operacao.js';

const CONECTADA_MS = 30_000;
const DESLIGADA = () => erro(404, 'maquina_desligada', 'A integração com a máquina não está ligada.');

// O comando muda quando outro pedido vira na_vez (ou o mesmo volta, com outro na_vez_em) e a cada reenvio.
// Com o envio desligado não há comando: o script só espera.
export function comandoAtual(db) {
  const festa = lerFesta(db);
  if (festa.status !== 'aberta' || !festa.maquina_ativa) return null;
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
    if (!token) return next(DESLIGADA());
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
      return { ativa: Boolean(lerFesta(db).maquina_ativa), conectada: agora() - visto < CONECTADA_MS, enviado: Boolean(comando && feito === comando.id) };
    },
    // Os dois rodam dentro de `escrever`.
    ligar(ativa) {
      if (!token) throw DESLIGADA();
      if (typeof ativa !== 'boolean') throw erro(422, 'valor_invalido', 'Informe se o envio para a máquina fica ligado.');
      db.prepare("UPDATE festa SET maquina_ativa = ?, atualizado_em = datetime('now') WHERE id = 1").run(ativa ? 1 : 0);
    },
    reenviar() {
      if (!token) throw DESLIGADA();
      if (!lerFesta(db).maquina_ativa) throw erro(409, 'maquina_pausada', 'O envio para a máquina está desligado.');
      if (!comandoAtual(db)) throw erro(409, 'palco_vazio', 'Não há ninguém no palco.');
      gravarMeta(db, 'maquina_reenvio', Number(lerMeta(db, 'maquina_reenvio') ?? 0) + 1);
    },
  };
}
