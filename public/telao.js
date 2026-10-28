// Telão (SPEC 12): fila e ranking numa TV, só leitura, sem cadastro.
import { $, esc, api, vigiar, icone, filete, definirIcone, plural, recarregarTema, MICROFONE } from './comum.js';

const app = $('#app');
window.telaoCarregou = true; // telao-diag.js: o navegador conseguiu rodar o telão
const s = { festa: null, estado: null, qr: '', ranking: { versao: null, pessoas: [], performances: [] }, recados: { versao: null, lista: [] } };

async function carregarFesta() {
  s.festa = await api('GET', '/api/festa');
  definirIcone(s.festa.tema?.icone);
  document.title = `Telão · ${s.festa.titulo || 'Karaokê'}`;
}

async function carregarQr() {
  try {
    const res = await fetch('/api/festa/qr.svg');
    if (res.ok) s.qr = await res.text();
  } catch {
    s.qr = '';
  }
}

// Só ranking de votações fechadas (a parcial nunca sai pela API); ranking desligado vira lista vazia.
async function lista(tipo) {
  try {
    return (await api('GET', `/api/ranking?tipo=${tipo}`)).ranking;
  } catch {
    return [];
  }
}

async function carregarRanking() {
  const { votacao, ranking_pessoas } = s.festa.regras;
  if (!votacao || s.ranking.versao === s.estado.versao) return;
  const [pessoas, performances] = await Promise.all([ranking_pessoas ? lista('pessoas') : [], lista('performances')]);
  s.ranking = { versao: s.estado.versao, pessoas, performances };
}

// Recados dos convidados (SPEC 9.4): só quando algo mudou na festa.
async function carregarRecados() {
  if (!s.festa.regras.recados || s.recados.versao === s.estado.versao) return;
  try {
    s.recados = { versao: s.estado.versao, lista: (await api('GET', '/api/recados')).recados };
  } catch {
    // fica a lista anterior; tenta de novo na próxima mudança
  }
}

async function aoEstado(estado) {
  const mudouStatus = s.estado && s.estado.status !== estado.status;
  s.estado = estado;
  if (mudouStatus) {
    await carregarFesta();
    recarregarTema();
  }
  await Promise.all([carregarRanking(), carregarRecados()]);
  render();
}

function topo() {
  const f = s.festa;
  return `
    <header class="t-topo">
      <span class="destaque">${esc(f.nome_destaque || f.titulo)}</span>
      ${filete()}
      ${s.estado.status === 'aberta' ? `<span class="t-sec">${plural(s.estado.total_fila, 'música na fila', 'músicas na fila')}</span>` : ''}
    </header>`;
}

function palco() {
  const a = s.estado.atual;
  const conteudo = a
    ? `
      <div class="t-musica">${esc(a.titulo)}</div>
      <div class="t-artista">${esc(a.artista)}</div>
      <div class="t-cantor">${MICROFONE}<span class="destaque t-cortar">${esc(a.cantor)}</span></div>`
    : '<p class="destaque t-livre">O palco está livre!</p>';
  return `
    <section class="t-palco" aria-label="Música da vez">
      <div class="filete"><span class="t-rotulo">Agora no palco</span></div>
      ${conteudo}
    </section>`;
}

// Uma linha por cantor; quantos couberem (cortar() esconde os que passariam da tela).
// Os pedidos mais recentes fecham a lista com a posição real, para quem acabou de pedir se ver no telão;
// onde estiverem (no topo ou no fim), ganham o fundo de realce.
function proximos() {
  const recentes = s.estado.recentes || [];
  const ids = new Set(recentes.map((p) => p.id));
  const linha = (p, n, extra = '') => `
    <div class="t-item ${ids.has(p.id) ? 't-recente' : ''}" data-id="${p.id}" ${extra}>
      <span class="t-num">${n}</span>
      <span class="t-item-nome t-cortar">${esc(p.cantor)}</span>
      <span class="t-item-musica t-cortar">${esc(p.titulo)}</span>
    </div>`;
  const itens = s.estado.proximos.map((p, i) => linha(p, i + 1)).join('')
    + recentes.map((p) => linha(p, p.posicao, 'data-fixo')).join('');
  return `
    <section class="t-coluna t-lista" aria-label="Próximos cantores">
      <div class="t-cabeca"><h2>Próximos</h2>${novoPedido()}</div>
      ${itens ? `<div class="t-proximos" data-cortar>${itens}</div>` : '<p class="t-vazio">Ninguém na fila ainda. Peça sua música pelo celular!</p>'}
    </section>`;
}

