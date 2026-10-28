import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirBanco, escrever } from '../db.js';
import { garantirFesta } from '../festa.js';
import { gravarCatalogo } from '../catalogo.js';
import { prepararMusicas } from '../importadores/index.js';
import { hashPin } from '../auth.js';
import { pedir, cantou, pular } from '../operacao.js';
import { criarApp } from '../app.js';
import { cifrar, cabecalhoVapid, carregarChaves, endpointValido, criarPush } from '../push.js';

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-push-'));
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc';

// O lado do navegador: par de chaves e segredo da inscrição.
function navegador(endpoint = ENDPOINT) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh, authBuf: auth,
    inscricao: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
  };
}

// Decifra como o navegador (RFC 8291).
function decifrar(corpo, { ecdh, authBuf }) {
  const sal = corpo.subarray(0, 16);
  assert.equal(corpo.readUInt32BE(16), 4096);
  const tam = corpo[20];
  const chaveServidor = corpo.subarray(21, 21 + tam);
  const resto = corpo.subarray(21 + tam);
  const hkdf = (ikm, s, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, s, info, n));
  const ikm = hkdf(ecdh.computeSecret(chaveServidor), authBuf,
    Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), chaveServidor]), 32);
  const cek = hkdf(ikm, sal, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, sal, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(resto.subarray(-16));
  const claro = Buffer.concat([d.update(resto.subarray(0, -16)), d.final()]);
  assert.equal(claro.at(-1), 2, 'registro único termina em 0x02');
  return claro.subarray(0, -1).toString();
}

test('cifra aes128gcm que o navegador consegue abrir', () => {
  const nav = navegador();
  const corpo = cifrar('Olá, “festa”!', { p256dh: nav.inscricao.keys.p256dh, auth: nav.inscricao.keys.auth });
  assert.equal(decifrar(corpo, nav), 'Olá, “festa”!');
});

test('VAPID: JWT ES256 válido para a origem do serviço; chaves guardadas e reaproveitadas', () => {
  const dir = pasta();
  const chaves = carregarChaves(dir);
  assert.equal(fs.statSync(path.join(dir, 'vapid.json')).mode & 0o777, 0o600);
  assert.equal(carregarChaves(dir).publica, chaves.publica);

  const agora = Date.UTC(2026, 10, 2, 20);
  const valor = cabecalhoVapid(ENDPOINT, chaves, 'https://k.exemplo/', agora);
  const [, jwt, k] = valor.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, chaves.publica);
  const [h, c, a] = jwt.split('.');
  const dados = JSON.parse(Buffer.from(c, 'base64url'));
  assert.deepEqual(dados, { aud: 'https://fcm.googleapis.com', exp: agora / 1000 + 12 * 3600, sub: 'https://k.exemplo/' });
  const bruta = Buffer.from(k, 'base64url');
  const publica = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: bruta.subarray(1, 33).toString('base64url'), y: bruta.subarray(33).toString('base64url') },
    format: 'jwk',
  });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publica, dsaEncoding: 'ieee-p1363' }, Buffer.from(a, 'base64url')));
});

