// Painel do admin (SPEC 12): login por PIN, Operação e menu Festa.
import { $, esc, api, vigiar, avisar, icone, filete, definirIcone, plural, formatarDuracao } from './comum.js';

const app = $('#app');
const s = { festa: null, estado: null, pessoas: [], versaoPessoas: null, aba: 'operacao', busca: [] };
let poll;

const CADEADO = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const SETA_CIMA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
const SETA_BAIXO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

async function carregarFesta() {
  s.festa = await api('GET', '/api/festa');
  definirIcone(s.festa.tema?.icone);
  document.title = `Admin · ${s.festa.titulo || 'Karaokê'}`;
}

// ---------- Login ----------

function montarLogin() {
  app.innerHTML = `
    <form class="moldura" id="form-login" novalidate>
      <p class="rotulo">Painel do admin</p>
      <p class="destaque" style="font-size: 52px;">${esc(s.festa.nome_destaque || 'Karaokê')}</p>
      ${filete()}
      <div class="campo" style="width: 100%;">
        <label for="pin">PIN do admin</label>
        <input id="pin" class="entrada" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" placeholder="4 a 8 dígitos">
        <span class="erro-campo" id="erro-pin" hidden></span>
      </div>
      <button type="submit" class="btn btn-grande">Entrar</button>
    </form>`;
  $('#pin').focus();
  $('#form-login').onsubmit = async (ev) => {
    ev.preventDefault();
    const botao = ev.submitter;
    botao.disabled = true;
    try {
      await api('POST', '/api/admin/login', { pin: $('#pin').value.trim() });
      iniciarPainel();
    } catch (e) {
      $('#erro-pin').textContent = e.message;
      $('#erro-pin').hidden = false;
      $('#pin').select();
    } finally {
      botao.disabled = false;
    }
  };
}

// ---------- Painel ----------

function iniciarPainel() {
  app.className = 'app';
  app.innerHTML = `
    <header class="topo topo-admin">
      <div class="cresce">
        <p class="rotulo-p">Painel do admin</p>
        <p class="destaque">${esc(s.festa.nome_destaque)}${s.festa.subtitulo ? ` <span style="font-family: var(--fonte-base); font-size: 15px; font-weight: 700;">${esc(s.festa.subtitulo)}</span>` : ''}</p>
      </div>
      <span class="selo-pin">${CADEADO} PIN OK</span>
    </header>
    <nav class="abas" id="abas" aria-label="Seções do admin">
      <button type="button" data-aba="operacao">Operação</button>
      <button type="button" data-aba="festa">Festa</button>
    </nav>
    <main class="conteudo" style="padding-bottom: 40px; gap: 16px;" id="conteudo"></main>`;
  $('#abas').onclick = (ev) => {
    const b = ev.target.closest('[data-aba]');
    if (!b) return;
    s.aba = b.dataset.aba;
    render();
  };
  app.onclick = aoClicar;
  app.oninput = aoDigitar;
  poll = vigiar('/api/admin/estado', aoEstado, {
    aoErro: (e) => {
      if (e.status === 401) location.reload();
    },
  });
}

async function aoEstado(estado) {
  const statusMudou = s.estado && s.estado.status !== estado.status;
  s.estado = estado;
  if (statusMudou) await carregarFesta();
  if (s.versaoPessoas !== estado.versao) {
    s.pessoas = (await api('GET', '/api/admin/pessoas')).pessoas;
    s.versaoPessoas = estado.versao;
  }
  render();
}

