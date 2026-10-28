// Tela do convidado (SPEC 12): entrada, Fila, Catálogo, Pedidos, Ranking, preparação e encerrada.
import { $, esc, api, vigiar, avisar, icone, filete, definirIcone, plural, dividirTitulo, MICROFONE, LUPA, barraEmojis, ligarEmojis, contarCampo } from './comum.js';
import {
  pedirPermissao, vigiarPermissao, inscrever, cartaoDesejado, dispensar, entrarPeloToken, prepararTelaDeInicio, avisoNovo, marcarVisto,
} from './avisos.js';

const app = $('#app');
const PASSO_ARTISTAS = 80;
const s = {
  festa: null,
  estado: null,
  tela: null, // rascunho | entrada | festa | encerrada
  aba: 'fila',
  inscricaoConferida: false, // avisos por notificação (SPEC 9.3)
  busca: {
    q: '', filtro: '', modo: 'musicas', artista: null, // artista: { nome, chave }
    genero: '', generos: {}, // generos: cache por filtro (SPEC 5.7)
    musicas: [], total: 0, carregando: false, geracao: 0,
    artistas: {}, mostrarArtistas: PASSO_ARTISTAS, // artistas: cache por filtro e gênero
    sugestao: null, sugestaoChave: null,
  },
  ranking: { tipo: null, lista: [], versao: null, pessoasVazio: false },
};
let poll;

async function carregarFesta() {
  s.festa = await api('GET', '/api/festa');
  definirIcone(s.festa.tema?.icone);
  document.title = s.festa.titulo || 'Karaokê';
}

function telaDesejada() {
  const status = s.estado?.status ?? s.festa.status;
  if (status === 'rascunho') return 'rascunho';
  if (status === 'encerrada') return 'encerrada';
  return s.estado?.me ? 'festa' : 'entrada';
}

async function aoEstado(estado) {
  const anterior = s.estado;
  s.estado = estado;
  if (anterior && anterior.status !== estado.status) await carregarFesta();
  const tela = telaDesejada();
  if (tela !== s.tela) {
    s.tela = tela;
    montar();
  } else {
    atualizar();
  }
  if (tela === 'festa') {
    mostrarAviso(estado.aviso);
    // Quem já permitiu: confere a inscrição uma vez por visita (cookie novo, chave nova).
    if (!s.inscricaoConferida) {
      s.inscricaoConferida = true;
      inscrever(s.festa.push_chave).catch(() => {});
    }
  }
}

// Mensagem de quem organiza (SPEC 9.3): janela uma vez por aparelho.
function mostrarAviso(aviso) {
  if (!avisoNovo(aviso)) return;
  marcarVisto(aviso);
  let janela = $('#janela-aviso');
  if (!janela) {
    janela = document.createElement('dialog');
    janela.id = 'janela-aviso';
    janela.className = 'janela';
    document.body.append(janela);
  }
  janela.innerHTML = `
    <form method="dialog" class="pilha centro" style="gap: 14px;">
      <p class="rotulo">${esc(s.festa.titulo || 'Recado')}</p>
      ${filete()}
      <p class="destaque" style="font-size: 30px; white-space: pre-line; overflow-wrap: anywhere;">${esc(aviso.texto)}</p>
      <button class="btn btn-grande">OK</button>
    </form>`;
  if (!janela.open) janela.showModal();
}

// ---------- Montagem por tela ----------

function montar() {
  if (s.tela === 'rascunho') return montarPreparacao();
  if (s.tela === 'entrada') return montarEntrada();
  if (s.tela === 'encerrada') return montarEncerrada();
  montarFesta();
}

function montarPreparacao() {
  app.innerHTML = `
    <div class="moldura">
      <p class="rotulo">Karaokê</p>
      <p class="destaque" style="font-size: 52px;">Festa em preparação</p>
      ${filete()}
      <p class="sec" style="font-size: 14px;">A entrada abre assim que a festa começar. Esta página atualiza sozinha.</p>
    </div>`;
}

function circuloFesta() {
  const f = s.festa;
  return `
    <div class="circulo">
      <span class="destaque">${esc(f.nome_destaque)}</span>
      ${f.subtitulo ? `<span class="subtitulo">${esc(f.subtitulo)}</span>` : ''}
    </div>`;
}

function montarEntrada() {
  const f = s.festa;
  app.innerHTML = `
    <form class="moldura" id="form-entrada" novalidate>
      ${f.arte_url ? `<img class="arte" src="${esc(f.arte_url)}" alt="Arte da festa">` : ''}
      <p class="rotulo">${esc(f.titulo)}</p>
      ${circuloFesta()}
      ${filete()}
      <p class="frase">Escolha sua música e entre na fila!</p>
      <div class="campo" style="width: 100%;">
        <label for="nome">Como você quer aparecer na fila?</label>
        <input id="nome" class="entrada" maxlength="30" autocomplete="nickname" placeholder="Seu nome ou apelido">
        <span class="erro-campo" id="erro-nome" hidden></span>
      </div>
      <button type="submit" class="btn btn-grande">Entrar na festa</button>
      <p class="sec">Usamos um cookie só para lembrar quem você é nesta festa. Sem rastreamento. <a href="/privacidade">Privacidade</a></p>
    </form>`;
  $('#form-entrada').onsubmit = async (ev) => {
    ev.preventDefault();
    const nome = $('#nome').value.trim();
    const erroEl = $('#erro-nome');
    if (!nome) {
      erroEl.textContent = 'Digite um nome para continuar';
      erroEl.hidden = false;
      return;
    }
    const botao = ev.submitter;
    botao.disabled = true;
    const permissao = pedirPermissao(s.festa.push_chave); // ainda dentro do toque (SPEC 9.3)
    try {
      await api('POST', '/api/pessoas', { nome });
      permissao.then((p) => p === 'granted' && inscrever(s.festa.push_chave)).catch(() => {});
      s.aba = 'busca';
      await poll.agora();
    } catch (e) {
      erroEl.textContent = e.message;
      erroEl.hidden = false;
    } finally {
      botao.disabled = false;
    }
  };
}

