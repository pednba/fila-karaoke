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
import { criarPush } from './push.js';
import { svgIcone, pngIcone, TAMANHOS_PNG } from './icones.js';

// config: { dataDir, publicUrl, setupToken, cookieSecret, cookiesSeguros, smtp?, transporteEmail?, maquinaToken?, fetch? }
export function criarApp({ db, config }) {
  garantirFesta(db);
  const auth = criarAuth({ config, lerPinHash: () => lerFesta(db).admin_pin_hash });
  const email = criarEnvioRanking({
    db,
    transporte: config.transporteEmail ?? (config.smtp ? transporteSmtp(config.smtp) : null),
    de: config.smtp?.de,
    rodapeExtra: config.smtp?.rodape,
    link: new URL('/', config.publicUrl).href,
  });
  // Se o app caiu no meio de um envio, termina ao subir de novo.
  if (email.ativo && lerFesta(db).status === 'encerrada') setImmediate(() => email.enviarRankings());
  const maquina = criarMaquina({ db, token: config.maquinaToken });
  const push = criarPush({ db, config });
  // Aviso de "sua música é a próxima" (SPEC 9.3): confere a fila a cada 2 s, só quando algo mudou.
  if (push.ativo) setInterval(() => push.verificarProxima().catch((e) => console.error(e)), 2000).unref();
  const ctx = { db, config, auth, email, maquina, push };

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
  // Para adicionar à Tela de Início (SPEC 9.3). Sem start_url: o app abre no endereço de quando foi adicionado.
  app.get('/manifest.webmanifest', (req, res) => {
    const { titulo, tema } = lerFesta(db);
    const nome = titulo || 'Karaokê';
    const cor = tema?.tokens?.fundo;
    res.type('application/manifest+json').set('Cache-Control', 'no-cache').json({
      name: nome, short_name: nome.slice(0, 20), display: 'standalone', lang: 'pt-BR',
      ...(cor ? { background_color: cor, theme_color: cor } : {}),
      icons: [
        { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ...TAMANHOS_PNG.filter((t) => t !== 180).map((t) => ({ src: `/icone-${t}.png`, sizes: `${t}x${t}`, type: 'image/png' })),
      ],
    });
  });
  app.get('/favicon.svg', (req, res) => {
    res.type('image/svg+xml').set('Cache-Control', 'no-cache').send(svgIcone(lerFesta(db).tema?.tokens));
  });
  app.get(['/favicon.ico', '/apple-touch-icon.png', '/icone-:tamanho.png'], async (req, res, next) => {
    const tamanho = req.params.tamanho ? Number(req.params.tamanho) : req.path === '/favicon.ico' ? 192 : 180;
    if (!TAMANHOS_PNG.includes(tamanho)) return next();
    try {
      res.type('image/png').set('Cache-Control', 'no-cache').send(await pngIcone(lerFesta(db).tema?.tokens, tamanho));
    } catch (e) {
      next(e);
    }
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
