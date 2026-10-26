// Algoritmo da fila (SPEC seção 8). Funções puras: nada de banco aqui.
//
// Decisões além do texto da spec (confirmadas com o dono do projeto):
// - O pedido na_vez já conta como cantada no cálculo da rodada do cantor da vez.
// - "Pedido repetido" vale por pessoa: a mesma pessoa não repete música pendente ou na vez.
// - "Pulos até sair da fila = N": a pessoa é removida no N-ésimo pulo.

const porChegada = (a, b) => a.t_fila - b.t_fila || a.id - b.id;

// Ordena os pendentes (SPEC 8.2). Devolve cópias dos pedidos, na ordem, com `rodada` calculada.
//   pendentes:    [{ id, pessoa_id, t_fila, ordem_manual, bypass }]
//   cantadas:     { [pessoa_id]: nº de pedidos com status 'cantou' }
//   cantorDaVez:  pessoa_id do pedido na_vez, ou null
//   ultimoCantor: pessoa_id de quem cantou por último, ou null
//   vips:         Set de pessoa_id
export function ordenar({ pendentes, cantadas = {}, cantorDaVez = null, ultimoCantor = null, vips = new Set() }) {
  // 1 e 2: índice de cada pedido entre os da própria pessoa, e a rodada.
  const porPessoa = new Map();
  for (const p of [...pendentes].sort(porChegada)) {
    if (!porPessoa.has(p.pessoa_id)) porPessoa.set(p.pessoa_id, []);
    porPessoa.get(p.pessoa_id).push(p);
  }
  const comRodada = [];
  for (const [pessoa, pedidos] of porPessoa) {
    const base = vips.has(pessoa) ? 0 : (cantadas[pessoa] ?? 0) + (pessoa === cantorDaVez ? 1 : 0);
    pedidos.forEach((p, i) => comRodada.push({ ...p, rodada: base + i }));
  }

  // 3: rodada, depois chegada.
  const porRodada = (a, b) => a.rodada - b.rodada || porChegada(a, b);

  // 4: ordem manual primeiro, sem anti-repetição.
  const manuais = comRodada
    .filter((p) => p.ordem_manual != null)
    .sort((a, b) => a.ordem_manual - b.ordem_manual || porRodada(a, b));
  const restantes = comRodada.filter((p) => p.ordem_manual == null).sort(porRodada);

  // 5: anti-repetição nos demais.
  let anterior = manuais.length ? manuais.at(-1).pessoa_id : (cantorDaVez ?? ultimoCantor);
  const resultado = [...manuais];
  while (restantes.length) {
    let k = restantes.findIndex((p) => p.pessoa_id !== anterior || p.bypass);
    if (k === -1) k = 0; // só sobrou a mesma pessoa: aceitar
    const [escolhido] = restantes.splice(k, 1);
    resultado.push(escolhido);
    anterior = escolhido.pessoa_id;
  }
  return resultado;
}

// Quem deve virar na_vez agora (SPEC 8.3). Com alguém no palco, ninguém é promovido.
export function escolherProximo({ naVez = null, ...entrada }) {
  if (naVez) return null;
  return ordenar(entrada)[0] ?? null;
}

// Mover ↑/↓ (SPEC 8.4): materializa a ordem atual em ordem_manual = 0..n e troca o par.
// `ordenados` é a saída de ordenar. Devolve [{ id, ordem_manual }] para todos, ou null se não há para onde mover.
export function mover(ordenados, id, direcao) {
  const ids = ordenados.map((p) => p.id);
  const i = ids.indexOf(id);
  const j = direcao === 'cima' ? i - 1 : direcao === 'baixo' ? i + 1 : -1;
  if (i === -1 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids.map((pid, ordem_manual) => ({ id: pid, ordem_manual }));
}

// Pular ausente (SPEC 8.4): o que acontece com o pedido na_vez pulado.
// Os votos do pedido devem ser apagados em ambos os casos.
export function decidirPulo(pedido, limitePulos, agora) {
  const pulos = pedido.pulos + 1;
  if (pulos >= limitePulos) return { status: 'removido', pulos };
  return { status: 'pendente', pulos, t_fila: agora, ordem_manual: null };
}

// Validação de um novo pedido da pessoa (SPEC 8.4). Devolve o código de erro ou null.
// A existência da música no catálogo é verificada no banco.
//   meusPedidos: pedidos da pessoa, com { musica_cod, status }
export function validarPedido({ meusPedidos, musica_cod, limite }) {
  const ativos = meusPedidos.filter((p) => p.status === 'pendente' || p.status === 'na_vez');
  if (ativos.some((p) => p.musica_cod === musica_cod)) return 'ja_pedida';
  if (ativos.length >= limite) return 'limite_atingido';
  return null;
}
