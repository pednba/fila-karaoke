import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { abrirBanco } from '../db.js';
import { criarApp } from '../app.js';

const TOKEN = 'token-de-setup-para-testes';
let dataDir;
let db;
let servidor;
let base;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-setup-'));
  db = abrirBanco(path.join(dataDir, 'karaoke.db'));
  const app = criarApp({
    db,
    config: { dataDir, publicUrl: 'https://karaoke.exemplo.com.br', setupToken: TOKEN, cookieSecret: 'segredo-dos-cookies-de-teste', cookiesSeguros: false },
  });
  await new Promise((ok) => (servidor = app.listen(0, '127.0.0.1', ok)));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => {
  servidor.close();
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

let cookieAdmin = null;

async function api(metodo, rota, { corpo, token, cookie, form } = {}) {
  const headers = {};
  if (token) headers['X-Setup-Token'] = token;
  if (cookie) headers.Cookie = cookie;
  let body;
  if (form) body = form;
  else if (corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(corpo);
  }
  const res = await fetch(base + rota, { method: metodo, headers, body });
  const tipo = res.headers.get('content-type') ?? '';
  const dados = tipo.includes('json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, dados, res };
}

const admin = (metodo, rota, opcoes = {}) => api(metodo, rota, { ...opcoes, cookie: cookieAdmin });

function arquivo(nome, conteudo, tipo) {
  const form = new FormData();
  form.append(nome.campo, new Blob([conteudo], { type: tipo }), nome.arquivo);
  return form;
}

// Os testes abaixo rodam em sequência e compartilham o mesmo banco.

test('16a. antes do PIN, setup exige X-Setup-Token', async () => {
  assert.equal((await api('GET', '/api/setup')).status, 401);
  assert.equal((await api('GET', '/api/setup', { token: 'errado' })).status, 401);
  assert.equal((await api('PUT', '/api/setup/festa', { corpo: {} })).status, 401);
  assert.equal((await api('POST', '/api/festa/abrir')).status, 401);

  const { status, dados } = await api('GET', '/api/setup', { token: TOKEN });
  assert.equal(status, 200);
  assert.equal(dados.status, 'rascunho');
  assert.deepEqual(dados.falta, ['pin', 'festa', 'catalogo']);
  assert.equal(dados.link, 'https://karaoke.exemplo.com.br/');
});

test('passo 1: PIN validado e cookie de admin emitido', async () => {
  assert.equal((await api('PUT', '/api/setup/pin', { token: TOKEN, corpo: { pin: '12' } })).dados.erro, 'pin_invalido');
  assert.equal((await api('PUT', '/api/setup/pin', { token: TOKEN, corpo: { pin: '1234', confirmacao: '4321' } })).dados.erro, 'pin_diferente');

  const { status, res } = await api('PUT', '/api/setup/pin', { token: TOKEN, corpo: { pin: '2468', confirmacao: '2468' } });
  assert.equal(status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /^adm=/);
  assert.match(setCookie, /HttpOnly/i);
  cookieAdmin = setCookie.split(';')[0];
});

test('16b. depois do PIN, o token não basta: só cookie de admin', async () => {
  assert.equal((await api('GET', '/api/setup', { token: TOKEN })).status, 401);
  assert.equal((await api('PUT', '/api/setup/pin', { token: TOKEN, corpo: { pin: '0000' } })).status, 401);
  assert.equal((await api('GET', '/api/setup', { cookie: 'adm=forjado' })).status, 401);
  assert.equal((await admin('GET', '/api/setup')).status, 200);
});

test('login do admin: PIN certo emite cookie; 5 tentativas por minuto', async () => {
  const certo = await api('POST', '/api/admin/login', { corpo: { pin: '2468' } });
  assert.equal(certo.status, 200);
  assert.equal((await admin('GET', '/api/setup', { cookie: certo.res.headers.get('set-cookie').split(';')[0] })).status, 200);

  for (let i = 0; i < 4; i++) assert.equal((await api('POST', '/api/admin/login', { corpo: { pin: '0000' } })).status, 401);
  assert.equal((await api('POST', '/api/admin/login', { corpo: { pin: '2468' } })).status, 429);
});

test('passo 2: dados da festa, título padrão e dimensionamento', async () => {
  const invalido = await admin('PUT', '/api/setup/festa', { corpo: { nome_destaque: 'Helena', inicio_em: '2026-12-05 20:00', duracao_horas: 4, convidados: 60 } });
  assert.equal(invalido.dados.erro, 'data_invalida');

  const { status, dados } = await admin('PUT', '/api/setup/festa', {
    corpo: { nome_destaque: '  Helena ', subtitulo: '45 anos', inicio_em: '2026-12-05T20:00:00-03:00', duracao_horas: 4, local: 'Salão', contato: ' festa@exemplo.com ', convidados: 60 },
  });
  assert.equal(status, 200);
  assert.equal(dados.festa.nome_destaque, 'Helena');
  assert.equal(dados.festa.titulo, 'Karaokê da Helena');
  assert.equal(dados.festa.duracao_min, 240);
  assert.equal(dados.festa.contato, 'festa@exemplo.com');
  assert.equal((await (await fetch(base + '/api/festa')).json()).contato, 'festa@exemplo.com');
  assert.equal(dados.festa.admin_pin_hash, undefined);
  assert.deepEqual(dados.dimensionamento, { musicas: 48, convidados: 60, aviso_duas_vezes: true });
});

test('passo 3: visual com validação de contraste', async () => {
  assert.equal((await admin('PUT', '/api/setup/visual', { corpo: { preset: 'dourado', destaque: '#3A2A10' } })).dados.erro, 'contraste_insuficiente');
  const { status, dados } = await admin('PUT', '/api/setup/visual', { corpo: { preset: 'tropical', fonte: 'Great Vibes' } });
  assert.equal(status, 200);
  assert.equal(dados.tema.preset, 'tropical');
  assert.equal(dados.tema.fonte, 'Great Vibes');
  assert.equal((await admin('GET', '/api/setup')).dados.passos.visual, true);
});

test('passo 3: arte redimensionada para 1200 px; arquivo que não é imagem é recusado', async () => {
  const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#C49A3C' } }).png().toBuffer();
  const ok = await admin('POST', '/api/setup/arte', { form: arquivo({ campo: 'arte', arquivo: 'convite.png' }, png, 'image/png') });
  assert.equal(ok.status, 200);

  const imagem = await fetch(base + '/api/festa/arte');
  assert.equal(imagem.status, 200);
  const meta = await sharp(Buffer.from(await imagem.arrayBuffer())).metadata();
  assert.equal(meta.width, 1200);

  const ruim = await admin('POST', '/api/setup/arte', { form: arquivo({ campo: 'arte', arquivo: 'x.png' }, 'não sou imagem', 'image/png') });
  assert.equal(ruim.dados.erro, 'imagem_invalida');
  assert.equal(fs.readdirSync(path.join(dataDir, 'uploads')).filter((f) => f.startsWith('arte-')).length, 1);
});

test('abrir antes de ter catálogo: setup incompleto', async () => {
  const { status, dados } = await admin('POST', '/api/festa/abrir');
  assert.equal(status, 409);
  assert.deepEqual(dados.falta, ['catalogo']);
});

test('passo 4: prévia do catálogo e confirmação', async () => {
  const csv = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'catalogo-ponto-e-virgula.csv'));
  const envio = await admin('POST', '/api/setup/catalogo', { form: arquivo({ campo: 'arquivo', arquivo: 'catálogo.csv' }, csv, 'text/csv') });
  assert.equal(envio.status, 200);
  assert.equal(envio.dados.previa.total, 3);
  assert.equal(envio.dados.previa.duplicados, 1);
  assert.equal(db.prepare('SELECT COUNT(*) FROM musicas').pluck().get(), 0); // ainda não gravou

  const confirma = await admin('POST', '/api/setup/catalogo/confirmar', { corpo: { token: envio.dados.token } });
  assert.equal(confirma.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) FROM musicas').pluck().get(), 2);
  assert.match((await admin('GET', '/api/setup')).dados.catalogo.origem, /^catálogo\.csv · /);

  assert.equal((await admin('POST', '/api/setup/catalogo/confirmar', { corpo: { token: envio.dados.token } })).dados.erro, 'previa_expirada');
  const vazio = await admin('POST', '/api/setup/catalogo', { form: arquivo({ campo: 'arquivo', arquivo: 'v.csv' }, 'cod,titulo,artista\n', 'text/csv') });
  assert.equal(vazio.dados.erro, 'catalogo_vazio');
});

