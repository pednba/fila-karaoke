import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ordenar, escolherProximo, mover, decidirPulo, validarPedido, liberadoParaCantou } from '../fila.js';

let seq = 0;
const pedido = (pessoa_id, t_fila, extra = {}) => ({
  id: ++seq,
  pessoa_id,
  t_fila,
  ordem_manual: null,
  bypass: 0,
  pulos: 0,
  ...extra,
});
const pessoas = (lista) => lista.map((p) => p.pessoa_id);

test('1. quem nunca cantou passa à frente de quem já cantou, mesmo pedindo depois', () => {
  const pendentes = [pedido('ana', 1), pedido('bia', 2)];
  assert.deepEqual(pessoas(ordenar({ pendentes, cantadas: { ana: 1 } })), ['bia', 'ana']);
});

test('1b. o pedido na vez já conta como cantada', () => {
  const pendentes = [pedido('ana', 1), pedido('bia', 2), pedido('caio', 3)];
  // Ana está no palco: o próximo pedido dela vai para a rodada 1, atrás de Bia e Caio.
  assert.deepEqual(pessoas(ordenar({ pendentes, cantorDaVez: 'ana' })), ['bia', 'caio', 'ana']);
});

test('2. rodadas iguais seguem a ordem de chegada', () => {
  const pendentes = [pedido('caio', 3), pedido('ana', 1), pedido('bia', 2)];
  assert.deepEqual(pessoas(ordenar({ pendentes })), ['ana', 'bia', 'caio']);
});

test('3. ninguém aparece duas vezes seguidas, inclusive contra o cantor da vez', () => {
  // Ana: rodadas 0 e 1. Bia já cantou: rodada 1. Por (rodada, chegada) sairia ana, ana, bia.
  const pendentes = [pedido('ana', 1), pedido('ana', 2), pedido('bia', 3)];
  assert.deepEqual(pessoas(ordenar({ pendentes, cantadas: { bia: 1 } })), ['ana', 'bia', 'ana']);

  // Contra o cantor da vez (VIP para manter a rodada 0 e isolar a regra).
  const contraPalco = ordenar({ pendentes: [pedido('ana', 1), pedido('bia', 2)], cantorDaVez: 'ana', vips: new Set(['ana']) });
  assert.deepEqual(pessoas(contraPalco), ['bia', 'ana']);

  // Contra o último cantor, quando não há ninguém no palco.
  const contraUltimo = ordenar({ pendentes: [pedido('ana', 1), pedido('bia', 2)], ultimoCantor: 'ana', vips: new Set(['ana']) });
  assert.deepEqual(pessoas(contraUltimo), ['bia', 'ana']);
});

test('4. com bypass, pode cantar duas seguidas', () => {
  const pendentes = [pedido('ana', 1, { bypass: 1 }), pedido('bia', 2)];
  const ordem = ordenar({ pendentes, ultimoCantor: 'ana', vips: new Set(['ana']) });
  assert.deepEqual(pessoas(ordem), ['ana', 'bia']);
});

test('5. só sobrou uma pessoa: a fila anda', () => {
  const pendentes = [pedido('ana', 1), pedido('ana', 2)];
  assert.deepEqual(pessoas(ordenar({ pendentes, cantorDaVez: 'ana' })), ['ana', 'ana']);
  assert.equal(escolherProximo({ pendentes, ultimoCantor: 'ana' }).pessoa_id, 'ana');
});

test('6. VIP com 3 cantadas empata com quem nunca cantou; dois VIPs seguem rodada e chegada', () => {
  const vips = new Set(['vip1', 'vip2']);
  const umVip = ordenar({ pendentes: [pedido('bia', 1), pedido('vip1', 2)], cantadas: { vip1: 3 }, vips });
  assert.deepEqual(umVip.map((p) => [p.pessoa_id, p.rodada]), [['bia', 0], ['vip1', 0]]);

  const doisVips = ordenar({
    pendentes: [pedido('vip2', 1), pedido('vip2', 2), pedido('vip1', 3), pedido('vip1', 4)],
    cantadas: { vip1: 5, vip2: 2 },
    vips,
  });
  assert.deepEqual(pessoas(doisVips), ['vip2', 'vip1', 'vip2', 'vip1']);
  assert.deepEqual(doisVips.map((p) => p.rodada), [0, 0, 1, 1]);
});

test('7. pedido novo não tira o na_vez do palco', () => {
  const naVez = pedido('ana', 1, { status: 'na_vez' });
  const pendentes = [pedido('bia', 2), pedido('caio', 3)];
  assert.equal(escolherProximo({ naVez, pendentes, cantorDaVez: 'ana' }), null);
  // Sem ninguém no palco, o primeiro da fila sobe.
  assert.equal(escolherProximo({ pendentes }).pessoa_id, 'bia');
  // Fila vazia: nada a promover.
  assert.equal(escolherProximo({ pendentes: [] }), null);
});