function cabecalho() {
  const f = s.festa;
  const [rotulo, nome] = dividirTitulo(f.titulo, f.nome_destaque);
  const me = s.estado?.me;
  return `
    <header class="topo">
      <div class="cresce">
        <p class="rotulo-p">${esc(rotulo)}</p>
        <p class="destaque">${esc(nome)}</p>
      </div>
      ${me ? `<div class="eu">${icone()}<span class="cortar">${esc(me.nome)}</span></div>` : ''}
    </header>`;
}

const votacaoLigada = () => Boolean(s.festa.regras?.votacao);
const abas = () => [
  ['fila', 'Fila'],
  ['busca', 'Catálogo'],
  ['meus', 'Pedidos'],
  ...(votacaoLigada() ? [['ranking', 'Ranking']] : []),
];

function montarFesta() {
  if (!abas().some(([id]) => id === s.aba)) s.aba = 'fila';
  app.innerHTML = `
    ${cabecalho()}
    <main class="conteudo">
      <div class="pilha" data-aba="fila" style="gap: 18px;"></div>
      <div class="pilha" data-aba="busca">
        <label for="busca" class="rotulo" style="font-size: 13px;">Buscar música</label>
        <div class="busca">${LUPA}<input id="busca" type="search" enterkeyhint="search" autocomplete="off" placeholder="Música, artista ou trecho da letra"></div>
        <div class="pilulas" id="modos">
          <button type="button" class="pilula" data-modo="musicas">Músicas</button>
          <button type="button" class="pilula" data-modo="artistas">Artistas</button>
        </div>
        <div class="pilulas" id="filtros">
          <button type="button" class="pilula" data-filtro="">Todas</button>
          <button type="button" class="pilula" data-filtro="nacionais">Nacionais</button>
          <button type="button" class="pilula" data-filtro="internacionais">Internacionais</button>
        </div>
        <div class="pilulas" id="generos" hidden></div>
        <div id="resultado-busca" class="pilha"></div>
        <div id="mais-busca" class="sec centro" style="padding: 12px;"></div>
      </div>
      <div class="pilha" data-aba="meus"></div>
      <div class="pilha" data-aba="ranking" style="gap: 16px;">
        <div class="pilha" id="ranking-lista" style="gap: 10px;"></div>
        <div id="ranking-pix"></div>
        <div id="ranking-email"></div>
      </div>
    </main>
    <nav class="menu" aria-label="Seções"><div class="menu-dentro" id="menu"></div></nav>`;

  let espera;
  $('#busca').value = s.busca.q;
  $('#busca').oninput = (ev) => {
    clearTimeout(espera);
    s.busca.q = ev.target.value;
    if (s.busca.modo === 'artistas') {
      s.busca.mostrarArtistas = PASSO_ARTISTAS;
      return renderBusca();
    }
    espera = setTimeout(buscar, 250);
  };
  $('#modos').onclick = (ev) => {
    const b = ev.target.closest('[data-modo]');
    if (!b || b.dataset.modo === s.busca.modo) return;
    trocarModo(b.dataset.modo);
  };
  $('#filtros').onclick = (ev) => {
    const b = ev.target.closest('[data-filtro]');
    if (!b) return;
    s.busca.filtro = b.dataset.filtro;
    if (s.busca.modo === 'artistas') carregarArtistas();
    else buscar();
    carregarGeneros();
  };
  $('#generos').onclick = (ev) => {
    const b = ev.target.closest('[data-genero]');
    if (!b || b.dataset.genero === s.busca.genero) return;
    s.busca.genero = b.dataset.genero;
    if (s.busca.modo === 'artistas') carregarArtistas();
    else buscar();
  };
  // Rolagem infinita: quando o fim da lista aparece, carrega a próxima página.
  new IntersectionObserver((vistos) => {
    if (vistos.some((v) => v.isIntersecting)) carregarMais();
  }, { rootMargin: '400px' }).observe($('#mais-busca'));
  $('#menu').onclick = (ev) => {
    const b = ev.target.closest('[data-ir]');
    if (b) irPara(b.dataset.ir);
  };
  app.onclick = aoClicar;
  buscar();
  carregarGeneros();
  atualizar();
}

function irPara(aba) {
  s.aba = aba;
  atualizar();
  window.scrollTo(0, 0);
  if (aba === 'busca' && !s.busca.musicas.length) buscar();
}

function atualizar() {
  if (s.tela === 'encerrada') return renderRanking($('#ranking-final'), true);
  if (s.tela !== 'festa') return;
  for (const el of app.querySelectorAll('[data-aba]')) el.hidden = el.dataset.aba !== s.aba;
  const ativos = s.estado.limite.ativos;
  $('#menu').innerHTML = abas()
    .map(([id, nome]) => `<button type="button" data-ir="${id}" ${s.aba === id ? 'aria-current="page"' : ''}>${nome}${id === 'meus' && ativos ? ` (${ativos})` : ''}</button>`)
    .join('');
  if (s.aba === 'fila') renderFila();
  if (s.aba === 'busca') renderBusca();
  if (s.aba === 'meus') renderMeus();
  if (s.aba === 'ranking') {
    renderRanking($('#ranking-lista'));
    renderPix();
    renderEmail();
  }
}