test('passo 5: regras mescladas e validadas', async () => {
  assert.equal((await admin('PUT', '/api/setup/regras', { corpo: { pendentes_por_pessoa: 0 } })).dados.erro, 'regra_invalida');
  assert.equal((await admin('PUT', '/api/setup/regras', { corpo: { qualquer: 1 } })).dados.erro, 'regra_desconhecida');
  const { dados } = await admin('PUT', '/api/setup/regras', { corpo: { minutos_por_musica: 4, votacao: false } });
  assert.equal(dados.regras.minutos_por_musica, 4);
  assert.equal(dados.regras.votacao, false);
  assert.equal(dados.regras.pendentes_por_pessoa, 3);
  assert.deepEqual(dados.dimensionamento, { musicas: 60, convidados: 60, aviso_duas_vezes: false });
});

test('passo 6: QR code e cartaz', async () => {
  const png = await admin('GET', '/api/setup/qr.png');
  assert.equal(png.res.headers.get('content-type'), 'image/png');
  const svg = await admin('GET', '/api/setup/qr.svg');
  assert.match(Buffer.from(svg.dados).toString(), /<svg/);
  const cartaz = Buffer.from((await admin('GET', '/api/setup/cartaz.html')).dados).toString();
  assert.match(cartaz, /Helena/);
  assert.match(cartaz, /karaoke\.exemplo\.com\.br/);
  assert.match(cartaz, /--palco: #0F3D3E/);
});

test('abrir; reimportar com a festa aberta exige confirmação e cancela pedidos de músicas que sumiram', async () => {
  assert.equal((await admin('POST', '/api/festa/abrir')).dados.status, 'aberta');
  assert.equal((await admin('POST', '/api/festa/abrir')).dados.erro, 'status_invalido');

  db.prepare("INSERT INTO pessoas (id, nome, nome_norm) VALUES ('p1', 'Ana', 'ana')").run();
  db.prepare("INSERT INTO pedidos (pessoa_id, musica_cod, status, t_fila) VALUES ('p1', '4574', 'pendente', 1), ('p1', '9380', 'na_vez', 0)").run();

  const csv = 'cod,titulo,artista\n1111,NOVA,Alguem\n';
  const envio = await admin('POST', '/api/setup/catalogo', { form: arquivo({ campo: 'arquivo', arquivo: 'novo.csv' }, csv, 'text/csv') });
  const sem = await admin('POST', '/api/setup/catalogo/confirmar', { corpo: { token: envio.dados.token } });
  assert.equal(sem.status, 409);
  assert.equal(sem.dados.erro, 'confirmacao_necessaria');
  assert.equal(sem.dados.pedidos_cancelados, 1);

  const com = await admin('POST', '/api/setup/catalogo/confirmar', { corpo: { token: envio.dados.token, confirmar: true } });
  assert.equal(com.status, 200);
  const status = db.prepare('SELECT musica_cod, status FROM pedidos ORDER BY musica_cod').all();
  assert.deepEqual(status, [{ musica_cod: '4574', status: 'cancelado' }, { musica_cod: '9380', status: 'na_vez' }]);
  // As que têm pedido ficam escondidas; a nova entra.
  const musicas = db.prepare('SELECT cod, fora_do_catalogo FROM musicas ORDER BY cod').all();
  assert.deepEqual(musicas, [
    { cod: '1111', fora_do_catalogo: 0 },
    { cod: '4574', fora_do_catalogo: 1 },
    { cod: '9380', fora_do_catalogo: 1 },
  ]);
});

test('encerrar fecha as votações; arquivar copia o banco e volta ao setup', async () => {
  db.prepare("UPDATE pedidos SET status = 'cantou', votacao_aberta = 1 WHERE musica_cod = '9380'").run();
  assert.equal((await admin('POST', '/api/festa/arquivar')).dados.erro, 'status_invalido');
  assert.equal((await admin('POST', '/api/festa/encerrar')).dados.status, 'encerrada');
  assert.equal(db.prepare('SELECT COUNT(*) FROM pedidos WHERE votacao_aberta = 1').pluck().get(), 0);

  const versaoAntes = Number(db.prepare("SELECT valor FROM meta WHERE chave = 'versao'").pluck().get());
  const { status, dados } = await admin('POST', '/api/festa/arquivar');
  assert.equal(status, 200);
  assert.equal(dados.arquivo, path.join('arquivo', '2026-12-05-karaoke-da-helena.db'));
  const copia = abrirBanco(path.join(dataDir, dados.arquivo));
  assert.equal(copia.prepare('SELECT nome_destaque FROM festa').pluck().get(), 'Helena');
  copia.close();

  assert.equal(db.prepare('SELECT COUNT(*) FROM pedidos').pluck().get(), 0);
  assert.equal(db.prepare('SELECT COUNT(*) FROM pessoas').pluck().get(), 0);
  assert.deepEqual(db.prepare('SELECT cod FROM musicas').pluck().all(), ['1111']); // catálogo mantido
  assert.ok(Number(db.prepare("SELECT valor FROM meta WHERE chave = 'versao'").pluck().get()) > versaoAntes);

  // Sem PIN de novo: o cookie antigo não vale e o token volta a ser exigido.
  assert.equal((await admin('GET', '/api/setup')).status, 401);
  const setup = await api('GET', '/api/setup', { token: TOKEN });
  assert.equal(setup.dados.status, 'rascunho');
  assert.deepEqual(setup.dados.falta, ['pin', 'festa']);
});