test('8. ordem manual respeitada; pedidos novos entram depois', () => {
  const a = pedido('ana', 1);
  const b = pedido('bia', 2);
  const c = pedido('caio', 3);
  const ordenados = ordenar({ pendentes: [a, b, c] });
  const mudancas = mover(ordenados, c.id, 'cima'); // ana, caio, bia
  assert.deepEqual(mudancas, [
    { id: a.id, ordem_manual: 0 },
    { id: c.id, ordem_manual: 1 },
    { id: b.id, ordem_manual: 2 },
  ]);

  const aplicar = (p) => ({ ...p, ordem_manual: mudancas.find((m) => m.id === p.id).ordem_manual });
  const novo = pedido('davi', 0.5); // chegou "antes" no relógio, mas não tem ordem manual
  const depois = ordenar({ pendentes: [aplicar(a), aplicar(b), aplicar(c), novo] });
  assert.deepEqual(pessoas(depois), ['ana', 'caio', 'bia', 'davi']);

  // Ordem manual ignora a anti-repetição, inclusive contra o cantor da vez.
  const repetido = ordenar({ pendentes: [pedido('ana', 1, { ordem_manual: 0 }), pedido('bia', 2)], cantorDaVez: 'ana' });
  assert.deepEqual(pessoas(repetido), ['ana', 'bia']);

  // Nas bordas, não há o que mover.
  assert.equal(mover(ordenados, a.id, 'cima'), null);
  assert.equal(mover(ordenados, c.id, 'baixo'), null);
});

test('9. pulos: volta ao fim da rodada até o limite configurado, depois é removido', () => {
  const ana = pedido('ana', 1, { status: 'na_vez' });
  const outros = [pedido('bia', 2), pedido('caio', 3), pedido('davi', 4, {}), pedido('bia', 5)];

  const p1 = decidirPulo(ana, 2, 10);
  assert.deepEqual(p1, { status: 'pendente', pulos: 1, t_fila: 10, ordem_manual: null });
  // Volta ao fim da rodada 0: depois de caio e davi, antes do 2º pedido de bia (rodada 1).
  const ordem = ordenar({ pendentes: [...outros, { ...ana, ...p1 }] });
  assert.deepEqual(pessoas(ordem), ['bia', 'caio', 'davi', 'ana', 'bia']);

  assert.deepEqual(decidirPulo({ ...ana, pulos: 1 }, 2, 20), { status: 'removido', pulos: 2 });

  // Limite configurável.
  assert.equal(decidirPulo({ ...ana, pulos: 1 }, 3, 20).status, 'pendente');
  assert.equal(decidirPulo({ ...ana, pulos: 2 }, 3, 20).status, 'removido');
  assert.equal(decidirPulo(ana, 1, 20).status, 'removido');
});

test('10. limite de pendentes configurável; cancelar libera vaga', () => {
  const meus = [
    { musica_cod: '1', status: 'na_vez' },
    { musica_cod: '2', status: 'pendente' },
    { musica_cod: '3', status: 'cantou' },
  ];
  assert.equal(validarPedido({ meusPedidos: meus, musica_cod: '4', limite: 2 }), 'limite_atingido');
  assert.equal(validarPedido({ meusPedidos: meus, musica_cod: '4', limite: 3 }), null);

  meus[1].status = 'cancelado';
  assert.equal(validarPedido({ meusPedidos: meus, musica_cod: '4', limite: 2 }), null);
});

test('10b. pedido repetido vale por pessoa e só para pendente ou na vez', () => {
  const meus = [
    { musica_cod: '1', status: 'pendente' },
    { musica_cod: '3', status: 'cantou' },
  ];
  assert.equal(validarPedido({ meusPedidos: meus, musica_cod: '1', limite: 3 }), 'ja_pedida');
  assert.equal(validarPedido({ meusPedidos: meus, musica_cod: '3', limite: 3 }), null);
});

test('cantou: dono sempre; quem está na fila, menos o próximo, depois de 2 minutos', () => {
  const atual = { pessoa_id: 'ana', na_vez_em: '2026-11-02 21:00:00' };
  const fila = [{ pessoa_id: 'bia' }, { pessoa_id: 'caio' }, { pessoa_id: 'bia' }];
  const inicio = Date.parse('2026-11-02T21:00:00Z');
  assert.equal(liberadoParaCantou({ pessoa_id: 'ana', atual, fila }), 0);
  assert.equal(liberadoParaCantou({ pessoa_id: 'caio', atual, fila }), inicio + 2 * 60_000);
  assert.equal(liberadoParaCantou({ pessoa_id: 'bia', atual, fila }), null, 'o próximo não avança, mesmo com outro pedido depois');
  assert.equal(liberadoParaCantou({ pessoa_id: 'davi', atual, fila }), null, 'quem não está na fila não avança');
  assert.equal(liberadoParaCantou({ pessoa_id: null, atual, fila }), null);
  assert.equal(liberadoParaCantou({ pessoa_id: 'caio', atual: null, fila }), null);
});
