import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBanco } from '../db.js';
import { criarApp } from '../app.js';

const TOKEN = 'token-de-setup-para-testes';
let dataDir;
let db;
let servidor;
let base;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-front-'));
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

test('páginas do front são servidas como HTML, com e sem extensão', async () => {
  for (const rota of ['/', '/admin', '/setup', '/setup.html', '/privacidade', '/festa']) {
    const res = await fetch(base + rota);
    assert.equal(res.status, 200, rota);
    assert.match(res.headers.get('content-type'), /text\/html/, rota);
    assert.match(await res.text(), /<html lang="pt-BR">/, rota);
  }
  for (const arquivo of ['/estilo.css', '/comum.js', '/convidado.js', '/admin.js', '/setup.js', '/privacidade.js', '/avisos.js', '/sw.js', '/telao.js', '/telao.css', '/telao-diag.js']) {
    assert.equal((await fetch(base + arquivo)).status, 200, arquivo);
  }
});

test('fontes saem do próprio servidor e nenhuma página chama terceiros (SPEC 7.1)', async () => {
  const css = await (await fetch(base + '/fontes/fontes.css')).text();
  const arquivos = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => m[1]);
  assert.ok(arquivos.length >= 5);
  for (const arquivo of arquivos) {
    const res = await fetch(`${base}/fontes/${arquivo}`);
    assert.equal(res.status, 200, arquivo);
  }
  for (const rota of ['/', '/admin', '/setup', '/privacidade', '/festa']) {
    assert.doesNotMatch(await (await fetch(base + rota)).text(), /https?:\/\//, rota);
  }
});

test('/tema.css traz os tokens do tema atual e a fonte de destaque', async () => {
  const res = await fetch(base + '/tema.css');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/css/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  const css = await res.text();
  assert.match(css, /^@import url\("\/fontes\/fontes\.css"\);/);
  assert.doesNotMatch(css, /googleapis|gstatic/);
  for (const token of ['--fundo', '--palco', '--decor', '--destaque-palco', '--texto-2', '--fonte-destaque']) {
    assert.ok(css.includes(`${token}:`), token);
  }
});

test('/api/festa diz se o admin já foi configurado', async () => {
  let festa = await (await fetch(base + '/api/festa')).json();
  assert.equal(festa.admin_configurado, false);
  const res = await fetch(base + '/api/setup/pin', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Setup-Token': TOKEN },
    body: JSON.stringify({ pin: '1234', confirmacao: '1234' }),
  });
  assert.equal(res.status, 200);
  festa = await (await fetch(base + '/api/festa')).json();
  assert.equal(festa.admin_configurado, true);
  assert.equal(festa.admin_pin_hash, undefined);
});

test('rota de API inexistente continua respondendo JSON 404', async () => {
  const res = await fetch(base + '/api/nao-existe');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).erro, 'rota_inexistente');
});

test('ícone de microfone nas cores do tema: favicon, Tela de Início e manifesto', async () => {
  const svg = await fetch(base + '/favicon.svg');
  assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await svg.text(), /<svg[^>]*>.*<rect x="9" y="3"/);
  for (const [rota, tamanho] of [['/icone-192.png', 192], ['/icone-512.png', 512], ['/apple-touch-icon.png', 180], ['/favicon.ico', 192]]) {
    const res = await fetch(base + rota);
    assert.equal(res.status, 200, rota);
    const png = Buffer.from(await res.arrayBuffer());
    assert.equal(png.readUInt32BE(16), tamanho, rota);
  }
  assert.equal((await fetch(base + '/icone-999.png')).status, 404);
  const manifesto = await (await fetch(base + '/manifest.webmanifest')).json();
  assert.ok(manifesto.icons.some((i) => i.src === '/icone-512.png'));
});

test('telão: QR code público com o link da festa (SPEC 12)', async () => {
  const res = await fetch(base + '/api/festa/qr.svg');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await res.text(), /<svg[^>]*viewBox/);
});