// "{nome} acabou de pedir" ao lado de Próximos por 2 minutos depois que o telão vê um pedido novo.
// Ao abrir o telão, o pedido mais recente já existente não é anunciado.
const ANUNCIO_MS = 2 * 60 * 1000;
const anuncio = { id: undefined, cantor: '', em: 0, timer: null };
function novoPedido() {
  const novo = (s.estado.recentes || []).reduce((a, p) => (!a || p.id > a.id ? p : a), null);
  if (!novo) return '';
  if (anuncio.id === undefined) anuncio.id = novo.id;
  if (novo.id > anuncio.id) {
    Object.assign(anuncio, { id: novo.id, cantor: novo.cantor, em: Date.now() });
    clearTimeout(anuncio.timer);
    anuncio.timer = setTimeout(render, ANUNCIO_MS + 500);
  }
  if (!anuncio.em || Date.now() - anuncio.em > ANUNCIO_MS) return '';
  // Só anima na primeira vez; o telão redesenha a cada mudança e o anúncio não deve piscar.
  const entra = Date.now() - anuncio.em < 1000 ? 't-novo-entra' : '';
  return `<span class="t-novo t-cortar ${entra}"><span class="t-novo-nome">${esc(anuncio.cantor)}</span> acabou de pedir</span>`;
}

function recados() {
  const itens = s.recados.lista.map((m) => `
    <div class="t-recado">
      <span class="t-recado-nome t-cortar">${esc(m.nome)}</span>
      <span class="t-recado-texto">${esc(m.texto)}</span>
    </div>`).join('');
  return `
    <section class="t-coluna t-lista" aria-label="Recados dos convidados">
      <div class="t-cabeca"><h2>Recados</h2></div>
      ${itens ? `<div class="t-recados" data-cortar>${itens}</div>` : '<p class="t-vazio">Mande um recado pelo celular!</p>'}
    </section>`;
}

function baixo() {
  return s.festa.regras.recados ? `<div class="t-baixo">${proximos()}${recados()}</div>` : `<div class="t-baixo t-baixo-um">${proximos()}</div>`;
}

// Esconde os itens que não cabem inteiros na altura disponível.
// Itens data-fixo (pedidos recentes) só aparecem se o mesmo pedido ficou escondido, e aí tomam o lugar
// dos últimos visíveis; o topo da fila nunca fica com menos de MINIMO_TOPO.
const MINIMO_TOPO = 2;
function cortar() {
  for (const lista of app.querySelectorAll('[data-cortar]')) {
    const limite = lista.getBoundingClientRect().bottom;
    const passa = (item) => item.getBoundingClientRect().bottom > limite + 1;
    const fixos = [...lista.querySelectorAll('[data-fixo]')];
    const itens = [...lista.children].filter((item) => !fixos.includes(item));
    let cabe = true;
    for (const item of lista.children) item.hidden = false;
    for (const fixo of fixos) fixo.hidden = true;
    for (const item of itens) {
      cabe = cabe && !passa(item);
      item.hidden = !cabe;
    }
    if (!fixos.length) continue;
    const mostrarFixos = () => {
      const visiveis = new Set(itens.filter((item) => !item.hidden).map((item) => item.dataset.id));
      for (const fixo of fixos) fixo.hidden = visiveis.has(fixo.dataset.id);
    };
    mostrarFixos();
    const visiveis = itens.filter((item) => !item.hidden);
    while (visiveis.length > MINIMO_TOPO && fixos.some((f) => !f.hidden && passa(f))) {
      visiveis.pop().hidden = true;
      mostrarFixos();
    }
    for (const fixo of fixos) if (!fixo.hidden && passa(fixo)) fixo.hidden = true;
  }
}
addEventListener('resize', cortar);

function linhaRank(r, i, tipo) {
  const pessoas = tipo === 'pessoas';
  return `
    <div class="t-rank ${i === 0 ? 't-rank-topo' : ''}">
      <span class="t-num">${r.posicao}</span>
      <span class="destaque t-cortar t-rank-nome">${esc(pessoas ? r.nome : r.cantor)}</span>
      <span class="t-item-musica t-cortar cresce">${pessoas ? plural(r.n_performances, 'performance', 'performances') : `${esc(r.titulo)} · ${esc(r.artista)}`}</span>
      <span class="t-valor">${esc(pessoas ? r.media_texto : r.nota_texto)}</span>
    </div>`;
}

function blocoRank(titulo, itens, tipo, n) {
  if (!itens.length) return '';
  return `
    <section class="t-ranking" aria-label="${titulo}">
      <div class="t-cabeca"><h2>${titulo}</h2><span class="t-sec">${tipo === 'pessoas' ? 'média' : 'nota'}</span></div>
      <div data-cortar>${itens.slice(0, n).map((r, i) => linhaRank(r, i, tipo)).join('')}</div>
    </section>`;
}

