import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../db.js';
import { garantirFesta } from '../festa.js';
import { prepararMusicas } from '../importadores/index.js';
import { gravarCatalogo } from '../catalogo.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarApp } from '../app.js';
import { validarEmail, montarEmailRanking, criarEnvioRanking } from '../email.js';

test('validarEmail aceita endereço comum e recusa o resto', () => {
  assert.equal(validarEmail('  ana@exemplo.com.br '), 'ana@exemplo.com.br');
  for (const ruim of ['', 'ana', 'ana@', 'ana@exemplo', 'a b@exemplo.com', `${'a'.repeat(250)}@x.com`]) {
    assert.throws(() => validarEmail(ruim), { status: 422, codigo: 'email_invalido' }, ruim);
  }
});

test('montarEmailRanking traz a colocação da pessoa e os rankings', () => {
  const pessoas = [{ nome: 'Bia', media: 9.5 }, { nome: 'Ana', media: 8.25 }];
  const performances = [{ cantor: 'Bia', titulo: 'Evidências', artista: 'Chitãozinho & Xororó', nota: 10 }];
  const festa = { titulo: 'Festa Teste', nome_destaque: 'Teste' };
  const e = montarEmailRanking({ festa, link: 'https://k.exemplo/', nome: 'Ana', pessoas, performances });
  assert.equal(e.assunto, 'Ranking final · Festa Teste');
  assert.match(e.texto, /Você ficou em 2º lugar/);
  assert.match(e.texto, /1\. Bia · Evidências/);
  assert.match(e.html, /Chitãozinho &amp; Xororó/);
  const sem = montarEmailRanking({ festa, link: 'https://k.exemplo/', nome: 'Caio', pessoas: null, performances: [] });
  assert.doesNotMatch(sem.texto, /lugar|Pessoas/);
  assert.match(sem.texto, /Nenhuma votação fechada/);
  assert.doesNotMatch(sem.html, /Feito por/);
  const com = montarEmailRanking({ festa, link: 'https://k.exemplo/', nome: 'Caio', pessoas: null, performances: [], rodapeExtra: 'Feito por <Fulano> · fulano.exemplo' });
  assert.match(com.texto, /apagado depois do envio\.\n\nFeito por <Fulano> · fulano\.exemplo$/);
  assert.match(com.html, /Feito por &lt;Fulano&gt; · fulano\.exemplo/);
});

function festaEncerrada() {
  const db = abrirBanco(':memory:');
  garantirFesta(db);
  gravarCatalogo(db, { musicas: prepararMusicas([{ cod: '1', titulo: 'Pai', artista: 'Fábio Jr.', inicio: '', idioma: 'BRA' }]), origem: 'teste', statusFesta: 'rascunho' });
  db.prepare("UPDATE festa SET status = 'encerrada', titulo = 'Festa Teste' WHERE id = 1").run();
  const pessoa = db.prepare('INSERT INTO pessoas (id, nome, nome_norm, email) VALUES (?, ?, ?, ?)');
  pessoa.run('p1', 'Ana', 'ana', 'ana@exemplo.com');
  pessoa.run('p2', 'Bia', 'bia', 'falha@exemplo.com');
  pessoa.run('p3', 'Caio', 'caio', null);
  return db;
}

test('envio manda para quem deixou e-mail, apaga o endereço e guarda quem falhou', async () => {
  const db = festaEncerrada();
  const enviados = [];
  const transporte = {
    async sendMail(msg) {
      if (msg.to.startsWith('falha')) throw new Error('caixa cheia');
      enviados.push(msg);
    },
  };
  const envio = criarEnvioRanking({ db, transporte, de: 'karaoke@exemplo.com', link: 'https://k.exemplo/' });
  const erroOriginal = console.error;
  console.error = () => {};
  try {
    const [r1, r2] = await Promise.all([envio.enviarRankings(), envio.enviarRankings()]);
    assert.deepEqual(r1, { enviados: 1, falhas: 1 });
    assert.equal(r2, r1, 'chamadas simultâneas não enviam em dobro');
  } finally {
    console.error = erroOriginal;
  }
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].to, 'ana@exemplo.com');
  assert.equal(enviados[0].from, 'karaoke@exemplo.com');
  const emails = Object.fromEntries(db.prepare('SELECT id, email FROM pessoas').all().map((p) => [p.id, p.email]));
  assert.deepEqual(emails, { p1: null, p2: 'falha@exemplo.com', p3: null });
});