function render() {
  for (const b of app.querySelectorAll('#abas [data-aba]')) {
    if (b.dataset.aba === s.aba) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (!s.estado) return;
  if (s.aba === 'festa') return renderFesta();
  renderOperacao();
}

function avisoStatus() {
  const st = s.estado.status;
  if (st === 'rascunho') return '<p class="aviso">A festa ainda não foi aberta. Termine o setup e use “Abrir festa” no último passo. <a href="/setup#publicar">Ir para o setup</a></p>';
  if (st === 'encerrada') return '<p class="aviso">Festa encerrada. Pedidos e votos estão bloqueados; os convidados veem o ranking final.</p>';
  return '';
}

function renderOperacao() {
  const e = s.estado;
  const r = e.regras;
  const a = e.atual;
  const fechada = e.status !== 'aberta';

  let dica = '';
  if (a) {
    const ultimo = a.pulos + 1 >= r.pulos_ate_sair;
    if (a.pulos === 0) {
      dica = ultimo ? 'Um pulo tira o pedido da fila.' : `Pular manda o pedido para o fim da rodada. No ${r.pulos_ate_sair}º pulo, sai da fila.`;
    } else {
      dica = `${a.cantor} já foi pulado ${a.pulos}x: ${ultimo ? 'um novo pulo tira o pedido da fila.' : `no ${r.pulos_ate_sair}º pulo, sai da fila.`}`;
    }
  }

  const palco = a
    ? `
      <div class="entre" style="align-items: flex-end;">
        <div class="cresce pilha" style="gap: 4px;">
          <span class="destaque" style="font-size: 30px; overflow-wrap: anywhere;">${esc(a.cantor)}</span>
          <span style="font-size: 16px; font-weight: 700;">${esc(a.titulo)}</span>
          <span class="sub" style="font-size: 13px;">${esc(a.artista)}</span>
        </div>
        <div class="codigo"><small>CÓDIGO</small><strong style="font-size: 32px;">${esc(a.cod)}</strong></div>
      </div>
      <div class="linha" style="gap: 8px; padding-top: 4px;">
        <button type="button" class="btn btn-palco cresce" style="height: 46px;" data-acao="cantou" ${fechada ? 'disabled' : ''}>Cantou</button>
        <button type="button" class="btn btn-palco-claro cresce" style="height: 46px;" data-acao="pular" ${fechada ? 'disabled' : ''}>Pular ausente</button>
      </div>
      <span class="sub" style="font-size: 12px;">${esc(dica)}</span>
      ${linhaMaquina(e.maquina, fechada)}`
    : '<p class="destaque palco-livre">Fila vazia</p>';

  const vipLigado = Boolean(r.vip);
  const vipDe = new Map(s.pessoas.map((p) => [p.id, p.vip]));
  const fila = e.fila.map((p, i) => {
    const anterior = i === 0 ? a : e.fila[i - 1];
    const seguida = anterior && anterior.pessoa_id === p.pessoa_id;
    const vip = vipDe.get(p.pessoa_id) ?? p.vip;
    return `
      <div class="item fila-item ${seguida ? 'item-seguida' : ''}">
        <div class="linha">
          <span class="num">${i + 1}</span>
          <div class="cresce">
            <div class="titulo-item cortar">${esc(p.cantor)}</div>
            <div class="sec cortar">${esc(p.titulo)} · ${esc(p.artista)} · cód. ${esc(p.cod)}</div>
          </div>
          <button type="button" class="seta" data-acao="mover" data-id="${p.id}" data-direcao="cima" ${i === 0 || fechada ? 'disabled' : ''} aria-label="Subir ${esc(p.cantor)}">${SETA_CIMA}</button>
          <button type="button" class="seta" data-acao="mover" data-id="${p.id}" data-direcao="baixo" ${i === e.fila.length - 1 || fechada ? 'disabled' : ''} aria-label="Descer ${esc(p.cantor)}">${SETA_BAIXO}</button>
        </div>
        <div class="fila-acoes">
          <button type="button" class="alternar" data-acao="bypass" data-id="${p.id}" aria-pressed="${p.bypass}" ${fechada ? 'disabled' : ''}>Bypass da regra</button>
          ${vipLigado ? `<button type="button" class="alternar" data-acao="vip" data-pessoa="${esc(p.pessoa_id)}" aria-pressed="${vip}" ${fechada ? 'disabled' : ''}>VIP</button>` : ''}
          ${p.pulos ? `<span class="selo">Pulou ${p.pulos}x</span>` : ''}
          ${seguida ? '<span class="selo selo-alerta">2 seguidas</span>' : ''}
        </div>
      </div>`;
  }).join('');

  const vips = s.pessoas.filter((p) => p.vip).length;
  const pessoas = s.pessoas.map((p) => {
    const resumo = [`${p.na_fila} na fila`, plural(p.cantadas, 'cantada', 'cantadas'), p.sem_celular ? 'sem celular' : ''].filter(Boolean).join(' · ');
    return `
      <div class="item" style="padding: 8px 12px;">
        <div class="cresce">
          <div class="titulo-item cortar">${esc(p.nome)}</div>
          <div class="sec">${resumo}</div>
        </div>
        ${vipLigado ? `<button type="button" class="alternar" data-acao="vip" data-pessoa="${esc(p.id)}" aria-pressed="${p.vip}" aria-label="VIP para ${esc(p.nome)}" ${fechada ? 'disabled' : ''}>VIP</button>` : ''}
      </div>`;
  }).join('');

  const nomeDigitado = $('#add-nome')?.value ?? '';
  const qDigitada = $('#add-q')?.value ?? '';
  const focado = document.activeElement?.id;

  $('#conteudo').innerHTML = `
    ${avisoStatus()}
    <div class="contadores">
      <div><strong>${e.contadores.na_fila}</strong><span>na fila</span></div>
      <div><strong>${e.contadores.cantadas}</strong><span>já cantaram</span></div>
      <div><strong>${formatarDuracao(e.contadores.na_fila * r.minutos_por_musica)}</strong><span>de fila</span></div>
    </div>
    <section class="palco no-palco" aria-label="Música da vez" style="padding: 16px;">
      <div class="filete"><span class="rotulo-p">Agora no palco</span></div>
      ${palco}
    </section>
    <section class="pilha" style="gap: 8px;" aria-label="Fila completa">
      <div class="cabeca-filete"><h2>Fila</h2><span class="traco"></span>${icone()}</div>
      ${fila || '<p class="sec centro" style="padding: 12px;">Ninguém esperando.</p>'}
    </section>
    <section class="pilha" style="gap: 8px;" aria-label="Convidados">
      <div class="cabeca-filete"><h2>Convidados</h2><span class="traco"></span><span class="sec">${s.pessoas.length} no app${vipLigado ? ` · ${plural(vips, 'VIP', 'VIPs')}` : ''}</span></div>
      ${vipLigado ? '<p class="sec" style="line-height: 1.4;">VIP conta sempre como quem ainda não cantou. Vale também para quem ainda não pediu música.</p>' : ''}
      ${pessoas || '<p class="sec centro" style="padding: 12px;">Ninguém entrou ainda.</p>'}
    </section>
    <section class="cartao-decor pilha" style="gap: 10px; border-radius: 16px; padding: 14px;" aria-label="Adicionar pedido">
      <h2 class="rotulo" style="font-size: 13px;">Adicionar pedido</h2>
      <label for="add-nome" class="sec">Para quem? (convidado sem celular)</label>
      <input id="add-nome" class="entrada" style="height: 46px; background: var(--fundo);" maxlength="30" list="lista-pessoas" placeholder="Nome" autocomplete="off" ${fechada ? 'disabled' : ''}>
      <datalist id="lista-pessoas">${s.pessoas.map((p) => `<option value="${esc(p.nome)}">`).join('')}</datalist>
      <span class="erro-campo" id="erro-add" hidden>Digite o nome antes de adicionar</span>
      <label for="add-q" class="sec">Música</label>
      <input id="add-q" class="entrada" type="search" style="height: 46px; background: var(--fundo);" placeholder="Título, artista ou código" autocomplete="off" ${fechada ? 'disabled' : ''}>
      <div id="add-resultados"></div>
    </section>`;

  $('#add-nome').value = nomeDigitado;
  $('#add-q').value = qDigitada;
  if (focado === 'add-nome' || focado === 'add-q') $(`#${focado}`).focus();
  renderBuscaAdmin();
}

function renderBuscaAdmin() {
  const alvo = $('#add-resultados');
  if (!alvo) return;
  alvo.innerHTML = s.busca.map((m) => `
    <div class="linha" style="padding: 8px 0; border-bottom: 1px solid var(--borda);">
      <div class="cresce">
        <div style="font-size: 14px; font-weight: 600;">${esc(m.titulo)}</div>
        <div class="sec">${esc(m.artista)} · cód. ${esc(m.cod)}</div>
      </div>
      <button type="button" class="btn btn-pequeno" data-acao="adicionar" data-cod="${esc(m.cod)}" data-titulo="${esc(m.titulo)}" aria-label="Adicionar ${esc(m.titulo)}">Adicionar</button>
    </div>`).join('');
}

let esperaBusca;
function aoDigitar(ev) {
  if (ev.target.id === 'add-nome') $('#erro-add').hidden = true;
  if (ev.target.id !== 'add-q') return;
  clearTimeout(esperaBusca);
  const q = ev.target.value.trim();
  esperaBusca = setTimeout(async () => {
    if (!q) {
      s.busca = [];
      return renderBuscaAdmin();
    }
    try {
      const r = await api('GET', `/api/musicas?q=${encodeURIComponent(q)}`);
      if ($('#add-q')?.value.trim() !== q) return;
      s.busca = r.musicas.slice(0, 8);
      renderBuscaAdmin();
    } catch (e) {
      avisar(e.message, { baixo: true });
    }
  }, 250);
}

// ---------- Menu Festa ----------

function renderFesta() {
  const st = s.estado.status;
  const f = s.festa;
  const itens = [
    ['festa', 'Dados da festa', 'Nome, título, data, duração, local, contato, Pix e convidados'],
    ['visual', 'Visual', 'Arte, tema, cor de destaque e fonte'],
    ['catalogo', 'Catálogo', 'Reimportar a lista de músicas do aparelho e gênero musical'],
    ['regras', 'Regras', 'Pedidos por pessoa, pulos, votação, VIP'],
    ['publicar', 'Link, QR code e cartaz', 'Material para imprimir e compartilhar'],
    ['pin', 'Trocar PIN', 'PIN de acesso a este painel'],
  ];
  $('#conteudo').innerHTML = `
    ${avisoStatus()}
    <div class="cabeca-filete"><h2>Festa</h2><span class="traco"></span>${icone()}</div>
    <p class="sec">${esc(f.titulo)} · ${st === 'aberta' ? 'aberta' : st === 'encerrada' ? 'encerrada' : 'em preparação'}</p>
    ${itens.map(([passo, titulo, desc]) => `
      <a class="item" style="text-decoration: none;" href="/setup#${passo}">
        <div class="cresce">
          <div class="titulo-item">${titulo}</div>
          <div class="sec">${desc}</div>
        </div>
        <span aria-hidden="true">›</span>
      </a>`).join('')}
    ${st === 'aberta' ? `
      <section class="cartao pilha" style="margin-top: 8px;">
        <h2 class="rotulo" style="font-size: 13px;">Encerrar festa</h2>
        <p class="sec" style="line-height: 1.4;">Fecha as votações, bloqueia pedidos e votos e mostra o ranking final para os convidados.</p>
        <button type="button" class="btn btn-alerta-cheio" data-acao="encerrar">Encerrar festa</button>
      </section>` : ''}
    ${st === 'encerrada' ? `
      <section class="cartao pilha" style="margin-top: 8px;">
        <h2 class="rotulo" style="font-size: 13px;">Arquivar festa</h2>
        <p class="sec" style="line-height: 1.4;">Guarda uma cópia do banco em <code>data/arquivo/</code> e apaga convidados, pedidos, votos e os dados da festa, inclusive o PIN, para começar outra.</p>
        <label class="interruptor"><span>Manter o catálogo para a próxima festa</span><input type="checkbox" id="manter-catalogo" checked></label>
        <button type="button" class="btn btn-alerta-cheio" data-acao="arquivar">Arquivar e começar outra</button>
      </section>` : ''}`;
}

// ---------- Ações ----------

// Máquina de karaokê (SPEC 10.5): só aparece com MAQUINA_TOKEN no servidor.
function linhaMaquina(m, fechada) {
  if (!m) return '';
  const texto = !m.conectada ? 'Máquina desconectada: digite o código no controle'
    : m.enviado ? 'Máquina conectada · código enviado' : 'Máquina conectada · enviando código…';
  return `
      <div class="entre" style="gap: 8px; padding-top: 4px;">
        <span class="sub" style="font-size: 12px;" role="status">${texto}</span>
        <button type="button" class="btn btn-palco-claro btn-pequeno" data-acao="reenviar" ${fechada ? 'disabled' : ''}>Reenviar código</button>
      </div>`;
}

async function aoClicar(ev) {
  const b = ev.target.closest('[data-acao]');
  if (!b || b.disabled) return;
  const { acao, id } = b.dataset;
  const a = s.estado?.atual;
  try {
    b.disabled = true;
    if (acao === 'cantou') {
      await api('POST', '/api/admin/cantou');
      avisar(`${a.cantor} cantou. Fila avançou.`, { baixo: true });
    } else if (acao === 'reenviar') {
      await api('POST', '/api/admin/maquina/reenviar');
      avisar(`Código ${a.cod} reenviado para a máquina.`, { baixo: true });
    } else if (acao === 'pular') {
      const r = await api('POST', '/api/admin/pular');
      avisar(r.status === 'removido' ? `${a.cantor} saiu da fila depois de ${r.pulos} pulos.` : `${a.cantor} foi para o fim da rodada.`, { baixo: true });
    } else if (acao === 'mover') {
      await api('POST', `/api/admin/pedidos/${id}/mover`, { direcao: b.dataset.direcao });
    } else if (acao === 'bypass') {
      await api('PATCH', `/api/admin/pedidos/${id}`, { bypass: b.getAttribute('aria-pressed') !== 'true' });
    } else if (acao === 'vip') {
      await api('PATCH', `/api/admin/pessoas/${encodeURIComponent(b.dataset.pessoa)}`, { vip: b.getAttribute('aria-pressed') !== 'true' });
    } else if (acao === 'adicionar') {
      const nome = $('#add-nome').value.trim();
      if (!nome) {
        $('#erro-add').hidden = false;
        $('#add-nome').focus();
        return;
      }
      const r = await api('POST', '/api/admin/pedidos', { nome, musica_cod: b.dataset.cod });
      avisar(`${b.dataset.titulo} para ${r.pedido.cantor}: ${r.posicao_estimada === 0 ? 'já está no palco.' : `${r.posicao_estimada}º na fila.`}`, { baixo: true });
      $('#add-q').value = '';
      s.busca = [];
    } else if (acao === 'encerrar') {
      if (!confirm('Encerrar a festa? Pedidos e votos ficam bloqueados e os convidados passam a ver o ranking final.')) return;
      await api('POST', '/api/festa/encerrar');
      avisar('Festa encerrada.', { baixo: true });
    } else if (acao === 'arquivar') {
      if (!confirm('Arquivar a festa? Convidados, pedidos, votos e o PIN são apagados daqui (fica uma cópia em data/arquivo/).')) return;
      await api('POST', '/api/festa/arquivar', { manter_catalogo: $('#manter-catalogo').checked });
      location.href = '/setup';
      return;
    }
    await poll.agora();
  } catch (e) {
    avisar(e.message, { baixo: true });
    if (e.status === 401) location.reload();
  } finally {
    b.disabled = false;
  }
}

// ---------- Início ----------

try {
  await carregarFesta();
  if (!s.festa.admin_configurado) {
    location.replace('/setup'); // sem PIN: o admin abre o setup (SPEC 4.1)
  } else {
    try {
      await api('GET', '/api/admin/estado');
      iniciarPainel();
    } catch (e) {
      if (e.status !== 401) throw e;
      montarLogin();
    }
  }
} catch (e) {
  app.innerHTML = `<div class="moldura"><p class="destaque" style="font-size: 40px;">Ops!</p><p class="sec">${esc(e.message)}</p></div>`;
}