// ---------- Fila ----------

// Quem está na fila (menos o próximo) pode avançar depois de alguns minutos (SPEC 8.4).
let timerLiberar = null;

function botaoTerminou(a) {
  clearTimeout(timerLiberar);
  if (a.meu || !a.liberado_em) return '';
  const falta = Date.parse(a.liberado_em) - Date.now();
  if (falta > 0) {
    timerLiberar = setTimeout(() => { if (s.aba === 'fila') renderFila(); }, falta + 500);
    return '';
  }
  return `<button type="button" class="btn btn-palco-claro btn-pequeno" style="margin-top: 12px; width: 100%;" data-acao="terminou" data-id="${a.id}" data-cantor="${esc(a.cantor)}">${esc(a.cantor)} já terminou?</button>`;
}

// "Ativar avisos" ou, no Safari do iPhone, como adicionar à Tela de Início (SPEC 9.3).
function cartaoAvisos() {
  const tipo = cartaoDesejado(s.festa.push_chave);
  if (!tipo) return '';
  if (tipo === 'iphone') prepararTelaDeInicio();
  const texto = {
    iphone: 'No iPhone, os avisos só chegam com o app na Tela de Início: toque em Compartilhar e depois em <strong>Adicionar à Tela de Início</strong>. Abra por lá e permita as notificações.',
    ativar: 'Receba um aviso quando sua música for a próxima e os recados da festa, como a hora do parabéns.',
    sininho: 'Se o navegador mostrou um <strong>sininho na barra de endereço</strong>, toque nele e escolha <strong>Permitir</strong>.',
    bloqueado: 'As notificações estão bloqueadas para este site. Para receber os avisos, toque no ícone à esquerda do endereço, depois em <strong>Permissões</strong> e libere as <strong>Notificações</strong>.',
  }[tipo];
  const pode = tipo === 'ativar' || tipo === 'sininho';
  return `
    <section class="cartao-decor pilha" style="gap: 10px;" aria-label="Avisos">
      <span class="titulo-item">Avisos no celular</span>
      <span class="sec" style="font-size: 14px; line-height: 1.4;">${texto}</span>
      <div class="linha" style="display: flex; gap: 8px; flex-wrap: wrap;">
        ${pode ? `<button type="button" class="btn btn-pequeno" data-acao="ativar-avisos">${tipo === 'sininho' ? 'Tentar de novo' : 'Ativar avisos'}</button>` : ''}
        <button type="button" class="btn btn-claro btn-pequeno" data-acao="dispensar-avisos">${pode ? 'Agora não' : 'Entendi'}</button>
      </div>
    </section>`;
}

// Recado para o telão (SPEC 9.4), só com a regra ligada.
function cartaoRecado() {
  if (!s.festa.regras.recados || s.estado.status !== 'aberta') return '';
  return `
    <section class="cartao-decor pilha" style="gap: 10px;" aria-label="Recado para o telão">
      <span class="titulo-item">Recado para o telão</span>
      <textarea id="recado-telao" class="entrada" style="height: auto; min-height: 64px; padding: 12px 16px;" maxlength="200" rows="2" placeholder="Ex.: Parabéns, aniversariante! 🎂"></textarea>
      ${barraEmojis('recado-telao', 100)}
      <button type="button" class="btn btn-pequeno" data-acao="recado-telao" style="align-self: flex-start;">Mandar para o telão</button>
      <span class="sec" style="font-size: 12px;">Aparece no telão para todos, com o seu nome.</span>
    </section>`;
}

function renderFila() {
  const e = s.estado;
  const a = e.atual;
  const palco = a
    ? `
      <div class="entre" style="align-items: flex-end;">
        <div class="cresce pilha" style="gap: 4px;">
          <span class="titulo-musica">${esc(a.titulo)}</span>
          <span class="sub">${esc(a.artista)}</span>
        </div>
        <div class="codigo"><small>CÓDIGO</small><strong>${esc(a.cod)}</strong></div>
      </div>
      <div class="cantor">${MICROFONE}<span class="destaque">${esc(a.cantor)}</span></div>
      ${a.meu ? `
        <div class="minha-vez">
          <span class="rotulo" style="letter-spacing: 0.18em;">É a sua vez!</span>
          <span class="destaque" style="font-size: 32px;">Cantou?</span>
          <button type="button" class="btn" style="height: 48px;" data-acao="cantou" data-id="${a.id}">Sim, já cantei</button>
        </div>` : botaoTerminou(a)}`
    : '<p class="destaque palco-livre">O palco está livre!</p>';

  const votos = e.votacoes.filter((v) => !v.meu).map(cartaoVoto).join('');
  const proximos = e.proximos.length
    ? e.proximos.map((p, i) => `
        <div class="item ${p.meu ? 'item-meu' : ''}" style="padding: 10px 12px;">
          <span class="num">${i + 1}</span>
          <div class="cresce">
            <div class="titulo-item cortar">${esc(p.cantor)}</div>
            <div class="sec cortar">${esc(p.titulo)} · ${esc(p.artista)}</div>
          </div>
          ${p.meu ? '<span class="selo selo-escuro">VOCÊ</span>' : ''}
        </div>`).join('')
    : '<p class="sec centro" style="padding: 12px;">Ninguém na fila ainda. Peça uma música no Catálogo!</p>';

  // O polling redesenha a aba: o recado em digitação continua onde estava.
  const campo = $('#recado-telao');
  const digitado = campo ? { valor: campo.value, ini: campo.selectionStart, fim: campo.selectionEnd, focado: document.activeElement === campo } : null;

  $('[data-aba="fila"]').innerHTML = `
    ${cartaoAvisos()}
    <section class="palco no-palco" aria-label="Música da vez">
      <div class="filete"><span class="rotulo-p">Agora no palco</span></div>
      ${palco}
    </section>
    ${votos}
    <section class="pilha" style="gap: 8px;" aria-label="Próximos cantores">
      <div class="cabeca-sec"><h2>Próximos 10</h2><span class="sec">${e.total_fila} na fila</span></div>
      ${proximos}
    </section>
    ${cartaoRecado()}`;

  const novo = $('#recado-telao');
  if (novo && digitado) {
    novo.value = digitado.valor;
    if (digitado.focado) {
      novo.focus();
      novo.setSelectionRange(digitado.ini, digitado.fim);
    }
  }
  contarCampo('recado-telao');
}