test('só aceita endereços dos serviços de push conhecidos', () => {
  for (const ok of [ENDPOINT, 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/abc', 'https://wns2-bl2p.notify.windows.com/w/?token=x']) {
    assert.ok(endpointValido(ok), ok);
  }
  for (const ruim of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://evil.com/fcm.googleapis.com', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.com/x', 'nada', 42]) {
    assert.ok(!endpointValido(ruim), String(ruim));
  }
});

function festaAberta() {
  const db = abrirBanco(':memory:');
  garantirFesta(db);
  const musicas = ['1001', '1002', '1003'].map((cod) => ({ cod, titulo: `M${cod}`, artista: 'X', inicio: '', idioma: 'BRA' }));
  gravarCatalogo(db, { musicas: prepararMusicas(musicas), origem: 'teste', statusFesta: 'rascunho' });
  db.prepare("UPDATE festa SET status = 'aberta', titulo = 'Festa Teste', nome_destaque = 'Aniversariante', admin_pin_hash = ? WHERE id = 1").run(hashPin('1234'));
  for (const nome of ['Ana', 'Bia', 'Caio']) db.prepare('INSERT INTO pessoas (id, nome, nome_norm) VALUES (?, ?, ?)').run(nome, nome, nome.toLowerCase());
  return db;
}

// Serviço de push falso: guarda o que recebeu e responde com `status`.
function servicoFalso(status = 201) {
  const recebidos = [];
  const f = async (url, opcoes) => {
    recebidos.push({ url, ...opcoes });
    return { status: f.status, ok: f.status < 300 };
  };
  f.status = status;
  f.recebidos = recebidos;
  return f;
}

function inscrever(db, pessoa_id, nav) {
  const { endpoint, keys } = nav.inscricao;
  db.prepare('INSERT INTO inscricoes_push (endpoint, pessoa_id, p256dh, auth) VALUES (?, ?, ?, ?)').run(endpoint, pessoa_id, keys.p256dh, keys.auth);
}

test('"sua música é a próxima": uma vez por pedido, de novo depois de pulado; 410 apaga a inscrição', async () => {
  const db = festaAberta();
  const fetch = servicoFalso();
  const push = criarPush({ db, config: { publicUrl: 'https://k.exemplo', dataDir: pasta(), fetch } });
  const navBia = navegador();
  inscrever(db, 'Bia', navBia);

  escrever(db, () => pedir(db, { pessoa_id: 'Ana', musica_cod: '1001' })); // Ana no palco
  await push.verificarProxima();
  assert.equal(fetch.recebidos.length, 0, 'sem fila, ninguém é avisado');

  escrever(db, () => pedir(db, { pessoa_id: 'Bia', musica_cod: '1002' }));
  await push.verificarProxima();
  assert.equal(fetch.recebidos.length, 1);
  const r = fetch.recebidos[0];
  assert.equal(r.url, ENDPOINT);
  assert.equal(r.headers['Content-Encoding'], 'aes128gcm');
  assert.match(r.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(decifrar(r.body, navBia)), { titulo: 'Aniversariante', corpo: 'Bia, sua música “M1002” é a próxima!', tag: `proxima-${db.prepare("SELECT id FROM pedidos WHERE pessoa_id = 'Bia'").pluck().get()}` });

  escrever(db, () => pedir(db, { pessoa_id: 'Caio', musica_cod: '1003' }));
  await push.verificarProxima();
  assert.equal(fetch.recebidos.length, 1, 'não repete o aviso');

  escrever(db, () => cantou(db, {})); // Bia no palco, Caio é o próximo (sem inscrição)
  escrever(db, () => pular(db)); // Bia volta para a fila, atrás de Caio, que sobe ao palco
  escrever(db, () => pedir(db, { pessoa_id: 'Ana', musica_cod: '1002' }));
  await push.verificarProxima();
  assert.equal(fetch.recebidos.length, 2, 'pulado e de volta à fila: avisa de novo');

  fetch.status = 410;
  await push.enviarAviso({ id: 1, texto: 'Oi' });
  assert.equal(db.prepare('SELECT COUNT(*) FROM inscricoes_push').pluck().get(), 0);
});

test('sem https, push desligado', () => {
  const push = criarPush({ db: festaAberta(), config: { publicUrl: 'http://localhost:3000', dataDir: pasta() } });
  assert.equal(push.ativo, false);
  assert.equal(push.chavePublica, null);
});

async function subir(db, fetch) {
  const app = criarApp({
    db,
    config: {
      dataDir: pasta(), publicUrl: 'https://k.exemplo', fetch,
      setupToken: 'token-de-setup-para-testes', cookieSecret: 'segredo-dos-cookies-de-teste', cookiesSeguros: false,
    },
  });
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const cliente = () => {
    let cookie = '';
    return async (metodo, rota, corpo) => {
      const res = await fetch_(base + rota, {
        method: metodo,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      const novo = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      if (novo) cookie = novo;
      const texto = await res.text();
      return { status: res.status, dados: texto ? JSON.parse(texto) : null };
    };
  };
  return { servidor, cliente };
}
const fetch_ = globalThis.fetch;

test('rotas: inscrição, token de entrada, mensagem do admin e janela de 15 minutos', async () => {
  const db = festaAberta();
  const fetch = servicoFalso();
  const { servidor, cliente } = await subir(db, fetch);
  try {
    const convidado = cliente();
    assert.match((await convidado('GET', '/api/festa')).dados.push_chave, /^[A-Za-z0-9_-]{87}$/);
    const nav = navegador();
    assert.equal((await convidado('PUT', '/api/me/push', nav.inscricao)).dados.erro, 'sem_cadastro');
    await convidado('POST', '/api/pessoas', { nome: 'Duda' });
    assert.equal((await convidado('PUT', '/api/me/push', { ...nav.inscricao, endpoint: 'https://evil.com/x' })).dados.erro, 'inscricao_invalida');
    assert.equal((await convidado('PUT', '/api/me/push', nav.inscricao)).status, 200);
    assert.equal((await convidado('PUT', '/api/me/push', nav.inscricao)).status, 200, 'repetir não duplica');

    // App da Tela de Início: outro "navegador" entra pelo token.
    const { token } = (await convidado('GET', '/api/me/entrada')).dados;
    const tela = cliente();
    assert.equal((await tela('POST', '/api/entrar', { token: `${token}x` })).dados.erro, 'token_invalido');
    assert.equal((await tela('POST', '/api/entrar', { token: 'Ana.' })).status, 401);
    assert.deepEqual((await tela('POST', '/api/entrar', { token })).dados, { me: { nome: 'Duda' } });
    assert.equal((await tela('GET', '/api/estado')).dados.me.nome, 'Duda');

    // Mensagem do admin.
    assert.equal((await convidado('POST', '/api/admin/avisos', { texto: 'Oi' })).status, 401);
    const admin = cliente();
    await admin('POST', '/api/admin/login', { pin: '1234' });
    assert.equal((await admin('POST', '/api/admin/avisos', { texto: '  ' })).dados.erro, 'texto_vazio');
    assert.equal((await admin('POST', '/api/admin/avisos', { texto: 'x'.repeat(201) })).dados.erro, 'texto_longo');
    const enviado = await admin('POST', '/api/admin/avisos', { texto: 'Hora do parabéns!' });
    assert.equal(enviado.status, 201);
    assert.equal(enviado.dados.inscricoes, 1);
    await new Promise((ok) => setImmediate(ok));
    assert.equal(fetch.recebidos.length, 1);
    assert.equal(JSON.parse(decifrar(fetch.recebidos[0].body, nav)).corpo, 'Hora do parabéns!');
    assert.equal(fetch.recebidos[0].headers.TTL, '900');

    assert.deepEqual((await tela('GET', '/api/estado')).dados.aviso, { id: enviado.dados.aviso.id, texto: 'Hora do parabéns!' });
    const adm = (await admin('GET', '/api/admin/estado')).dados.avisos;
    assert.equal(adm.inscritos, 1);
    assert.equal(adm.ultimo.texto, 'Hora do parabéns!');

    db.prepare("UPDATE avisos SET criado_em = datetime('now', '-16 minutes')").run();
    escrever(db, () => {});
    assert.equal((await tela('GET', '/api/estado')).dados.aviso, null, 'depois de 15 minutos some');

    assert.equal((await convidado('DELETE', '/api/me/push', { endpoint: nav.inscricao.endpoint })).status, 204);
    assert.equal(db.prepare('SELECT COUNT(*) FROM inscricoes_push').pluck().get(), 0);
  } finally {
    servidor.close();
  }
});