test('envio não faz nada sem transporte, com a festa aberta ou com votação desligada', async () => {
  const db = festaEncerrada();
  const chamadas = [];
  const transporte = { async sendMail(m) { chamadas.push(m); } };
  assert.equal(criarEnvioRanking({ db, transporte: null }).ativo, false);
  assert.deepEqual(await criarEnvioRanking({ db, transporte: null }).enviarRankings(), { enviados: 0, falhas: 0 });
  db.prepare("UPDATE festa SET status = 'aberta'").run();
  await criarEnvioRanking({ db, transporte, link: 'https://k/' }).enviarRankings();
  db.prepare("UPDATE festa SET status = 'encerrada', regras = '{\"votacao\": false}'").run();
  await criarEnvioRanking({ db, transporte, link: 'https://k/' }).enviarRankings();
  assert.equal(chamadas.length, 0);
});

test('rotas: guarda o e-mail, mostra no estado e envia ao encerrar', async () => {
  const db = abrirBanco(':memory:');
  garantirFesta(db);
  db.prepare("UPDATE festa SET status = 'aberta', titulo = 'Festa Teste' WHERE id = 1").run();
  const enviados = [];
  const app = criarApp({
    db,
    config: {
      dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'karaoke-email-')), publicUrl: 'https://k.exemplo', setupToken: 'token-de-setup-para-testes',
      cookieSecret: 'segredo-dos-cookies-de-teste', cookiesSeguros: false, smtp: { de: 'karaoke@exemplo.com' },
      transporteEmail: { async sendMail(m) { enviados.push(m); } },
    },
  });
  const servidor = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let cookie = '';
  const chamar = async (metodo, rota, corpo, headers = {}) => {
    const res = await fetch(base + rota, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const novo = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    if (novo) cookie = novo;
    return { status: res.status, dados: res.status === 204 ? null : await res.json() };
  };
  try {
    assert.equal((await chamar('GET', '/api/festa')).dados.email_ranking, true);
    assert.equal((await chamar('PUT', '/api/me/email', { email: 'ana@exemplo.com' })).status, 401);
    await chamar('POST', '/api/pessoas', { nome: 'Ana' });
    assert.equal((await chamar('PUT', '/api/me/email', { email: 'ana' })).dados.erro, 'email_invalido');
    assert.equal((await chamar('PUT', '/api/me/email', { email: 'ana@exemplo.com' })).status, 200);
    assert.equal((await chamar('GET', '/api/estado')).dados.me.email, 'ana@exemplo.com');
    assert.equal((await chamar('DELETE', '/api/me/email')).status, 204);
    assert.equal((await chamar('GET', '/api/estado')).dados.me.email, null);
    await chamar('PUT', '/api/me/email', { email: 'ana@exemplo.com' });

    assert.equal((await chamar('POST', '/api/festa/encerrar', undefined, { 'X-Setup-Token': 'token-de-setup-para-testes' })).status, 200);
    for (let i = 0; i < 50 && !enviados.length; i++) await new Promise((ok) => setTimeout(ok, 10));
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].to, 'ana@exemplo.com');
    assert.equal(db.prepare('SELECT email FROM pessoas').pluck().get(), null);
    assert.equal((await chamar('PUT', '/api/me/email', { email: 'ana@exemplo.com' })).dados.erro, 'festa_fechada');
  } finally {
    servidor.close();
  }
});