function botoesNota(v) {
  return `<div class="notas" role="group" aria-label="Nota de 0 a 10">${Array.from({ length: 11 }, (_, n) => `
    <button type="button" class="nota" data-acao="votar" data-id="${v.pedido_id}" data-nota="${n}"
      aria-pressed="${v.meu_voto === n}" aria-label="Nota ${n} para ${esc(v.cantor)}">${n}</button>`).join('')}</div>`;
}

function rodapeVoto(v) {
  return `${v.meu_voto != null ? `Seu voto: ${v.meu_voto} (dá para mudar) · ` : ''}${plural(v.n_votos, 'voto', 'votos')} até agora. A nota aparece quando a votação fechar.`;
}

function cartaoVoto(v) {
  if (v.status === 'na_vez') {
    return `
      <section class="cartao-decor pilha" aria-label="Nota da festa: performance atual">
        <div class="filete">${icone()}<span class="rotulo-p">Nota da festa</span>${icone()}</div>
        <p class="centro" style="font-size: 15px; line-height: 1.4;">Quanto vale a performance de <span class="destaque" style="font-size: 26px;">${esc(v.cantor)}</span>?</p>
        ${botoesNota(v)}
        <span class="sec centro">${rodapeVoto(v)}</span>
      </section>`;
  }
  return `
    <section class="voto-anterior" aria-label="Nota da festa: performance anterior">
      <p style="font-size: 13px; line-height: 1.4;"><span class="rotulo-p" style="letter-spacing: 0.12em;">Ainda dá tempo de votar</span><br>${esc(v.cantor)} · ${esc(v.titulo)}</p>
      ${botoesNota(v)}
      <span class="sec">${rodapeVoto(v)}</span>
    </section>`;
}

// ---------- Catálogo ----------

// mais = true pede a página seguinte da mesma busca (rolagem infinita).
async function buscar({ mais = false } = {}) {
  const b = s.busca;
  if (mais && (b.carregando || b.musicas.length >= b.total)) return;
  const geracao = mais ? b.geracao : ++b.geracao;
  const params = new URLSearchParams({ q: b.q.trim(), filtro: b.filtro, offset: mais ? b.musicas.length : 0 });
  if (b.artista) params.set('artista', b.artista.chave);
  if (b.genero) params.set('genero', b.genero);
  b.carregando = true;
  try {
    const r = await api('GET', `/api/musicas?${params}`);
    if (geracao !== b.geracao) return; // resposta atrasada
    const vistas = new Set(mais ? b.musicas.map((m) => m.cod) : []);
    b.musicas = [...(mais ? b.musicas : []), ...r.musicas.filter((m) => !vistas.has(m.cod))];
    b.total = r.total;
  } catch (e) {
    if (geracao === b.geracao) avisar(e.message);
  } finally {
    if (geracao === b.geracao) b.carregando = false;
  }
  if (geracao === b.geracao && s.aba === 'busca' && b.modo === 'musicas') {
    renderBusca();
    if (fimVisivel()) carregarMais();
  }
}

// Chips de gênero: só com o filtro ligado no setup, recarregados quando muda Nacionais/Internacionais.
async function carregarGeneros() {
  const b = s.busca;
  if (!s.festa.filtro_genero) return;
  const filtro = b.filtro;
  if (!b.generos[filtro]) {
    try {
      b.generos[filtro] = (await api('GET', `/api/generos?filtro=${filtro}`)).generos;
    } catch {
      return; // sem chips; a busca continua funcionando
    }
  }
  if (b.filtro !== filtro) return;
  if (b.genero && !b.generos[filtro].some((g) => g.nome === b.genero)) {
    b.genero = '';
    if (b.modo === 'artistas') carregarArtistas();
    else buscar();
  }
  renderGeneros();
}

function renderGeneros() {
  const b = s.busca;
  const alvo = $('#generos');
  const lista = b.generos[b.filtro] ?? [];
  alvo.hidden = !s.festa.filtro_genero || !lista.length;
  if (alvo.hidden) return;
  alvo.innerHTML = [{ nome: '' }, ...lista]
    .map((g) => `<button type="button" class="pilula" data-genero="${esc(g.nome)}" aria-pressed="${g.nome === b.genero}">${g.nome ? esc(g.nome) : 'Todos os gêneros'}</button>`)
    .join('');
}

async function carregarArtistas() {
  const b = s.busca;
  const chave = chaveArtistas();
  b.mostrarArtistas = PASSO_ARTISTAS;
  if (!b.artistas[chave]) {
    renderBusca();
    try {
      const params = new URLSearchParams({ filtro: b.filtro });
      if (b.genero) params.set('genero', b.genero);
      b.artistas[chave] = (await api('GET', `/api/artistas?${params}`)).artistas;
    } catch (e) {
      return avisar(e.message);
    }
  }
  if (s.aba === 'busca' && b.modo === 'artistas' && chaveArtistas() === chave) renderBusca();
}

