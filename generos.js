// Gênero musical por artista (SPEC 5.7): classificação pelo Claude, resumo e filtro do catálogo.
import { erro } from './erros.js';
import { escrever } from './db.js';
import { participantes } from './artistas.js';
import { normalizarBusca } from './texto.js';

export const GENEROS = [
  'MPB', 'Sertanejo', 'Samba/Pagode', 'Forró/Piseiro', 'Axé', 'Funk', 'Brega/Arrocha', 'Pop Nacional',
  'Rock Nacional', 'Gospel', 'Infantil', 'Pop Internacional', 'Rock Internacional', 'Latino', 'Reggae', 'Outros',
];
export const CONFIANCAS = ['alta', 'media', 'baixa'];
const PESOS = { alta: 0.95, media: 0.75, baixa: 0.5 };
export const LOTE = 150;

const URL_API = 'https://api.anthropic.com/v1/messages';
const MODELO = 'claude-opus-5-5';
const TEMPO_MAXIMO_MS = 180_000;

// Artistas principais do catálogo: [{ chave, nome, total }], os com mais músicas primeiro.
export function artistasPrincipais(db) {
  const linhas = db.prepare('SELECT artista, COUNT(*) AS n FROM musicas WHERE fora_do_catalogo = 0 GROUP BY artista').all();
  const porChave = new Map();
  for (const { artista, n } of linhas) {
    const [nome] = participantes(artista);
    const chave = nome && normalizarBusca(nome);
    if (!chave) continue;
    const a = porChave.get(chave) ?? { chave, total: 0, grafias: new Map() };
    a.total += n;
    a.grafias.set(nome, (a.grafias.get(nome) ?? 0) + n);
    porChave.set(chave, a);
  }
  return [...porChave.values()]
    .map(({ chave, total, grafias }) => ({ chave, nome: [...grafias].sort((x, y) => y[1] - x[1])[0][0], total }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}

function classificados(db) {
  return new Map(db.prepare('SELECT chave, genero, confianca FROM generos_artista').all().map((g) => [g.chave, g]));
}

export function resumoGeneros(db) {
  const artistas = artistasPrincipais(db);
  const mapa = classificados(db);
  const musicas = artistas.reduce((t, a) => t + a.total, 0);
  const por_confianca = Object.fromEntries(CONFIANCAS.map((c) => [c, { artistas: 0, musicas: 0 }]));
  const porGenero = new Map();
  const desconhecidos = { artistas: 0, musicas: 0 };
  const baixa = [];
  let pendentes = 0;
  for (const a of artistas) {
    const g = mapa.get(a.chave);
    if (!g) {
      pendentes++;
      continue;
    }
    if (!g.genero) {
      desconhecidos.artistas++;
      desconhecidos.musicas += a.total;
      continue;
    }
    por_confianca[g.confianca].artistas++;
    por_confianca[g.confianca].musicas += a.total;
    porGenero.set(g.genero, (porGenero.get(g.genero) ?? 0) + a.total);
    if (g.confianca === 'baixa' && baixa.length < 10) baixa.push({ nome: a.nome, genero: g.genero, total: a.total });
  }
  const comGenero = CONFIANCAS.reduce((t, c) => t + por_confianca[c].musicas, 0);
  const pesado = CONFIANCAS.reduce((t, c) => t + por_confianca[c].musicas * PESOS[c], 0);
  return {
    artistas: artistas.length,
    musicas,
    pendentes,
    cobertura: musicas ? comGenero / musicas : 0,
    precisao_estimada: comGenero ? pesado / comGenero : null,
    por_confianca,
    desconhecidos,
    por_genero: [...porGenero].map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total),
    amostra_baixa: baixa,
  };
}

// Grava [{ chave, genero, confianca }]; genero '' = artista desconhecido.
export function gravarGeneros(db, itens, origem) {
  const inserir = db.prepare(`INSERT INTO generos_artista (chave, genero, confianca, origem) VALUES (@chave, @genero, @confianca, @origem)
    ON CONFLICT(chave) DO UPDATE SET genero = excluded.genero, confianca = excluded.confianca, origem = excluded.origem`);
  escrever(db, () => {
    for (const item of itens) inserir.run({ ...item, origem });
  });
}

const ESQUEMA = {
  type: 'object',
  properties: {
    artistas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer' },
          genero: { type: 'string', enum: [...GENEROS, ''] },
          confianca: { type: 'string', enum: CONFIANCAS },
        },
        required: ['n', 'genero', 'confianca'],
        additionalProperties: false,
      },
    },
  },
  required: ['artistas'],
  additionalProperties: false,
};

