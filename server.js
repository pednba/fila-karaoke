import 'dotenv/config';
import { abrirBanco } from './db.js';
import { criarApp } from './app.js';

const config = {
  port: Number(process.env.PORT || 3000),
  // Atrás do proxy, só a própria máquina fala com o app. HOST=0.0.0.0 para testar na rede local.
  host: process.env.HOST || '127.0.0.1',
  publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,
  setupToken: process.env.SETUP_TOKEN,
  cookieSecret: process.env.COOKIE_SECRET,
  dataDir: process.env.DATA_DIR || './data',
  // Ranking final por e-mail (opcional). Sem SMTP_HOST/USER/PASS, o campo de e-mail não aparece.
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    de: process.env.SMTP_FROM || process.env.SMTP_USER,
  },
  // Máquina de karaokê por infravermelho (opcional, SPEC 10.5).
  maquinaToken: process.env.MAQUINA_TOKEN || null,
};
config.cookiesSeguros = config.publicUrl.startsWith('https://');

// Sem SETUP_TOKEN, quem abrisse /admin primeiro viraria admin (SPEC 4.1).
for (const [nome, valor] of [['SETUP_TOKEN', config.setupToken], ['COOKIE_SECRET', config.cookieSecret]]) {
  if (!valor || valor.length < 16) {
    console.error(`Defina ${nome} no .env (pelo menos 16 caracteres). Gere com: openssl rand -hex 24`);
    process.exit(1);
  }
}

if (config.maquinaToken && config.maquinaToken.length < 16) {
  console.error('MAQUINA_TOKEN precisa de pelo menos 16 caracteres. Gere com: openssl rand -hex 24');
  process.exit(1);
}

const db = abrirBanco(`${config.dataDir}/karaoke.db`);
const app = criarApp({ db, config });
app.listen(config.port, config.host, () => console.log(`Fila Karaokê em ${config.publicUrl} (${config.host}:${config.port})`));