// A lista de artistas muda com o idioma e com o gênero (SPEC 5.7).
function chaveArtistas() {
  return `${s.busca.filtro}|${s.busca.genero}`;
}

function carregarMais() {
  if (s.aba !== 'busca') return;
  const b = s.busca;
  if (b.modo === 'musicas') return buscar({ mais: true });
  const lista = artistasFiltrados();
  if (b.mostrarArtistas >= lista.length) return;
  b.mostrarArtistas += PASSO_ARTISTAS;
  renderBusca();
  if (fimVisivel()) requestAnimationFrame(carregarMais);
}

function fimVisivel() {
  const fim = $('#mais-busca');
  return fim && !fim.hidden && fim.getBoundingClientRect().top < innerHeight + 400;
}

function trocarModo(modo, artista = null) {
  const b = s.busca;
  b.modo = modo;
  b.artista = artista;
  b.q = '';
  $('#busca').value = '';
  $('#busca').placeholder = modo === 'artistas' ? 'Nome do artista' : 'Música, artista ou trecho da letra';
  window.scrollTo(0, 0);
  if (modo === 'artistas') carregarArtistas();
  else {
    b.musicas = [];
    b.total = 0;
    renderBusca();
    buscar();
  }
}

// Mesma ideia da normalização do servidor, só o suficiente para filtrar a lista de artistas.
function simplificar(texto) {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/(\p{L})\1+/gu, '$1');
}

function artistasFiltrados() {
  const lista = s.busca.artistas[chaveArtistas()] ?? [];
  const termo = simplificar(s.busca.q);
  if (!termo) return lista;
  return lista.filter((a) => a.chave.includes(termo) || simplificar(a.nome).includes(termo));
}

// "Você pode gostar" (SPEC 5.6): busca de novo quando os pedidos da pessoa mudam.
async function atualizarSugestao() {
  const b = s.busca;
  const meus = s.estado.meus_pedidos;
  const chave = meus.map((p) => `${p.id}:${p.status}`).join(',');
  if (chave === b.sugestaoChave) return;
  b.sugestaoChave = chave;
  if (!meus.some((p) => p.status === 'cantou')) {
    b.sugestao = null;
    return;
  }
  try {
    const { sugestao } = await api('GET', '/api/sugestao');
    if (b.sugestaoChave !== chave) return;
    b.sugestao = sugestao;
    if (s.aba === 'busca') renderBusca();
  } catch {
    // Sugestão é extra: se falhar, o catálogo segue normal.
  }
}

function itemMusica(m, { naFila, cheio }) {
  const pedida = naFila.has(m.cod);
  return `
      <div class="item">
        <div class="cresce pilha" style="gap: 2px;">
          <span class="titulo-item">${esc(m.titulo)}</span>
          <span class="sec" style="font-size: 13px;">${esc(m.artista)} · cód. ${esc(m.cod)}</span>
          ${m.inicio ? `<span class="letra cortar">“${esc(m.inicio)}”</span>` : ''}
        </div>
        <button type="button" class="btn btn-pedir" data-acao="pedir" data-cod="${esc(m.cod)}" data-titulo="${esc(m.titulo)}"
          ${pedida || cheio ? 'disabled' : ''} aria-label="${pedida ? 'Já pedida' : 'Pedir'}: ${esc(m.titulo)}">${pedida ? 'Na fila' : 'Pedir'}</button>
      </div>`;
}

function renderBusca() {
  const b = s.busca;
  for (const el of app.querySelectorAll('[data-filtro]')) el.setAttribute('aria-pressed', String(el.dataset.filtro === b.filtro));
  for (const el of app.querySelectorAll('[data-modo]')) el.setAttribute('aria-pressed', String(el.dataset.modo === b.modo));
  renderGeneros();
  atualizarSugestao();
  if (b.modo === 'artistas') return renderArtistas();

  const { maximo, ativos } = s.estado.limite;
  const cheio = ativos >= maximo;
  const naFila = new Set(s.estado.meus_pedidos.filter((p) => p.status !== 'cantou').map((p) => p.cod));
  const { musicas, total } = b;
  const resumo = b.carregando && !musicas.length ? 'Buscando…' : total === 0 ? 'Nenhuma música encontrada' : plural(total, 'música', 'músicas');
  const sugestao = !b.q.trim() && !b.artista && b.sugestao;
  $('#resultado-busca').innerHTML = `
    ${cheio ? `<p class="aviso">Você já tem ${plural(maximo, 'música', 'músicas')} na fila. Cancele uma em Meus pedidos para pedir outra.</p>` : ''}
    ${b.artista ? `
      <div class="pilulas"><button type="button" class="pilula" aria-pressed="true" data-acao="sem-artista" aria-label="Tirar o filtro de artista">Artista: ${esc(b.artista.nome)} ✕</button></div>` : ''}
    ${sugestao ? `
      <div class="pilha" style="gap: 6px;">
        <span class="rotulo" style="font-size: 13px;">Você pode gostar</span>
        <span class="sec" style="font-size: 13px;">Porque você cantou ${esc(sugestao.artista)}</span>
        ${itemMusica(sugestao.musica, { naFila, cheio })}
      </div>` : ''}
    <span class="sec">${resumo}</span>
    ${musicas.map((m) => itemMusica(m, { naFila, cheio })).join('')}`;
  const fim = $('#mais-busca');
  fim.hidden = musicas.length >= total;
  fim.textContent = b.carregando ? 'Carregando mais…' : '';
}

