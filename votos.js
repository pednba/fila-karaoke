// Nota da festa e rankings (SPEC seção 9). Funções puras: nada de banco aqui.

export function mediana(notas) {
  if (!notas.length) return null;
  const s = [...notas].sort((a, b) => a - b);
  const meio = s.length >> 1;
  return s.length % 2 ? s[meio] : (s[meio - 1] + s[meio]) / 2;
}

// Nota da performance: mediana, ou null abaixo do mínimo de votos.
export function nota(notas, minimoVotos) {
  return notas.length >= minimoVotos ? mediana(notas) : null;
}

// Exibição: 1 casa, vírgula. formatarNota(7.25) → "7,3".
export function formatarNota(valor) {
  if (valor == null) return '';
  return (Math.round(valor * 10) / 10).toFixed(1).replace('.', ',');
}

// Validação de um voto (SPEC 9). Devolve o código de erro ou null.
//   pedido: { pessoa_id, votacao_aberta }
export function validarVoto({ pedido, pessoa_id, nota }) {
  if (!pedido || !pedido.votacao_aberta) return 'votacao_fechada';
  if (pedido.pessoa_id === pessoa_id) return 'voto_proprio';
  if (!Number.isInteger(nota) || nota < 0 || nota > 10) return 'nota_invalida';
  return null;
}

// Quando um pedido vira 'cantou', fecham as outras votações abertas (a da performance anterior).
// Devolve os ids a fechar. A do pedido que acabou de cantar continua aberta.
export function votacoesAFechar(abertas, pedidoCantouId) {
  return abertas.filter((id) => id !== pedidoCantouId);
}

// O que a API pode mostrar de uma votação aberta: só contagem e o voto do próprio usuário.
//   votos: [{ pessoa_id, nota }]
export function resumoAberta(votos, pessoa_id) {
  const meu = votos.find((v) => v.pessoa_id === pessoa_id);
  return { n_votos: votos.length, meu_voto: meu ? meu.nota : null };
}

// Ranking de performances (SPEC 9): cantou, votação fechada, votos ≥ mínimo;
// mediana desc, empate por nº de votos desc, depois quem cantou antes.
//   performances: [{ pedido_id, pessoa_id, status, votacao_aberta, notas: [..] }]
export function rankingPerformances(performances, minimoVotos) {
  return performances
    .filter((p) => p.status === 'cantou' && !p.votacao_aberta && p.notas.length >= minimoVotos)
    .map((p) => ({ ...p, nota: mediana(p.notas), n_votos: p.notas.length }))
    .sort((a, b) => b.nota - a.nota || b.n_votos - a.n_votos || a.pedido_id - b.pedido_id);
}

// Ranking de pessoas (SPEC 9): só performances que entram no ranking de performances;
// pessoas com pelo menos `minimoPerformances` delas; média das medianas desc,
// empate pela melhor performance, depois nº de performances.
export function rankingPessoas(performances, minimoVotos, minimoPerformances) {
  const porPessoa = new Map();
  for (const p of rankingPerformances(performances, minimoVotos)) {
    if (!porPessoa.has(p.pessoa_id)) porPessoa.set(p.pessoa_id, []);
    porPessoa.get(p.pessoa_id).push(p.nota);
  }
  const lista = [];
  for (const [pessoa_id, notas] of porPessoa) {
    if (notas.length < minimoPerformances) continue;
    lista.push({
      pessoa_id,
      media: notas.reduce((s, n) => s + n, 0) / notas.length,
      melhor: Math.max(...notas),
      n_performances: notas.length,
    });
  }
  return lista.sort((a, b) => b.media - a.media || b.melhor - a.melhor || b.n_performances - a.n_performances);
}
