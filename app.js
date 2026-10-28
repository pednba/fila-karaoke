// Monta o app Express a partir do banco e da configuração (o server.js só sobe a porta).
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { criarAuth } from './auth.js';
import { garantirFesta, lerFesta } from './festa.js';
import { cssDoTema, URL_FONTES } from './temas.js';
import { rotasSetup } from './rotas/setup.js';
import { rotasFesta } from './rotas/festa.js';
import { rotasAdmin } from './rotas/admin.js';
import { rotasPublicas } from './rotas/publico.js';
import { criarEnvioRanking, transporteSmtp } from './email.js';
import { criarMaquina } from './maquina.js';

// config: { dataDir, publicUrl, setupToken, cookieSecret, cookiesSeguros, smtp?, transporteEmail?, maquinaToken? }
export function criarApp({ db, config }) {
  garantirFesta(db);
  const auth = criarAuth({ config, lerPinHash: () => lerFesta(db).admin_pin_hash });
  const email = criarEnvioRanking({
    db,
    transporte: config.transporteEmail ?? (config.smtp ? transporteSmtp(config.smtp) : null),
    de: config.smtp?.de,
    link: new URL('/', config.publicUrl).href,
  });
  // Se o app caiu no meio de um envio, termina ao subir de novo.
  if (email.ativo && lerFesta(db).status === 'encerrada') setImmediate(() => email.enviarRankings());
  const maquina = criarMaquina({ db, token: config.maquinaToken });
  const ctx = { db, config, auth, email, maquina };

  const app = express();
  app.set('trust proxy', 'loopback'); // Caddy na frente
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser(config.cookieSecret));

  app.use('/api/setup', rotasSetup(ctx));
  app.use('/api/festa', rotasFesta(ctx));
  app.use('/api/admin', rotasAdmin(ctx));
  app.use('/api/maquina', maquina.rotas);
  app.use('/api', rotasPublicas(ctx));

  // Tema da festa como variáveis CSS (SPEC 11), usado por todas as telas.
  app.get('/tema.css', (req, res) => {
    const { tema } = lerFesta(db);
    res.type('text/css').set('Cache-Control', 'no-cache').send(`@import url("${URL_FONTES}");\n${cssDoTema(tema)}\n`);
  });
  app.use(express.static(fileURLToPath(new URL('./public', import.meta.url)), { extensions: ['html'] }));

  app.use('/api', (req, res) => res.status(404).json({ erro: 'rota_inexistente', mensagem: 'Rota não encontrada.' }));

  // Erros: { erro, mensagem } (SPEC 10).
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const grande = err.code === 'LIMIT_FILE_SIZE';
      return res.status(grande ? 413 : 422).json({
        erro: grande ? 'arquivo_grande' : 'upload_invalido',
        mensagem: grande ? 'Arquivo grande demais.' : 'Envio inválido.',
      });
    }
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'json_invalido', mensagem: 'Requisição inválida.' });
    if (err.codigo) return res.status(err.status ?? 422).json({ erro: err.codigo, mensagem: err.message, ...err.extra });
    console.error(err);
    res.status(500).json({ erro: 'erro_interno', mensagem: 'Algo deu errado. Tente de novo.' });
  });

  return app;
}