function renderArtistas() {
  const b = s.busca;
  const fim = $('#mais-busca');
  const carregada = b.artistas[chaveArtistas()];
  if (!carregada) {
    $('#resultado-busca').innerHTML = '<span class="sec">Carregando artistas…</span>';
    fim.hidden = true;
    return;
  }
  const lista = artistasFiltrados();
  let letra = null;
  const linhas = lista.slice(0, b.mostrarArtistas).map((a, i) => {
    const inicial = simplificar(a.nome).charAt(0).toUpperCase();
    const grupo = /[A-Z]/.test(inicial) ? inicial : '#';
    const cabeca = grupo !== letra ? `<h3 class="rotulo" style="font-size: 13px; margin-top: 8px;">${grupo}</h3>` : '';
    letra = grupo;
    return `${cabeca}
      <button type="button" class="item" style="text-align: left; width: 100%;" data-acao="artista" data-i="${i}">
        <span class="cresce titulo-item">${esc(a.nome)}</span>
        <span class="sec" style="font-size: 13px;">${plural(a.total, 'música', 'músicas')}</span>
      </button>`;
  });
  $('#resultado-busca').innerHTML = `
    <span class="sec">${lista.length ? plural(lista.length, 'artista', 'artistas') : 'Nenhum artista encontrado'}</span>
    ${linhas.join('')}`;
  fim.hidden = b.mostrarArtistas >= lista.length;
  fim.textContent = '';
}

// ---------- Pedidos ----------

function renderMeus() {
  const e = s.estado;
  const ativos = e.meus_pedidos.filter((p) => p.status !== 'cantou');
  const cantadas = e.meus_pedidos.filter((p) => p.status === 'cantou');
  $('[data-aba="meus"]').innerHTML = `
    <div class="cabeca-sec"><h2>Meus pedidos</h2><span class="sec">${e.limite.ativos} de ${e.limite.maximo}</span></div>
    ${ativos.length ? '' : `
      <div class="vazio">
        <span class="destaque">Nenhuma música na fila</span>
        <button type="button" class="btn" data-ir-aba="busca">Escolher música</button>
      </div>`}
    ${ativos.map((p) => `
      <div class="item">
        <div class="centro" style="width: 52px; flex-shrink: 0; display: flex; flex-direction: column;">
          <span style="font-size: 20px; font-weight: 700;">${p.posicao === 0 ? 'Agora' : p.posicao != null ? `${p.posicao}º` : '–'}</span>
          <span class="sec" style="font-size: 10px;">${p.status === 'na_vez' ? 'no palco' : p.espera_min != null ? `~${p.espera_min} min` : ''}</span>
        </div>
        <div class="cresce pilha" style="gap: 2px;">
          <span class="titulo-item">${esc(p.titulo)}</span>
          <span class="sec">${esc(p.artista)} · cód. ${esc(p.cod)}</span>
        </div>
        ${p.status === 'pendente' ? `<button type="button" class="btn btn-alerta btn-pequeno" data-acao="cancelar" data-id="${p.id}" aria-label="Cancelar ${esc(p.titulo)}">Cancelar</button>` : ''}
      </div>`).join('')}
    ${cantadas.length ? `
      <div class="cabeca-sec" style="margin-top: 8px;"><h2>Já cantei</h2></div>
      ${cantadas.map((p) => `
        <div class="linha" style="padding: 10px 12px; border-bottom: 1px solid var(--borda);">
          <span style="fill: var(--decor); display: flex;">${icone()}</span>
          <span style="font-size: 14px;">${esc(p.titulo)} · <span class="sec" style="font-size: 14px;">${esc(p.artista)}</span></span>
        </div>`).join('')}` : ''}`;
}

// ---------- Ranking ----------

async function carregarRanking(tipo) {
  const r = await api('GET', `/api/ranking?tipo=${tipo}`);
  return r.ranking;
}