const INSTRUCOES = `Você classifica artistas de um catálogo de karaokê brasileiro pelo gênero musical pelo qual o artista é mais conhecido no Brasil.
Use só uma destas categorias: ${GENEROS.join(', ')}.
Artista brasileiro de pop, rap, eletrônica ou indie que não se encaixe em outra categoria nacional fica em Pop Nacional; estrangeiro de hip-hop, R&B, country ou eletrônica fica em Pop Internacional, salvo se for claramente rock. Artista em espanhol fica em Latino.
Para cada artista dê a confiança: "alta" quando você conhece bem o artista, "media" quando conhece mas o gênero é discutível, "baixa" quando está deduzindo pelo nome ou pelo contexto.
Se não reconhecer o artista, devolva genero vazio ("") com confiança "baixa". Não invente.
Responda um item para cada número da lista.`;

// Classifica o próximo lote de artistas sem gênero. A chave da API só passa por aqui:
// não é gravada nem registrada (SPEC 5.7).
export async function classificarLote(db, { chave, lote = LOTE, fetch = globalThis.fetch } = {}) {
  const chaveApi = String(chave ?? '').trim();
  if (!chaveApi) throw erro(422, 'chave_vazia', 'Cole a chave de API da Anthropic.', { campo: 'chave' });
  if (chaveApi.length > 300 || /\s/.test(chaveApi)) throw erro(422, 'chave_invalida', 'Essa chave não parece uma chave de API da Anthropic.', { campo: 'chave' });

  const mapa = classificados(db);
  const pendentes = artistasPrincipais(db).filter((a) => !mapa.has(a.chave));
  const alvo = pendentes.slice(0, lote);
  if (!alvo.length) return { feitos: 0, restantes: 0 };

  const lista = alvo.map((a, i) => `${i + 1}. ${a.nome}`).join('\n');
  let res;
  try {
    res = await fetch(URL_API, {
      method: 'POST',
      headers: {
        'x-api-key': chaveApi,
        'anthropic-version': '2026-10-21',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
        fallbacks: 'default',
        system: INSTRUCOES,
        messages: [{ role: 'user', content: `Artistas:\n${lista}` }],
      }),
      signal: AbortSignal.timeout(TEMPO_MAXIMO_MS),
    });
  } catch {
    throw erro(502, 'anthropic_indisponivel', 'Não deu para falar com a Anthropic agora. Tente de novo.');
  }
  if (res.status === 401 || res.status === 403) throw erro(422, 'chave_invalida', 'A Anthropic não aceitou essa chave de API.', { campo: 'chave' });
  if (res.status === 429) throw erro(503, 'anthropic_limite', 'A chave chegou ao limite de uso da Anthropic. Espere um pouco e continue.');
  if (!res.ok) throw erro(502, 'anthropic_indisponivel', 'A Anthropic não respondeu como esperado. Tente de novo.');

  const msg = await res.json().catch(() => null);
  if (msg?.stop_reason === 'refusal') throw erro(502, 'anthropic_indisponivel', 'A Anthropic recusou classificar este lote. Tente de novo.');
  const texto = msg?.stop_reason === 'end_turn' ? msg.content?.find((b) => b.type === 'text')?.text : null;
  let resposta;
  try {
    resposta = JSON.parse(texto ?? '');
  } catch {
    throw erro(502, 'anthropic_indisponivel', 'A resposta da Anthropic veio incompleta. Tente de novo.');
  }

  const itens = new Map();
  for (const r of resposta?.artistas ?? []) {
    const a = alvo[r.n - 1];
    if (!a || !(GENEROS.includes(r.genero) || r.genero === '') || !CONFIANCAS.includes(r.confianca)) continue;
    itens.set(a.chave, { chave: a.chave, genero: r.genero, confianca: r.confianca });
  }
  gravarGeneros(db, [...itens.values()], 'claude');
  return { feitos: itens.size, restantes: pendentes.length - itens.size };
}

// CSV "artista;genero;confianca" de uma classificação feita fora do app (SPEC 5.7).
export function lerCsvGeneros(conteudo) {
  const itens = [];
  let ignoradas = 0;
  for (const [i, linha] of conteudo.replace(/^﻿/, '').split(/\r?\n/).entries()) {
    if (!linha.trim()) continue;
    const [artista = '', genero = '', confianca = ''] = linha.split(';').map((c) => c.trim());
    if (i === 0 && artista.toLowerCase() === 'artista') continue;
    const conf = confianca.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const chave = normalizarBusca(artista);
    if (!chave || !(GENEROS.includes(genero) || genero === '') || !CONFIANCAS.includes(conf)) {
      ignoradas++;
      continue;
    }
    itens.push({ chave, genero, confianca: conf });
  }
  return { itens, ignoradas };
}

// Gêneros com músicas no catálogo, para os chips do convidado.
export function listarGeneros(db, { filtro = '' } = {}) {
  const idioma = filtro === 'nacionais' ? "AND m.idioma = 'BRA'" : filtro === 'internacionais' ? "AND m.idioma <> 'BRA'" : '';
  return db.prepare(`
    SELECT g.genero AS nome, COUNT(*) AS total FROM musicas m JOIN generos_artista g ON g.chave = artista_principal(m.artista)
     WHERE m.fora_do_catalogo = 0 AND g.genero <> '' ${idioma} GROUP BY g.genero ORDER BY total DESC, nome`).all();
}
