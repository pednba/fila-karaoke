import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, contraste, montarTema, cssDoTema, CONTRASTE_MINIMO } from '../temas.js';

test('contraste WCAG: preto sobre branco é 21:1', () => {
  assert.equal(Math.round(contraste('#000000', '#FFFFFF')), 21);
  assert.equal(contraste('#777777', '#777777'), 1);
});

test('todos os presets passam contraste nos pares de texto', () => {
  const pares = [
    ['texto', 'fundo'],
    ['texto-2', 'fundo'],
    ['texto', 'superficie'],
    ['texto-2', 'superficie'],
    ['destaque-palco', 'palco'],
    ['texto-palco', 'palco'],
    ['texto-palco-2', 'palco'],
    ['alerta', 'alerta-fundo'],
  ];
  for (const [id, preset] of Object.entries(PRESETS)) {
    for (const [a, b] of pares) {
      const r = contraste(preset.tokens[a], preset.tokens[b]);
      assert.ok(r >= CONTRASTE_MINIMO, `${id}: ${a} sobre ${b} = ${r.toFixed(2)}`);
    }
    assert.doesNotThrow(() => montarTema({ preset: id }));
  }
});

test('cor de destaque substitui decor e destaque-palco; contraste ruim é recusado', () => {
  const tema = montarTema({ preset: 'dourado', destaque: '#f0c060' });
  assert.equal(tema.tokens.decor, '#F0C060');
  assert.equal(tema.tokens['destaque-palco'], '#F0C060');
  assert.equal(tema.fonte, 'Great Vibes');

  assert.throws(() => montarTema({ preset: 'dourado', destaque: '#3A2A10' }), { codigo: 'contraste_insuficiente' });
  assert.throws(() => montarTema({ preset: 'dourado', destaque: 'dourado' }), { codigo: 'cor_invalida' });
  assert.throws(() => montarTema({ preset: 'xadrez' }), { codigo: 'preset_invalido' });
  assert.throws(() => montarTema({ fonte: 'Comic Sans' }), { codigo: 'fonte_invalida' });
  assert.equal(montarTema({ preset: 'neon', fonte: 'Pacifico' }).fonte, 'Pacifico');
});

test('cssDoTema gera as variáveis da seção 11', () => {
  const css = cssDoTema(montarTema());
  for (const token of ['--fundo', '--superficie', '--borda', '--decor', '--palco', '--destaque-palco', '--texto', '--texto-2',
    '--texto-palco', '--texto-palco-2', '--alerta', '--alerta-fundo', '--fonte-destaque', '--fonte-base']) {
    assert.ok(css.includes(`${token}:`), token);
  }
});
