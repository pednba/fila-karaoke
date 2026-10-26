import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mediana,
  nota,
  formatarNota,
  validarVoto,
  votacoesAFechar,
  resumoAberta,
  rankingPerformances,
  rankingPessoas,
} from '../votos.js';

test('11. mediana ímpar e par; mínimo de votos configurável', () => {
  assert.equal(mediana([9, 2, 7]), 7);
  assert.equal(mediana([10, 6, 7, 2]), 6.5);
  assert.equal(mediana([]), null);

  assert.equal(nota([8, 9], 3), null);
  assert.equal(nota([8, 9, 10], 3), 9);
  assert.equal(nota([8, 9], 2), 8.5);

  assert.equal(formatarNota(6.5), '6,5');
  assert.equal(formatarNota(9), '9,0');
  assert.equal(formatarNota(7.25), '7,3');
  assert.equal(formatarNota(null), '');
});

test('12. votação: sem voto próprio, voto alterável, fecha quando a próxima performance termina', () => {
  const aberto = { pessoa_id: 'ana', votacao_aberta: 1 };
  assert.equal(validarVoto({ pedido: aberto, pessoa_id: 'ana', nota: 10 }), 'voto_proprio');
  assert.equal(validarVoto({ pedido: aberto, pessoa_id: 'bia', nota: 8 }), null);
  assert.equal(validarVoto({ pedido: { ...aberto, votacao_aberta: 0 }, pessoa_id: 'bia', nota: 8 }), 'votacao_fechada');
  assert.equal(validarVoto({ pedido: null, pessoa_id: 'bia', nota: 8 }), 'votacao_fechada');
  assert.equal(validarVoto({ pedido: aberto, pessoa_id: 'bia', nota: 11 }), 'nota_invalida');
  assert.equal(validarVoto({ pedido: aberto, pessoa_id: 'bia', nota: 7.5 }), 'nota_invalida');

  // Voto alterável: a validação não depende de já ter votado (o banco faz upsert).
  assert.equal(validarVoto({ pedido: aberto, pessoa_id: 'bia', nota: 3 }), null);

  // Pedido 1 cantou (aberto); pedido 2 está na vez (aberto). Quando 2 cantar, fecha só o 1.
  assert.deepEqual(votacoesAFechar([1, 2], 2), [1]);
  // Quando o 1 terminou, só ele estava aberto: nada fecha.
  assert.deepEqual(votacoesAFechar([1], 1), []);
});

test('12b. parcial escondida: só contagem e o voto do próprio usuário', () => {
  const votos = [
    { pessoa_id: 'bia', nota: 8 },
    { pessoa_id: 'caio', nota: 3 },
  ];
  assert.deepEqual(resumoAberta(votos, 'bia'), { n_votos: 2, meu_voto: 8 });
  assert.deepEqual(resumoAberta(votos, 'davi'), { n_votos: 2, meu_voto: null });
});

const perf = (pedido_id, pessoa_id, notas, extra = {}) => ({
  pedido_id,
  pessoa_id,
  status: 'cantou',
  votacao_aberta: 0,
  notas,
  ...extra,
});

test('ranking de performances: filtros, ordem e desempate por nº de votos', () => {
  const lista = [
    perf(1, 'ana', [8, 8, 8]),
    perf(2, 'bia', [9, 9, 9]),
    perf(3, 'caio', [8, 8, 8, 8]),
    perf(4, 'davi', [10, 10]), // poucos votos
    perf(5, 'eva', [10, 10, 10], { votacao_aberta: 1 }), // ainda aberta
    perf(6, 'fabi', [10, 10, 10], { status: 'removido' }),
  ];
  const r = rankingPerformances(lista, 3);
  assert.deepEqual(r.map((p) => p.pedido_id), [2, 3, 1]);
  assert.deepEqual(r.map((p) => p.n_votos), [3, 4, 3]);
});

test('13. ranking de pessoas respeita o mínimo de performances; desempates', () => {
  const lista = [
    // ana: 8 e 6 → média 7, melhor 8
    perf(1, 'ana', [8, 8, 8]),
    perf(2, 'ana', [6, 6, 6]),
    // bia: 7 e 7 → média 7, melhor 7 (perde no desempate para ana)
    perf(3, 'bia', [7, 7, 7]),
    perf(4, 'bia', [7, 7, 7]),
    // caio: 10, mas só uma performance com nota
    perf(5, 'caio', [10, 10, 10]),
    perf(6, 'caio', [10]),
    // davi: 7, 7, 8, 6 → média 7, melhor 8, 4 performances (ganha de ana)
    perf(7, 'davi', [7, 7, 7]),
    perf(8, 'davi', [7, 7, 7]),
    perf(9, 'davi', [8, 8, 8]),
    perf(10, 'davi', [6, 6, 6]),
    // eva: média 9
    perf(11, 'eva', [9, 9, 9]),
    perf(12, 'eva', [9, 9, 9]),
  ];
  const r = rankingPessoas(lista, 3, 2);
  assert.deepEqual(r.map((p) => p.pessoa_id), ['eva', 'davi', 'ana', 'bia']);
  assert.deepEqual(r[1], { pessoa_id: 'davi', media: 7, melhor: 8, n_performances: 4 });

  // Mínimo de performances configurável: com 1, caio entra em primeiro.
  assert.equal(rankingPessoas(lista, 3, 1)[0].pessoa_id, 'caio');
  // Ninguém atinge o mínimo: lista vazia (a tela abre em Performances).
  assert.deepEqual(rankingPessoas(lista, 3, 5), []);
});
