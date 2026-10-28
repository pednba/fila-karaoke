// Assistente de setup (SPEC 4): salva a cada passo e permite voltar.
import { $, esc, api, avisar, icone, filete, definirIcone, definirCabecalhos, recarregarTema, plural, formatarDuracao, MICROFONE } from './comum.js';

const app = $('#app');
const PASSOS = [
  ['pin', 'Acesso'],
  ['festa', 'Festa'],
  ['visual', 'Visual'],
  ['catalogo', 'Catálogo'],
  ['regras', 'Regras'],
  ['publicar', 'Publicar'],
];
const CHAVE_TOKEN = 'fila-karaoke:setup-token';
const s = { setup: null, passo: 'pin', previa: null, visual: null };

function lerToken() {
  try {
    return sessionStorage.getItem(CHAVE_TOKEN);
  } catch {
    return null;
  }
}
function gravarToken(t) {
  try {
    if (t) sessionStorage.setItem(CHAVE_TOKEN, t);
    else sessionStorage.removeItem(CHAVE_TOKEN);
  } catch {
    /* sem armazenamento: o token vale só nesta página */
  }
}
let token = lerToken();
const aplicarToken = () => definirCabecalhos(token ? { 'X-Setup-Token': token } : {});

async function carregar() {
  aplicarToken();
  try {
    s.setup = await api('GET', '/api/setup');
  } catch (e) {
    if (e.codigo === 'token_invalido') return montarToken(Boolean(token));
    if (e.codigo === 'nao_autorizado') return location.replace('/admin'); // já tem PIN: entrar pelo login
    throw e;
  }
  definirIcone(s.setup.festa.tema?.icone);
  const pedido = location.hash.slice(1);
  if (PASSOS.some(([id]) => id === pedido)) s.passo = pedido;
  else s.passo = PASSOS.find(([id]) => id !== 'publicar' && !s.setup.passos[id])?.[0] ?? 'publicar';
  montar();
}

// ---------- SETUP_TOKEN (primeiro acesso, SPEC 4.1) ----------

function montarToken(errado) {
  app.innerHTML = `
    <form class="moldura" id="form-token" novalidate>
      <p class="rotulo">Setup da festa</p>
      <p class="destaque" style="font-size: 48px;">Primeiro acesso</p>
      ${filete()}
      <p class="sec" style="font-size: 14px; line-height: 1.5;">Para configurar a festa, informe o código de configuração (<code>SETUP_TOKEN</code>) definido no arquivo <code>.env</code> do servidor.</p>
      <div class="campo" style="width: 100%;">
        <label for="token">Código de configuração</label>
        <input id="token" class="entrada" type="password" autocomplete="off">
        <span class="erro-campo" ${errado ? '' : 'hidden'}>Código incorreto.</span>
      </div>
      <button type="submit" class="btn btn-grande">Continuar</button>
    </form>`;
  $('#form-token').onsubmit = (ev) => {
    ev.preventDefault();
    token = $('#token').value.trim();
    gravarToken(token);
    carregar().catch(falhar);
  };
}

// ---------- Estrutura ----------

function montar() {
  const st = s.setup;
  app.innerHTML = `
    <header class="topo topo-admin">
      <div class="cresce">
        <p class="rotulo-p">Setup da festa</p>
        <p class="destaque">${esc(st.festa.nome_destaque || 'Nova festa')}</p>
      </div>
      ${st.passos.pin ? '<a class="selo-pin" href="/admin" style="text-decoration: none;">Painel</a>' : ''}
    </header>
    <nav class="passos" id="passos" aria-label="Passos do setup"></nav>
    <main class="conteudo" id="conteudo" style="padding-bottom: 48px;"></main>`;
  $('#passos').onclick = (ev) => {
    const b = ev.target.closest('[data-passo]');
    if (b) irPara(b.dataset.passo);
  };
  window.onhashchange = () => {
    const p = location.hash.slice(1);
    if (p !== s.passo && PASSOS.some(([id]) => id === p)) irPara(p);
  };
  renderPasso();
}

function irPara(passo) {
  s.passo = passo;
  history.replaceState(null, '', `#${passo}`);
  renderPasso();
  window.scrollTo(0, 0);
}