async function renderRanking(alvo, final = false) {
  if (!alvo) return;
  const regras = s.festa.regras;
  const comPessoas = Boolean(regras.ranking_pessoas);
  const versao = s.estado?.versao;
  // Primeira vez: abre em Pessoas; se vazio, cai em Performances com aviso (SPEC 9).
  if (!s.ranking.tipo || s.ranking.versao !== versao) {
    try {
      if (!s.ranking.tipo) {
        s.ranking.tipo = comPessoas ? 'pessoas' : 'performances';
        if (comPessoas) {
          const pessoas = await carregarRanking('pessoas');
          s.ranking.pessoasVazio = !pessoas.length;
          if (!pessoas.length) s.ranking.tipo = 'performances';
        }
      }
      s.ranking.lista = await carregarRanking(s.ranking.tipo);
      if (s.ranking.tipo === 'pessoas') s.ranking.pessoasVazio = !s.ranking.lista.length;
      s.ranking.versao = versao;
    } catch (e) {
      alvo.innerHTML = `<p class="aviso aviso-alerta">${esc(e.message)}</p>`;
      return;
    }
  }
  const tipo = s.ranking.tipo;
  const legenda = tipo === 'pessoas'
    ? `Média das notas de cada pessoa · mínimo de ${plural(regras.minimo_performances, 'performance', 'performances')}`
    : `Mediana dos votos de 0 a 10 · mínimo de ${plural(regras.minimo_votos, 'voto', 'votos')}`;
  const itens = s.ranking.lista.map((r, i) => {
    const topo = i === 0 ? 'rank-topo' : '';
    if (tipo === 'pessoas') {
      return `
        <div class="rank ${topo}">
          <span class="pos">${r.posicao}</span>
          <div class="cresce pilha" style="gap: 2px;">
            <span class="destaque">${esc(r.nome)}</span>
            <span class="sub cortar">${plural(r.n_performances, 'performance', 'performances')} · melhor: ${formatar(r.melhor)}</span>
          </div>
          <div class="codigo"><span class="valor">${esc(r.media_texto)}</span><span class="sub">média</span></div>
        </div>`;
    }
    return `
      <div class="rank ${topo}">
        <span class="pos">${r.posicao}</span>
        <div class="cresce pilha" style="gap: 2px;">
          <span class="destaque">${esc(r.cantor)}</span>
          <span class="sub cortar">${esc(r.titulo)} · ${esc(r.artista)}</span>
        </div>
        <div class="codigo"><span class="valor">${esc(r.nota_texto)}</span><span class="sub">${plural(r.n_votos, 'voto', 'votos')}</span></div>
      </div>`;
  });
  const abertas = final ? [] : (s.estado?.votacoes ?? []).filter((v) => v.status === 'cantou');
  alvo.innerHTML = `
    <div class="centro pilha" style="gap: 2px; align-items: center; padding-bottom: 4px;">
      <span class="rotulo-p">Nota da festa</span>
      <span class="destaque" style="font-size: 44px; line-height: 1.1;">${final ? 'Ranking final' : 'Ranking'}</span>
      ${filete()}
      <span class="sec" style="padding-top: 4px;">${legenda}</span>
    </div>
    ${comPessoas ? `
      <div class="alternador" role="group" aria-label="Tipo de ranking">
        <button type="button" data-acao="tipo-ranking" data-tipo="pessoas" aria-pressed="${tipo === 'pessoas'}">Pessoas</button>
        <button type="button" data-acao="tipo-ranking" data-tipo="performances" aria-pressed="${tipo === 'performances'}">Performances</button>
      </div>` : ''}
    ${comPessoas && tipo === 'performances' && s.ranking.pessoasVazio
      ? `<p class="aviso">O ranking de pessoas aparece quando alguém tiver ${plural(regras.minimo_performances, 'performance', 'performances')} com nota.</p>` : ''}
    ${itens.length ? itens.join('') : '<p class="destaque centro" style="padding: 24px; font-size: 28px;">Nenhuma votação fechada ainda</p>'}
    ${abertas.map((v) => `<p class="aviso" style="margin-top: 4px;">Votação aberta para ${esc(v.cantor)} (${esc(v.titulo)}). Entra no ranking quando a próxima performance terminar.</p>`).join('')}`;
}

// Prêmio por Pix (SPEC 9.2): só mostra a chave de quem organiza; o app não confere pagamentos.
function renderPix() {
  const alvo = $('#ranking-pix');
  const pix = s.estado.status === 'aberta' ? s.festa.pix : '';
  const mensagem = s.festa.pix_mensagem || 'Quem quiser contribuir faz um Pix para quem organiza a festa, que repassa a quem ganhar o ranking.';
  const chave = pix ? `${pix}\n${mensagem}` : '';
  if (alvo.dataset.pix === chave && (alvo.childElementCount || !pix)) return;
  alvo.dataset.pix = chave;
  if (!pix) {
    alvo.innerHTML = '';
    return;
  }
  const copiaECola = pix.startsWith('000201');
  alvo.innerHTML = `
    <div class="cartao-decor pilha" style="gap: 10px;">
      <span class="destaque" style="font-size: 22px;">Prêmio de quem ganhar</span>
      <span style="white-space: pre-line;">${esc(mensagem)}</span>
      <span class="sec" style="font-size: 13px;">${copiaECola ? 'Pix copia e cola' : 'Chave Pix'}</span>
      <strong style="overflow-wrap: anywhere;${copiaECola ? ' font-size: 12px; font-weight: normal;' : ''}">${esc(pix)}</strong>
      <button type="button" class="btn btn-pequeno" id="copiar-pix" style="align-self: flex-start;">Copiar</button>
    </div>`;
  $('#copiar-pix').onclick = async () => {
    try {
      await navigator.clipboard.writeText(pix);
      avisar(copiaECola ? 'Pix copia e cola copiado.' : 'Chave Pix copiada.');
    } catch {
      prompt('Copie a chave Pix:', pix);
    }
  };
}

// Ranking por e-mail (SPEC 9.1). Só redesenha quando o e-mail salvo muda, para não apagar o que está sendo digitado.
let emailDesenhado;
function renderEmail() {
  const alvo = $('#ranking-email');
  const ativo = s.festa.email_ranking && s.estado.status === 'aberta';
  const email = s.estado.me?.email ?? null;
  const chave = ativo ? `on:${email ?? ''}` : 'off';
  if (chave === emailDesenhado && alvo.childElementCount) return;
  emailDesenhado = chave;
  if (!ativo) {
    alvo.innerHTML = '';
    return;
  }
  const aviso = 'Usamos seu e-mail só para mandar o ranking desta festa quando ela terminar. Depois do envio, ele é apagado.';
  if (email) {
    alvo.innerHTML = `
      <div class="cartao-decor pilha" style="gap: 10px;">
        <span class="destaque" style="font-size: 22px;">Ranking por e-mail</span>
        <span>Vamos mandar o ranking final para <strong>${esc(email)}</strong> quando a festa terminar.</span>
        <button type="button" class="btn btn-alerta btn-pequeno" data-acao="sem-email" style="align-self: flex-start;">Não quero mais</button>
      </div>`;
    return;
  }
  alvo.innerHTML = `
    <form class="cartao-decor pilha" id="form-email" style="gap: 10px;" novalidate>
      <span class="destaque" style="font-size: 22px;">Quer o ranking final por e-mail?</span>
      <div class="campo">
        <label for="email">Seu e-mail</label>
        <input id="email" class="entrada" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="voce@exemplo.com">
      </div>
      <button type="submit" class="btn">Quero receber</button>
      <span class="sec" style="font-size: 12px;">${aviso}</span>
    </form>`;
  $('#form-email').onsubmit = async (ev) => {
    ev.preventDefault();
    const botao = ev.submitter;
    botao.disabled = true;
    try {
      await api('PUT', '/api/me/email', { email: $('#email').value });
      avisar('Combinado! O ranking chega no seu e-mail quando a festa terminar.');
      await poll.agora();
    } catch (e) {
      avisar(e.message);
      botao.disabled = false;
    }
  };
}

