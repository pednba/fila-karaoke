// Dados da festa (SPEC seção 4): padrões, validação, dimensionamento e ciclo de vida.
import fs from 'node:fs';
import path from 'node:path';
import { erro } from './erros.js';
import { montarTema } from './temas.js';
import { normalizar } from './texto.js';
import { escrever, gravarMeta, lerMeta } from './db.js';

// Passo 5 do setup.
export const REGRAS_PADRAO = {
  pendentes_por_pessoa: 3,
  minutos_por_musica: 5,
  pulos_ate_sair: 2,
  votacao: true,
  minimo_votos: 3,
  ranking_pessoas: true,
  minimo_performances: 2,
  vip: true,
  recados: true,
  qr_telao: true,
};

const LIMITES_REGRAS = {
  pendentes_por_pessoa: [1, 20],
  minutos_por_musica: [1, 30],
  pulos_ate_sair: [1, 10],
  minimo_votos: [1, 100],
  minimo_performances: [1, 50],
};

const ISO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function garantirFesta(db) {
  db.prepare('INSERT OR IGNORE INTO festa (id, tema, regras) VALUES (1, ?, ?)').run(
    JSON.stringify(montarTema()),
    JSON.stringify(REGRAS_PADRAO)
  );
}

export function lerFesta(db) {
  const f = db.prepare('SELECT * FROM festa WHERE id = 1').get();
  return { ...f, tema: JSON.parse(f.tema), regras: { ...REGRAS_PADRAO, ...JSON.parse(f.regras) } };
}

function texto(valor, campo, rotulo, max, obrigatorio = false) {
  const s = String(valor ?? '').trim();
  if (obrigatorio && !s) throw erro(422, 'campo_obrigatorio', `Preencha ${rotulo}.`, { campo });
  if (s.length > max) throw erro(422, 'campo_longo', `${rotulo} pode ter até ${max} caracteres.`, { campo });
  return s;
}

// Passo 2. Recebe a duração em horas e grava em minutos.
export function validarDadosFesta(corpo) {
  const nome_destaque = texto(corpo.nome_destaque, 'nome_destaque', 'o nome em destaque', 40, true);
  const titulo = texto(corpo.titulo, 'titulo', 'o título', 80) || `Karaokê da ${nome_destaque}`;
  const subtitulo = texto(corpo.subtitulo, 'subtitulo', 'o subtítulo', 60);
  const local = texto(corpo.local, 'local', 'o local', 120);
  const contato = texto(corpo.contato, 'contato', 'o contato', 120);
  // Pix copia e cola (BR Code) tem até 512 caracteres.
  const pix = texto(corpo.pix, 'pix', 'a chave Pix', 512);
  const pix_mensagem = texto(corpo.pix_mensagem, 'pix_mensagem', 'a mensagem do Pix', 200);

  const inicio_em = String(corpo.inicio_em ?? '').trim();
  if (!ISO_COM_FUSO.test(inicio_em) || Number.isNaN(Date.parse(inicio_em))) {
    throw erro(422, 'data_invalida', 'Informe a data e a hora de início.', { campo: 'inicio_em' });
  }
  const horas = Number(corpo.duracao_horas);
  if (!Number.isFinite(horas) || horas < 0.5 || horas > 24) {
    throw erro(422, 'duracao_invalida', 'A duração deve ficar entre meia hora e 24 horas.', { campo: 'duracao_horas' });
  }
  const convidados = Number(corpo.convidados);
  if (!Number.isInteger(convidados) || convidados < 1 || convidados > 1000) {
    throw erro(422, 'convidados_invalido', 'Informe o número estimado de convidados (1 a 1000).', { campo: 'convidados' });
  }
  return { nome_destaque, titulo, subtitulo, inicio_em, duracao_min: Math.round(horas * 60), local, contato, pix, pix_mensagem, convidados };
}