function ranking() {
  const { pessoas, performances } = s.ranking;
  const abertas = s.estado.votacoes.map((v) => `${esc(v.cantor)} (${plural(v.n_votos, 'voto', 'votos')})`);
  const votacoes = abertas.length ? `<p class="t-votacao t-cortar">Votação aberta para ${abertas.join(' e ')}. Vote pelo celular!</p>` : '';
  const blocos = pessoas.length
    ? blocoRank('Ranking · Pessoas', pessoas, 'pessoas', 5) + blocoRank('Ranking · Performances', performances, 'performances', 5)
    : blocoRank('Ranking · Performances', performances, 'performances', 8);
  // O QR vem logo depois e nunca sai da tela: o ranking ocupa o que sobrar e cortar() esconde o excesso.
  return `
    <div class="t-rankings">${blocos || '<section class="t-ranking"><div class="t-cabeca"><h2>Ranking</h2></div><p class="t-vazio">O ranking aparece quando a primeira votação fechar.</p></section>'}</div>
    ${votacoes}`;
}

function qr(grande = false) {
  if (!s.qr) return '';
  return `
    <section class="t-qr ${grande ? 't-qr-grande' : ''}" aria-label="Entrar na festa">
      <div class="t-codigo">${s.qr}</div>
      <div class="pilha" style="gap: 0.3em;">
        <span class="destaque">Peça sua música!</span>
        <span class="t-sec">Aponte a câmera do celular ou acesse</span>
        <span class="t-link">${esc(location.host)}</span>
      </div>
    </section>`;
}

// A mensagem de quem organiza fica 15 minutos (SPEC 9.3). O servidor só para de mandá-la quando algo
// muda na festa, então o telão conta o tempo desde que a viu pela primeira vez.
const VALIDADE_AVISO_MS = 15 * 60 * 1000;
const avisoVisto = { id: null, em: 0, timer: null };
function aviso() {
  const a = s.estado.aviso;
  if (!a) return '';
  if (avisoVisto.id !== a.id) {
    Object.assign(avisoVisto, { id: a.id, em: Date.now() });
    clearTimeout(avisoVisto.timer);
    avisoVisto.timer = setTimeout(render, VALIDADE_AVISO_MS + 500);
  }
  if (Date.now() - avisoVisto.em > VALIDADE_AVISO_MS) return '';
  return `<div class="t-aviso" role="status">${icone()}<span>${esc(a.texto)}</span></div>`;
}

function render() {
  const status = s.estado.status;
  if (status === 'rascunho') {
    app.innerHTML = `
      <div class="t-centro pilha" style="align-items: center; gap: 1em;">
        <span class="destaque" style="font-size: 6em;">${esc(s.festa.nome_destaque || s.festa.titulo)}</span>
        ${filete()}
        <span class="t-rotulo" style="font-size: 1.4em;">Festa em preparação</span>
      </div>`;
    return;
  }
  if (status === 'encerrada') {
    const { pessoas, performances } = s.ranking;
    app.innerHTML = `
      ${topo()}
      <div class="t-centro" style="margin: 0 auto;"><span class="destaque" style="font-size: 5em;">Obrigado!</span></div>
      ${s.festa.regras.votacao && (pessoas.length || performances.length) ? `
        <div class="t-final">
          ${pessoas.length ? `<div class="t-coluna">${blocoRank('Ranking final · Pessoas', pessoas, 'pessoas', 10)}</div>` : ''}
          <div class="t-coluna">${blocoRank('Ranking final · Performances', performances, 'performances', 10)}</div>
        </div>` : '<p class="t-centro t-sec" style="font-size: 1.6em;">A festa terminou.</p>'}`;
    return;
  }
  // Sem QR (regra qr_telao) e sem votação, a coluna da direita some e a esquerda ocupa a tela.
  const { votacao, qr_telao } = s.festa.regras;
  const direita = votacao ? ranking() + (qr_telao ? qr() : '') : qr_telao ? qr(true) : '';
  app.innerHTML = `
    ${topo()}
    <main class="t-corpo ${direita ? '' : 't-corpo-um'}">
      <div class="t-coluna">${palco()}${baixo()}</div>
      ${direita ? `<div class="t-coluna">${direita}</div>` : ''}
    </main>
    ${aviso()}`;
  cortar();
}

// Tela cheia no primeiro toque; tela acesa enquanto a página estiver visível.
let trava = null;
async function manterAcesa() {
  if (trava && !trava.released) return;
  try {
    trava = await navigator.wakeLock?.request('screen');
  } catch {
    trava = null;
  }
}
document.addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  manterAcesa();
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) manterAcesa();
});

async function iniciar() {
  try {
    await Promise.all([carregarFesta(), carregarQr()]);
  } catch {
    app.innerHTML = '<p class="t-centro t-sec">Não deu para carregar a festa. Tentando de novo…</p>';
    setTimeout(iniciar, 5000);
    return;
  }
  manterAcesa();
  vigiar('/api/estado', aoEstado);
}
iniciar();
