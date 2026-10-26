// Monta o app Express a partir do banco e da configuração (o server.js só sobe a porta).
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { criarAuth } from './auth.js';
import { garantirFesta, lerFesta } from './festa.js';
import { rotasSetup } from './rotas/setup.js';
import { rotasFesta } from './rotas/festa.js';
import { rotasAdmin } from './rotas/admin.js';

// config: { dataDir, publicUrl, setupToken, cookieSecret, cookiesSeguros }
export function criarApp({ db, config }) {
  garantirFesta(db);
  const auth = criarAuth({ config, lerPinHash: () => lerFesta(db).admin_pin_hash });
  const ctx = { db, config, auth };

  const app = express();
  app.set('trust proxy', 'loopback'); // Caddy na frente
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser(config.cookieSecret));

  app.use('/api/setup', rotasSetup(ctx));
  app.use('/api/festa', rotasFesta(ctx));
  app.use('/api/admin', rotasAdmin(ctx));

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