// Passo 5. Aceita só as chaves conhecidas, mescla com as atuais.
export function validarRegras(atuais, novas) {
  const regras = { ...atuais };
  for (const [chave, valor] of Object.entries(novas ?? {})) {
    if (!(chave in REGRAS_PADRAO)) throw erro(422, 'regra_desconhecida', `Regra desconhecida: ${chave}.`, { campo: chave });
    if (typeof REGRAS_PADRAO[chave] === 'boolean') {
      if (typeof valor !== 'boolean') throw erro(422, 'regra_invalida', 'Use sim ou não.', { campo: chave });
    } else {
      const [min, max] = LIMITES_REGRAS[chave];
      if (!Number.isInteger(valor) || valor < min || valor > max) {
        throw erro(422, 'regra_invalida', `Use um número inteiro de ${min} a ${max}.`, { campo: chave });
      }
    }
    regras[chave] = valor;
  }
  return regras;
}

// SPEC 1: músicas = duração_em_min / minutos_por_música.
export function dimensionamento(festa) {
  const musicas = Math.floor(festa.duracao_min / festa.regras.minutos_por_musica);
  return { musicas, convidados: festa.convidados, aviso_duas_vezes: musicas < festa.convidados };
}

export function slug(s) {
  return normalizar(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'festa';
}

// Passos que o admin já salvou (visual e regras têm padrão; os outros se deduzem dos dados).
export function lerPassosSalvos(db) {
  return JSON.parse(lerMeta(db, 'setup_passos') ?? '[]');
}

export function marcarPasso(db, passo) {
  const passos = new Set(lerPassosSalvos(db));
  passos.add(passo);
  gravarMeta(db, 'setup_passos', JSON.stringify([...passos]));
}

export function estadoSetup(db) {
  const festa = lerFesta(db);
  const salvos = lerPassosSalvos(db);
  const totalMusicas = db.prepare('SELECT COUNT(*) FROM musicas WHERE fora_do_catalogo = 0').pluck().get();
  const passos = {
    pin: Boolean(festa.admin_pin_hash),
    festa: Boolean(festa.nome_destaque && festa.inicio_em),
    visual: salvos.includes('visual'),
    catalogo: totalMusicas > 0,
    regras: salvos.includes('regras'),
  };
  const falta = ['pin', 'festa', 'catalogo'].filter((p) => !passos[p]);
  return { festa, passos, falta, totalMusicas };
}

// Arquivar (SPEC 4.3): copia o banco e zera pessoas, pedidos, votos e a festa.
// A versão continua subindo para os clientes perceberem a mudança.
export async function arquivarFesta(db, dataDir, { manterCatalogo = true } = {}) {
  const festa = lerFesta(db);
  const pasta = path.join(dataDir, 'arquivo');
  fs.mkdirSync(pasta, { recursive: true });
  const base = `${(festa.inicio_em ?? new Date().toISOString()).slice(0, 10)}-${slug(festa.titulo || festa.nome_destaque)}`;
  let destino = path.join(pasta, `${base}.db`);
  for (let n = 2; fs.existsSync(destino); n++) destino = path.join(pasta, `${base}-${n}.db`);
  db.prepare('UPDATE pessoas SET email = NULL').run(); // e-mail não vai para o arquivo (SPEC 9.1)
  db.exec('DELETE FROM inscricoes_push; DELETE FROM avisos; DELETE FROM recados;'); // nem os endereços de notificação (SPEC 9.3) e os recados (9.4)
  await db.backup(destino);

  escrever(db, () => {
    db.exec('DELETE FROM votos; DELETE FROM pedidos; DELETE FROM pessoas; DELETE FROM festa;');
    db.exec(manterCatalogo ? 'DELETE FROM musicas WHERE fora_do_catalogo = 1' : 'DELETE FROM musicas; DELETE FROM generos_artista;');
    db.prepare("DELETE FROM meta WHERE chave IN ('ultimo_cantor_id', 'setup_passos')").run();
    garantirFesta(db);
  });
  return destino;
}