function proximo() {
  const i = PASSOS.findIndex(([id]) => id === s.passo);
  irPara(PASSOS[Math.min(i + 1, PASSOS.length - 1)][0]);
}

function renderPasso() {
  const st = s.setup;
  $('#passos').innerHTML = PASSOS.map(([id, nome], i) => `
    <button type="button" data-passo="${id}" class="${st.passos[id] ? 'feito' : ''}" ${s.passo === id ? 'aria-current="step"' : ''}>${i + 1}. ${nome}</button>`).join('');
  const render = { pin: passoPin, festa: passoFesta, visual: passoVisual, catalogo: passoCatalogo, regras: passoRegras, publicar: passoPublicar };
  render[s.passo]();
}

const titulo = (t, sub) => `
  <div class="pilha" style="gap: 6px;">
    <div class="cabeca-filete"><h2>${t}</h2><span class="traco"></span>${icone()}</div>
    ${sub ? `<p class="sec" style="font-size: 13px; line-height: 1.4;">${sub}</p>` : ''}
  </div>`;

function mostrarErro(form, e) {
  const el = form.querySelector('.erro-form');
  el.textContent = e.message;
  el.hidden = false;
  const campo = e.dados?.campo && form.querySelector(`[name="${e.dados.campo}"]`);
  campo?.focus();
}

// Envia o formulário do passo, mostra o erro no lugar e recarrega o estado do setup.
function aoEnviar(form, acao) {
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    form.querySelector('.erro-form').hidden = true;
    const botao = ev.submitter;
    if (botao) botao.disabled = true;
    try {
      const seguir = await acao(new FormData(form));
      s.setup = await api('GET', '/api/setup');
      if (seguir !== false) {
        avisar('Salvo.');
        proximo();
      } else renderPasso();
    } catch (e) {
      mostrarErro(form, e);
    } finally {
      if (botao) botao.disabled = false;
    }
  };
}

// ---------- 1. Acesso ----------

function passoPin() {
  const existe = s.setup.passos.pin;
  $('#conteudo').innerHTML = `
    ${titulo(existe ? 'Trocar PIN' : '1. Acesso', 'O PIN protege o painel do admin. Use de 4 a 8 dígitos e guarde bem: quem souber o PIN controla a fila.')}
    <form class="pilha" id="form" novalidate>
      <div class="campo"><label for="pin">PIN do admin</label>
        <input id="pin" name="pin" class="entrada" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" required></div>
      <div class="campo"><label for="confirmacao">Repita o PIN</label>
        <input id="confirmacao" name="confirmacao" class="entrada" type="password" inputmode="numeric" autocomplete="new-password" maxlength="8" required></div>
      <span class="erro-campo erro-form" hidden></span>
      <button type="submit" class="btn btn-grande">${existe ? 'Trocar PIN' : 'Salvar e continuar'}</button>
    </form>`;
  aoEnviar($('#form'), async (d) => {
    const pin = d.get('pin').trim();
    const confirmacao = d.get('confirmacao').trim();
    if (pin !== confirmacao) throw Object.assign(new Error('Os dois PINs não são iguais.'), { dados: { campo: 'confirmacao' } });
    await api('PUT', '/api/setup/pin', { pin, confirmacao });
    // Com o PIN criado, o cookie de admin substitui o SETUP_TOKEN (SPEC 7).
    token = null;
    gravarToken(null);
    aplicarToken();
    if (!existe) setTimeout(montar, 0);
  });
}

// ---------- 2. Festa ----------

function paraDatetimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "2026-12-05T20:00" no fuso do navegador → ISO com deslocamento, como o servidor exige.
function comFuso(local) {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  const min = -d.getTimezoneOffset();
  const sinal = min >= 0 ? '+' : '-';
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${local.slice(0, 16)}:00${sinal}${p(min / 60)}:${p(min % 60)}`;
}

function passoFesta() {
  const f = s.setup.festa;
  const tituloPadrao = (nome) => (nome ? `Karaokê da ${nome}` : 'Karaokê da {nome}');
  const tituloSalvo = f.titulo && f.titulo !== tituloPadrao(f.nome_destaque) ? f.titulo : '';
  $('#conteudo').innerHTML = `
    ${titulo('2. Festa', 'Esses dados aparecem para os convidados. Dá para editar depois pelo menu Festa do painel.')}
    <form class="pilha" id="form" novalidate>
      <div class="campo"><label for="nome_destaque">Nome em destaque</label>
        <input id="nome_destaque" name="nome_destaque" class="entrada" maxlength="40" required value="${esc(f.nome_destaque)}">
        <span class="sec">Aparece grande, na fonte de destaque.</span></div>
      <div class="campo"><label for="titulo">Título</label>
        <input id="titulo" name="titulo" class="entrada" maxlength="80" value="${esc(tituloSalvo)}" placeholder="${esc(tituloPadrao(f.nome_destaque))}">
        <span class="sec">Em branco, usa o padrão.</span></div>
      <div class="campo"><label for="subtitulo">Subtítulo (opcional)</label>
        <input id="subtitulo" name="subtitulo" class="entrada" maxlength="60" value="${esc(f.subtitulo)}"></div>
      <div class="grade-2">
        <div class="campo"><label for="inicio_em">Início</label>
          <input id="inicio_em" name="inicio_em" class="entrada" type="datetime-local" required value="${paraDatetimeLocal(f.inicio_em)}"></div>
        <div class="campo"><label for="duracao_horas">Duração (horas)</label>
          <input id="duracao_horas" name="duracao_horas" class="entrada" type="number" min="0.5" max="24" step="0.5" inputmode="decimal" required value="${f.duracao_min ? f.duracao_min / 60 : 4}"></div>
      </div>
      <div class="campo"><label for="local">Local (opcional)</label>
        <input id="local" name="local" class="entrada" maxlength="120" value="${esc(f.local)}"></div>
      <div class="campo"><label for="contato">Seu contato (opcional)</label>
        <input id="contato" name="contato" class="entrada" maxlength="120" value="${esc(f.contato)}" placeholder="E-mail ou telefone">
        <span class="sec">Aparece na página de privacidade, para quem quiser falar sobre os próprios dados.</span></div>
      <div class="campo"><label for="convidados">Convidados (estimativa)</label>
        <input id="convidados" name="convidados" class="entrada" type="number" min="1" max="1000" step="1" inputmode="numeric" required value="${f.convidados ?? ''}"></div>
      <span class="erro-campo erro-form" hidden></span>
      <button type="submit" class="btn btn-grande">Salvar e continuar</button>
    </form>`;
  $('#nome_destaque').oninput = (ev) => ($('#titulo').placeholder = tituloPadrao(ev.target.value.trim()));
  aoEnviar($('#form'), async (d) => {
    await api('PUT', '/api/setup/festa', {
      nome_destaque: d.get('nome_destaque'),
      titulo: d.get('titulo'),
      subtitulo: d.get('subtitulo'),
      inicio_em: comFuso(d.get('inicio_em')),
      duracao_horas: Number(String(d.get('duracao_horas')).replace(',', '.')),
      local: d.get('local'),
      contato: d.get('contato'),
      convidados: Number(d.get('convidados')),
    });
  });
}

// ---------- 3. Visual ----------

function luminancia(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function tokensDe(v) {
  const preset = s.setup.presets.find((p) => p.id === v.preset) ?? s.setup.presets[0];
  const tokens = { ...preset.tokens };
  if (v.destaque) tokens.decor = tokens['destaque-palco'] = v.destaque.toUpperCase();
  return { preset, tokens, fonte: v.fonte || preset.fonte };
}

function passoVisual() {
  const tema = s.setup.festa.tema;
  s.visual ??= { preset: tema.preset, destaque: tema.destaque, fonte: tema.fonte };
  const f = s.setup.festa;
  $('#conteudo').innerHTML = `
    ${titulo('3. Visual', 'A arte e o tema aparecem na tela de entrada dos convidados e no ranking final.')}
    <section class="pilha">
      <h3 class="rotulo" style="font-size: 12px;">Arte da festa</h3>
      ${f.arte_url ? `<img class="arte" src="${esc(f.arte_url)}?v=${Date.now()}" alt="Arte atual da festa">` : '<p class="sec">Nenhuma arte enviada (opcional). O convite da festa funciona bem.</p>'}
      <label class="btn btn-claro" style="align-self: flex-start;">
        ${f.arte_url ? 'Trocar arte' : 'Enviar arte'}
        <input type="file" id="arte" accept="image/jpeg,image/png,image/webp" hidden>
      </label>
      <span class="sec">JPG, PNG ou WebP até 5 MB.</span>
    </section>
    <form class="pilha" id="form" novalidate>
      <h3 class="rotulo" style="font-size: 12px;">Tema</h3>
      <div class="presets" id="presets"></div>
      <label class="interruptor"><span>Usar uma cor de destaque própria</span><input type="checkbox" id="usar-destaque"></label>
      <div class="linha" id="linha-cor">
        <input type="color" id="destaque" aria-label="Cor de destaque" style="width: 56px; height: 44px; border: 1px solid var(--borda); border-radius: 10px; background: none; padding: 2px;">
        <span class="sec" id="contraste"></span>
      </div>
      <div class="campo"><label for="fonte">Fonte de destaque</label>
        <select id="fonte" class="entrada">${s.setup.fontes.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</select></div>
      <h3 class="rotulo" style="font-size: 12px;">Prévia</h3>
      <div class="previa" id="previa"></div>
      <span class="erro-campo erro-form" hidden></span>
      <button type="submit" class="btn btn-grande">Salvar e continuar</button>
    </form>`;

  const atualizarVisual = () => {
    const v = s.visual;
    const { tokens, fonte } = tokensDe(v);
    $('#presets').innerHTML = s.setup.presets.map((p) => `
      <button type="button" class="preset" data-preset="${p.id}" aria-pressed="${p.id === v.preset}" style="background: ${p.tokens.fundo}; color: ${p.tokens.texto};">
        <span>${esc(p.nome)}</span>
        <span class="amostras">${['palco', 'decor', 'destaque-palco', 'superficie'].map((k) => `<span style="background: ${p.tokens[k]};"></span>`).join('')}</span>
      </button>`).join('');
    $('#usar-destaque').checked = Boolean(v.destaque);
    $('#linha-cor').hidden = !v.destaque;
    $('#destaque').value = (v.destaque || tokens.decor).toLowerCase();
    $('#fonte').value = fonte;
    const pares = [
      ['texto-2', 'fundo', 'texto secundário'],
      ['destaque-palco', 'palco', 'destaque sobre o palco'],
    ].map(([a, b, nome]) => ({ nome, razao: contraste(tokens[a], tokens[b]) }));
    const ruim = pares.find((p) => p.razao < 4.5);
    $('#contraste').innerHTML = ruim
      ? `<span class="erro-campo">Pouco legível: ${ruim.nome} com contraste ${ruim.razao.toFixed(1)}:1 (mínimo 4,5:1).</span>`
      : `Contraste ok (${pares.map((p) => p.razao.toFixed(1)).join(' e ')}:1).`;
    renderPrevia(tokens, fonte);
  };

  $('#presets').onclick = (ev) => {
    const b = ev.target.closest('[data-preset]');
    if (!b) return;
    const preset = s.setup.presets.find((p) => p.id === b.dataset.preset);
    s.visual = { preset: preset.id, destaque: null, fonte: preset.fonte };
    atualizarVisual();
  };
  $('#usar-destaque').onchange = (ev) => {
    s.visual.destaque = ev.target.checked ? tokensDe({ ...s.visual, destaque: null }).tokens.decor : null;
    atualizarVisual();
  };
  $('#destaque').oninput = (ev) => {
    s.visual.destaque = ev.target.value.toUpperCase();
    atualizarVisual();
  };
  $('#fonte').onchange = (ev) => {
    s.visual.fonte = ev.target.value;
    atualizarVisual();
  };
  $('#arte').onchange = async (ev) => {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    if (arquivo.size > 5 * 1024 * 1024) return avisar('A imagem passa de 5 MB. Escolha uma menor.');
    const dados = new FormData();
    dados.append('arte', arquivo);
    try {
      avisar('Enviando a arte…');
      await api('POST', '/api/setup/arte', dados);
      s.setup = await api('GET', '/api/setup');
      avisar('Arte salva.');
      passoVisual();
    } catch (e) {
      avisar(e.message);
    }
  };
  aoEnviar($('#form'), async () => {
    const { preset, destaque, fonte } = s.visual;
    await api('PUT', '/api/setup/visual', { preset, destaque, fonte });
    s.visual = null;
    recarregarTema();
  });
  atualizarVisual();
}

// Prévia: tela de entrada e cartão "Agora no palco" com os tokens escolhidos.
function renderPrevia(tokens, fonte) {
  const f = s.setup.festa;
  const vars = Object.entries(tokens).map(([k, v]) => `--${k}: ${v};`).join(' ') + ` --fonte-destaque: '${fonte}', cursive;`;
  const nome = f.nome_destaque || 'Nome';
  const el = $('#previa');
  el.setAttribute('style', vars);
  el.innerHTML = `
    <div class="moldura">
      ${f.arte_url ? `<img class="arte" style="max-height: 140px;" src="${esc(f.arte_url)}" alt="">` : ''}
      <p class="rotulo" style="font-size: 11px;">${esc(f.titulo || `Karaokê da ${nome}`)}</p>
      <div class="circulo"><span class="destaque">${esc(nome)}</span>${f.subtitulo ? `<span class="subtitulo" style="font-size: 15px;">${esc(f.subtitulo)}</span>` : ''}</div>
      ${filete()}
      <p class="frase" style="font-size: 26px;">Escolha sua música e entre na fila!</p>
      <div class="entrada" style="display: flex; align-items: center; color: var(--texto-2);">Seu nome ou apelido</div>
      <div class="btn btn-grande">Entrar na festa</div>
    </div>
    <div style="padding: 0 16px 16px;">
      <section class="palco no-palco">
        <div class="filete"><span class="rotulo-p">Agora no palco</span></div>
        <div class="entre" style="align-items: flex-end;">
          <div class="cresce pilha" style="gap: 4px;">
            <span class="titulo-musica">Nome da música</span>
            <span class="sub">Artista</span>
          </div>
          <div class="codigo"><small>CÓDIGO</small><strong>1234</strong></div>
        </div>
        <div class="cantor">${MICROFONE}<span class="destaque">Convidado</span></div>
      </section>
    </div>`;
  el.querySelectorAll('.icone').forEach((svg) => svg.setAttribute('style', 'fill: var(--texto)'));
  const iconePreset = s.setup.presets.find((p) => p.id === s.visual.preset)?.icone;
  if (iconePreset) {
    definirIcone(iconePreset);
    el.querySelector('.filete').outerHTML = filete();
    definirIcone(s.setup.festa.tema.icone);
  }
}

// ---------- 4. Catálogo ----------

function passoCatalogo() {
  const { catalogo, status } = s.setup;
  const p = s.previa?.previa;
  const idiomas = p ? Object.entries(p.por_idioma).map(([k, n]) => `${esc(k)}: ${n}`).join(' · ') : '';
  const rodapeDiverge = p && p.total_rodape != null && p.total_rodape !== p.total;
  $('#conteudo').innerHTML = `
    ${titulo('4. Catálogo', 'Envie a lista de músicas do aparelho de karaokê: o PDF “lista de músicas do aparelho” ou um CSV.')}
    <div class="cartao pilha" style="gap: 4px;">
      <span class="titulo-item">${catalogo.total ? plural(catalogo.total, 'música', 'músicas') : 'Nenhum catálogo importado'}</span>
      ${catalogo.origem ? `<span class="sec">${esc(catalogo.origem)}</span>` : ''}
    </div>
    ${status !== 'rascunho' ? '<p class="aviso">A festa já está aberta: ao reimportar, pedidos pendentes de músicas que saírem do catálogo são cancelados.</p>' : ''}
    <form class="pilha" id="form" novalidate>
      <label class="btn ${p ? 'btn-claro' : ''}" style="align-self: flex-start;">
        ${catalogo.total || p ? 'Escolher outro arquivo' : 'Escolher arquivo (PDF ou CSV)'}
        <input type="file" id="arquivo" accept=".pdf,.csv,application/pdf,text/csv" hidden>
      </label>
      <span class="sec">CSV: colunas código, título, artista, início da letra e idioma.</span>
      ${p ? `
        <section class="cartao-decor pilha">
          <h3 class="rotulo" style="font-size: 12px;">Resultado da importação</h3>
          <table class="tabela">
            <tr><td>Músicas</td><td>${p.total}</td></tr>
            <tr><td>Por idioma</td><td>${idiomas || '–'}</td></tr>
            <tr><td>Linhas ignoradas</td><td>${p.n_ignoradas}</td></tr>
            <tr><td>Códigos duplicados</td><td>${p.duplicados}</td></tr>
            ${p.total_rodape != null ? `<tr><td>Total no rodapé do PDF</td><td>${p.total_rodape}</td></tr>` : ''}
          </table>
          ${rodapeDiverge ? `<p class="aviso aviso-alerta">O rodapé do PDF diz ${p.total_rodape} músicas, mas foram lidas ${p.total}. Confira se o arquivo está completo.</p>` : ''}
          ${p.duplicados ? '<p class="aviso">Códigos repetidos ficaram só com a primeira ocorrência.</p>' : ''}
          ${p.ignoradas.length ? `<span class="sec">Amostra das linhas ignoradas:</span><pre class="amostra">${p.ignoradas.map(esc).join('\n')}</pre>` : ''}
        </section>
        <span class="erro-campo erro-form" hidden></span>
        <div class="grade-2">
          <button type="button" class="btn btn-claro" id="descartar">Descartar</button>
          <button type="submit" class="btn">Confirmar importação</button>
        </div>` : '<span class="erro-campo erro-form" hidden></span>'}
      ${!p && catalogo.total ? '<button type="button" class="btn btn-grande" id="seguir">Continuar</button>' : ''}
    </form>`;

  const form = $('#form');
  $('#arquivo').onchange = async (ev) => {
    const arquivo = ev.target.files[0];
    if (!arquivo) return;
    const dados = new FormData();
    dados.append('arquivo', arquivo);
    form.querySelector('.erro-form').hidden = true;
    avisar('Lendo o arquivo…');
    try {
      s.previa = await api('POST', '/api/setup/catalogo', dados);
      $('#toast').hidden = true;
      passoCatalogo();
    } catch (e) {
      $('#toast').hidden = true;
      s.previa = null;
      mostrarErro(form, e);
    }
  };
  $('#seguir')?.addEventListener('click', proximo);
  $('#descartar')?.addEventListener('click', () => {
    s.previa = null;
    passoCatalogo();
  });
  const confirmar = async (corpo) => {
    try {
      await api('POST', '/api/setup/catalogo/confirmar', corpo);
    } catch (e) {
      // Prévia expirada: some com ela para o arquivo ser enviado de novo.
      if (e.codigo === 'previa_expirada') {
        s.previa = null;
        setTimeout(() => {
          passoCatalogo();
          avisar(e.message);
        }, 0);
        throw Object.assign(new Error(e.message), { codigo: 'previa_expirada' });
      }
      throw e;
    }
  };
  aoEnviar(form, async () => {
    try {
      await confirmar({ token: s.previa.token });
    } catch (e) {
      if (e.codigo !== 'confirmacao_necessaria') throw e;
      const n = e.dados.pedidos_cancelados;
      const texto = `${e.message}${n ? ` ${plural(n, 'pedido pendente será cancelado', 'pedidos pendentes serão cancelados')}.` : ''} Continuar?`;
      if (!confirm(texto)) return false;
      await confirmar({ token: s.previa.token, confirmar: true });
    }
    s.previa = null;
  });
}

// ---------- 5. Regras ----------

const REGRAS = [
  ['pendentes_por_pessoa', 'Pedidos pendentes por pessoa', 'numero'],
  ['minutos_por_musica', 'Minutos por música (para estimativas)', 'numero'],
  ['pulos_ate_sair', 'Pulos até sair da fila', 'numero'],
  ['votacao', 'Votação ligada (Nota da festa)', 'sim'],
  ['minimo_votos', 'Mínimo de votos para ter nota', 'numero'],
  ['ranking_pessoas', 'Ranking de pessoas ligado', 'sim'],
  ['minimo_performances', 'Mínimo de performances no ranking de pessoas', 'numero'],
  ['vip', 'VIP disponível', 'sim'],
];

function textoDimensionamento(duracaoMin, minutos, convidados) {
  if (!duracaoMin) return '<p class="aviso">Preencha a duração da festa no passo 2 para ver a capacidade estimada.</p>';
  const musicas = Math.floor(duracaoMin / minutos);
  return `
    <p class="aviso">Com ${formatarDuracao(duracaoMin)} de festa e ${minutos} min por música, cabem ~${plural(musicas, 'música', 'músicas')}${convidados ? ` para ${plural(convidados, 'convidado', 'convidados')}` : ''}.</p>
    ${convidados && musicas < convidados ? '<p class="aviso aviso-alerta">Nem todos devem conseguir cantar duas vezes. A fila por rodadas existe para isso: quem ainda não cantou vem antes.</p>' : ''}`;
}

function passoRegras() {
  const { regras, duracao_min, convidados } = s.setup.festa;
  $('#conteudo').innerHTML = `
    ${titulo('5. Regras', 'Todas já vêm com o padrão recomendado.')}
    <div id="dimensionamento" class="pilha" style="gap: 8px;"></div>
    <form class="pilha" id="form" novalidate style="gap: 8px;">
      ${REGRAS.map(([chave, nome, tipo]) => tipo === 'sim'
        ? `<label class="interruptor" data-regra="${chave}"><span>${nome}</span><input type="checkbox" name="${chave}" ${regras[chave] ? 'checked' : ''}></label>`
        : `<label class="numero" data-regra="${chave}"><span>${nome}</span><input type="number" name="${chave}" min="1" step="1" inputmode="numeric" value="${regras[chave]}"></label>`).join('')}
      <span class="erro-campo erro-form" hidden></span>
      <button type="submit" class="btn btn-grande" style="margin-top: 8px;">Salvar e continuar</button>
    </form>`;
  const form = $('#form');
  const sincronizar = () => {
    const votacao = form.elements.votacao.checked;
    const pessoas = form.elements.ranking_pessoas.checked;
    form.querySelector('[data-regra="minimo_votos"]').hidden = !votacao;
    form.querySelector('[data-regra="ranking_pessoas"]').hidden = !votacao;
    form.querySelector('[data-regra="minimo_performances"]').hidden = !votacao || !pessoas;
    const minutos = Number(form.elements.minutos_por_musica.value) || regras.minutos_por_musica;
    $('#dimensionamento').innerHTML = textoDimensionamento(duracao_min, minutos, convidados);
  };
  form.oninput = sincronizar;
  sincronizar();
  aoEnviar(form, async () => {
    const corpo = Object.fromEntries(REGRAS.map(([chave, , tipo]) => [chave, tipo === 'sim' ? form.elements[chave].checked : Number(form.elements[chave].value)]));
    await api('PUT', '/api/setup/regras', corpo);
  });
}

// ---------- 6. Publicar ----------

const NOMES_PASSOS = { pin: 'PIN do admin', festa: 'dados da festa', catalogo: 'catálogo' };

function passoPublicar() {
  const st = s.setup;
  const f = st.festa;
  const preset = st.presets.find((p) => p.id === f.tema.preset);
  const inicio = f.inicio_em ? new Date(f.inicio_em).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' }) : '–';
  const r = f.regras;
  const pronto = !st.falta.length;
  $('#conteudo').innerHTML = `
    ${titulo('6. Publicar', 'Confira o resumo, imprima o QR code e abra a festa.')}
    ${pronto ? '' : `<p class="aviso aviso-alerta">Falta preencher: ${st.falta.map((p) => NOMES_PASSOS[p] ?? p).join(', ')}.</p>`}
    <section class="cartao pilha">
      <table class="tabela">
        <tr><td>Nome em destaque</td><td>${esc(f.nome_destaque) || '–'}</td></tr>
        <tr><td>Título</td><td>${esc(f.titulo) || '–'}</td></tr>
        ${f.subtitulo ? `<tr><td>Subtítulo</td><td>${esc(f.subtitulo)}</td></tr>` : ''}
        <tr><td>Início</td><td>${esc(inicio)}</td></tr>
        <tr><td>Duração</td><td>${f.duracao_min ? formatarDuracao(f.duracao_min) : '–'}</td></tr>
        ${f.local ? `<tr><td>Local</td><td>${esc(f.local)}</td></tr>` : ''}
        ${f.contato ? `<tr><td>Contato</td><td>${esc(f.contato)}</td></tr>` : ''}
        <tr><td>Convidados</td><td>${f.convidados ?? '–'}</td></tr>
        <tr><td>Tema</td><td>${esc(preset?.nome ?? f.tema.preset)} · ${esc(f.tema.fonte)}${f.tema.destaque ? ` · ${esc(f.tema.destaque)}` : ''}</td></tr>
        <tr><td>Arte</td><td>${f.arte_url ? 'enviada' : 'sem arte'}</td></tr>
        <tr><td>Catálogo</td><td>${plural(st.catalogo.total, 'música', 'músicas')}</td></tr>
        <tr><td>Pedidos por pessoa</td><td>${r.pendentes_por_pessoa}</td></tr>
        <tr><td>Pulos até sair</td><td>${r.pulos_ate_sair}</td></tr>
        <tr><td>Votação</td><td>${r.votacao ? `ligada · mínimo de ${plural(r.minimo_votos, 'voto', 'votos')}` : 'desligada'}</td></tr>
        ${r.votacao ? `<tr><td>Ranking de pessoas</td><td>${r.ranking_pessoas ? `ligado · mínimo de ${plural(r.minimo_performances, 'performance', 'performances')}` : 'desligado'}</td></tr>` : ''}
        <tr><td>VIP</td><td>${r.vip ? 'disponível' : 'desligado'}</td></tr>
        <tr><td>Capacidade</td><td>~${plural(st.dimensionamento.musicas, 'música', 'músicas')}</td></tr>
      </table>
    </section>
    <section class="cartao-decor pilha" style="align-items: stretch;">
      <h3 class="rotulo" style="font-size: 12px;">Link dos convidados</h3>
      <div class="linha">
        <input class="entrada cresce" id="link" readonly value="${esc(st.link)}" style="height: 46px;">
        <button type="button" class="btn" id="copiar">Copiar</button>
      </div>
      ${st.passos.pin ? `
        <img class="qr" src="/api/setup/qr.svg" alt="QR code do link da festa">
        <div class="grade-2">
          <a class="btn btn-claro" href="/api/setup/qr.png" download="qr-karaoke.png">Baixar PNG</a>
          <a class="btn btn-claro" href="/api/setup/qr.svg" download="qr-karaoke.svg">Baixar SVG</a>
        </div>
        <a class="btn" href="/api/setup/cartaz.html" target="_blank" rel="noopener">Cartaz para imprimir (A4)</a>` : ''}
    </section>
    ${st.status === 'rascunho' ? `
      <button type="button" class="btn btn-grande" id="abrir" ${pronto ? '' : 'disabled'}>Abrir festa</button>
      <p class="sec centro">Ao abrir, os convidados já conseguem entrar pelo link.</p>` : `
      <p class="aviso">${st.status === 'aberta' ? 'A festa está aberta.' : 'A festa foi encerrada.'}</p>
      <a class="btn btn-grande" href="/admin">Ir para o painel</a>`}`;

  $('#copiar').onclick = async () => {
    try {
      await navigator.clipboard.writeText(st.link);
      avisar('Link copiado.');
    } catch {
      $('#link').select();
      avisar('Selecione e copie o link.');
    }
  };
  $('#abrir')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      await api('POST', '/api/festa/abrir');
      avisar('Festa aberta! Os convidados já podem entrar.');
      s.setup = await api('GET', '/api/setup');
      renderPasso();
    } catch (e) {
      avisar(e.message);
      ev.target.disabled = false;
    }
  });
}

// ---------- Início ----------

function falhar(e) {
  app.innerHTML = `<div class="moldura"><p class="destaque" style="font-size: 40px;">Ops!</p><p class="sec">${esc(e.message)}</p></div>`;
}

carregar().catch(falhar);
