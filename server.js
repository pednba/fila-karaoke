import 'dotenv/config';
import { abrirBanco } from './db.js';
import { criarApp } from './app.js';

const config = {
  port: Number(process.env.PORT || 3000),
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,
  setupToken: process.env.SETUP_TOKEN,
  cookieSecret: process.env.COOKIE_SECRET,
  dataDir: process.env.DATA_DIR || './data',
};
config.cookiesSeguros = config.publicUrl.startsWith('https://');

// Sem SETUP_TOKEN, quem abrisse /admin primeiro viraria admin (SPEC 4.1).
for (const [nome, valor] of [['SETUP_TOKEN', config.setupToken], ['COOKIE_SECRET', config.cookieSecret]]) {
  if (!valor || valor.length < 16) {
    console.error(`Defina ${nome} no .env (pelo menos 16 caracteres). Gere com: openssl rand -hex 24`);
    process.exit(1);
  }
}

const db = abrirBanco(`${config.dataDir}/karaoke.db`);
const app = criarApp({ db, config });
app.listen(config.port, () => console.log(`Fila Karaokê em ${config.publicUrl} (porta ${config.port})`));