const formatar = (n) => (n == null ? '' : (Math.round(n * 10) / 10).toFixed(1).replace('.', ','));

// ---------- Encerrada ----------

function montarEncerrada() {
  const f = s.festa;
  app.innerHTML = `
    ${cabecalho()}
    <main class="conteudo" style="padding-bottom: 32px;">
      ${f.arte_url ? `<img class="arte" src="${esc(f.arte_url)}" alt="Arte da festa">` : ''}
      <div class="centro pilha" style="align-items: center; gap: 8px;">
        <p class="destaque" style="font-size: 56px;">Obrigado!</p>
        <p class="sec" style="font-size: 14px;">A festa terminou. Pedidos e votos estão encerrados.</p>
      </div>
      ${votacaoLigada() ? '<div class="pilha" id="ranking-final" style="gap: 10px;"></div>' : ''}
    </main>`;
  app.onclick = aoClicar;
  s.ranking.tipo = null;
  atualizar();
}

// ---------- Ações ----------

async function aoClicar(ev) {
  const irAba = ev.target.closest('[data-ir-aba]');
  if (irAba) return irPara(irAba.dataset.irAba);
  const b = ev.target.closest('[data-acao]');
  if (!b || b.disabled) return;
  const { acao, id } = b.dataset;
  try {
    if (acao === 'pedir') {
      b.disabled = true;
      const { posicao_estimada: pos } = await api('POST', '/api/pedidos', { musica_cod: b.dataset.cod });
      const min = s.festa.regras.minutos_por_musica;
      avisar(`${b.dataset.titulo} entrou na fila. ${pos === 0 ? 'É a sua vez!' : pos === 1 ? 'Você é o próximo!' : `Posição estimada: ${pos}º (~${pos * min} min).`}`);
    } else if (acao === 'cancelar') {
      b.disabled = true;
      await api('DELETE', `/api/pedidos/${id}`);
      avisar('Pedido cancelado.');
    } else if (acao === 'cantou') {
      b.disabled = true;
      await api('POST', `/api/pedidos/${id}/cantou`);
      avisar(votacaoLigada() ? 'Arrasou! A galera está votando na sua nota.' : 'Arrasou! A fila andou.');
    } else if (acao === 'terminou') {
      if (!confirm(`Confirmar que ${b.dataset.cantor} já terminou de cantar? A fila vai andar.`)) return;
      b.disabled = true;
      await api('POST', `/api/pedidos/${id}/cantou`);
      avisar('Valeu! A fila andou.');
    } else if (acao === 'votar') {
      const nota = Number(b.dataset.nota);
      await api('PUT', '/api/votos', { pedido_id: Number(id), nota });
      avisar(`Voto registrado: ${nota}.`);
    } else if (acao === 'artista') {
      const artista = artistasFiltrados()[Number(b.dataset.i)];
      if (artista) trocarModo('musicas', { nome: artista.nome, chave: artista.chave });
      return;
    } else if (acao === 'sem-email') {
      b.disabled = true;
      await api('DELETE', '/api/me/email');
      avisar('Pronto, apagamos seu e-mail.');
    } else if (acao === 'sem-artista') {
      return trocarModo('musicas');
    } else if (acao === 'ativar-avisos') {
      const permissao = await pedirPermissao(s.festa.push_chave);
      if (permissao === 'granted' && await inscrever(s.festa.push_chave)) avisar('Pronto! Você vai receber os avisos.');
      return renderFila();
    } else if (acao === 'dispensar-avisos') {
      dispensar();
      return renderFila();
    } else if (acao === 'recado-telao') {
      const campo = $('#recado-telao');
      const texto = campo.value.trim();
      if (!texto) return campo.focus();
      b.disabled = true;
      await api('POST', '/api/recados', { texto });
      campo.value = '';
      avisar('Recado enviado! Olhe o telão.');
    } else if (acao === 'tipo-ranking') {
      s.ranking.tipo = b.dataset.tipo;
      s.ranking.versao = null;
      return atualizar();
    }
    await poll.agora();
  } catch (e) {
    avisar(e.message);
    if (e.status === 401 || e.status === 403) await poll.agora();
    else atualizar();
  }
}

// ---------- Início ----------

try {
  await entrarPeloToken();
  ligarEmojis();
  vigiarPermissao(async () => {
    if (s.aba === 'fila') renderFila();
    if (await inscrever(s.festa?.push_chave).catch(() => false)) avisar('Pronto! Você vai receber os avisos.');
  });
  await carregarFesta();
  poll = vigiar('/api/estado', aoEstado, { aoErro: () => {} });
} catch (e) {
  app.innerHTML = `<div class="moldura"><p class="destaque" style="font-size: 40px;">Ops!</p><p class="sec">${esc(e.message)}</p></div>`;
}
