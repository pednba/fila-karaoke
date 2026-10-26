// Rotas do assistente de setup (SPEC 4 e 10.3). Admin, ou X-Setup-Token antes do PIN.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { erro } from '../erros.js';
import { escrever } from '../db.js';
import { hashPin, validarPin } from '../auth.js';
import { estadoSetup, lerFesta, marcarPasso, validarDadosFesta, validarRegras, dimensionamento } from '../festa.js';
import { montarTema, PRESETS, FONTES } from '../temas.js';
import { importarArquivo } from '../importadores/index.js';
import { gravarCatalogo } from '../catalogo.js';
import { renderizarCartaz } from '../cartaz.js';

const MB = 1024 * 1024;
const LIMITE_ARTE = 5 * MB;
const LIMITE_CATALOGO = 30 * MB;
const LARGURA_ARTE = 1200;
const VALIDADE_PREVIA_MS = 30 * 60 * 1000;

// Campos públicos e editáveis da festa (sem o hash do PIN).
export function dadosFesta(festa) {
  const { admin_pin_hash, arte_arquivo, ...resto } = festa;
  return { ...resto, arte_url: arte_arquivo ? '/api/festa/arte' : null };
}

// multer grava originalname como latin1.
const nomeOriginal = (arquivo) => Buffer.from(arquivo.originalname, 'latin1').toString('utf8');

export function rotasSetup({ db, config, auth }) {
  const r = express.Router();
  const pastaUploads = path.join(config.dataDir, 'uploads');
  const pastaTmp = path.join(pastaUploads, 'tmp');
  fs.mkdirSync(pastaTmp, { recursive: true });
  const uploadArte = multer({ dest: pastaTmp, limits: { fileSize: LIMITE_ARTE, files: 1 } });
  const uploadCatalogo = multer({ dest: pastaTmp, limits: { fileSize: LIMITE_CATALOGO, files: 1 } });
  const previas = new Map(); // token → { musicas, origem, expira }
  const link = () => new URL('/', config.publicUrl).href;

  r.use(auth.exigirSetup);

  r.get('/', (req, res) => {
    const { festa, passos, falta, totalMusicas } = estadoSetup(db);
    res.json({
      status: festa.status,
      passos,
      falta,
      festa: dadosFesta(festa),
      catalogo: { total: totalMusicas, origem: festa.catalogo_origem },
      dimensionamento: dimensionamento(festa),
      link: link(),
      presets: Object.entries(PRESETS).map(([id, p]) => ({ id, nome: p.nome, fonte: p.fonte, icone: p.icone, tokens: p.tokens })),
      fontes: FONTES,
    });
  });

  // Passo 1. Ao criar (ou trocar) o PIN, o navegador já fica logado como admin.
  r.put('/pin', (req, res) => {
    const { pin, confirmacao } = req.body ?? {};
    validarPin(pin);
    if (confirmacao !== undefined && confirmacao !== pin) throw erro(422, 'pin_diferente', 'Os dois PINs não são iguais.');
    const hash = hashPin(pin);
    escrever(db, () => db.prepare("UPDATE festa SET admin_pin_hash = ?, atualizado_em = datetime('now') WHERE id = 1").run(hash));
    auth.emitirCookieAdmin(res, hash);
    res.json({ ok: true });
  });

  // Passo 2.
  r.put('/festa', (req, res) => {
    const d = validarDadosFesta(req.body ?? {});
    escrever(db, () =>
      db
        .prepare(`UPDATE festa SET nome_destaque = @nome_destaque, titulo = @titulo, subtitulo = @subtitulo, inicio_em = @inicio_em,
                  duracao_min = @duracao_min, local = @local, convidados = @convidados, atualizado_em = datetime('now') WHERE id = 1`)
        .run(d)
    );
    const festa = lerFesta(db);
    res.json({ festa: dadosFesta(festa), dimensionamento: dimensionamento(festa) });
  });

  // Passo 3: tema e fonte.
  r.put('/visual', (req, res) => {
    const { preset, destaque, fonte } = req.body ?? {};
    const tema = montarTema({ preset, destaque: destaque || null, fonte: fonte || null });
    escrever(db, () => {
      db.prepare("UPDATE festa SET tema = ?, atualizado_em = datetime('now') WHERE id = 1").run(JSON.stringify(tema));
      marcarPasso(db, 'visual');
    });
    res.json({ tema });
  });

  // Passo 3: arte da festa, redimensionada para no máximo 1200 px de largura.
  r.post('/arte', uploadArte.single('arte'), async (req, res) => {
    if (!req.file) throw erro(422, 'arquivo_ausente', 'Escolha uma imagem.');
    const nome = `arte-${Date.now()}.webp`;
    try {
      const meta = await sharp(req.file.path).metadata().catch(() => null);
      if (!meta || !['jpeg', 'png', 'webp'].includes(meta.format)) {
        throw erro(422, 'imagem_invalida', 'Envie uma imagem JPG, PNG ou WebP.');
      }
      await sharp(req.file.path)
        .rotate()
        .resize({ width: LARGURA_ARTE, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toFile(path.join(pastaUploads, nome));
    } finally {
      fs.rmSync(req.file.path, { force: true });
    }
    const anterior = lerFesta(db).arte_arquivo;
    escrever(db, () => db.prepare("UPDATE festa SET arte_arquivo = ?, atualizado_em = datetime('now') WHERE id = 1").run(`uploads/${nome}`));
    if (anterior) fs.rmSync(path.join(config.dataDir, anterior), { force: true });
    res.json({ arte_url: '/api/festa/arte' });
  });

  // Passo 4: importa e devolve a prévia; só grava em /catalogo/confirmar.
  r.post('/catalogo', uploadCatalogo.single('arquivo'), async (req, res) => {
    if (!req.file) throw erro(422, 'arquivo_ausente', 'Escolha o arquivo do catálogo (PDF ou CSV).');
    let resultado;
    try {
      resultado = await importarArquivo(req.file.path);
    } catch (e) {
      if (e.codigo && !e.status) e.status = 422;
      throw e;
    } finally {
      fs.rmSync(req.file.path, { force: true });
    }
    if (!resultado.musicas.length) {
      throw erro(422, 'catalogo_vazio', 'Nenhuma música reconhecida. Confira se o PDF tem texto selecionável (não pode ser foto) ou se o CSV segue o modelo.', { previa: resultado.previa });
    }
    const agora = Date.now();
    for (const [t, p] of previas) if (p.expira < agora) previas.delete(t);
    const token = crypto.randomUUID();
    const origem = `${nomeOriginal(req.file)} · ${new Date().toISOString().slice(0, 10)}`;
    previas.set(token, { musicas: resultado.musicas, origem, expira: agora + VALIDADE_PREVIA_MS });
    res.json({ previa: resultado.previa, token });
  });

  r.post('/catalogo/confirmar', (req, res) => {
    const { token, confirmar } = req.body ?? {};
    const previa = previas.get(token);
    if (!previa || previa.expira < Date.now()) throw erro(410, 'previa_expirada', 'A prévia expirou. Envie o arquivo de novo.');
    const resultado = gravarCatalogo(db, { musicas: previa.musicas, origem: previa.origem, statusFesta: lerFesta(db).status, confirmar: confirmar === true });
    previas.delete(token);
    res.json(resultado);
  });

  // Passo 5.
  r.put('/regras', (req, res) => {
    const regras = validarRegras(lerFesta(db).regras, req.body);
    escrever(db, () => {
      db.prepare("UPDATE festa SET regras = ?, atualizado_em = datetime('now') WHERE id = 1").run(JSON.stringify(regras));
      marcarPasso(db, 'regras');
    });
    const festa = lerFesta(db);
    res.json({ regras, dimensionamento: dimensionamento(festa) });
  });

  // Passo 6: material para imprimir.
  r.get('/qr.png', async (req, res) => {
    res.type('png').set('Content-Disposition', 'inline; filename="qr-karaoke.png"');
    res.send(await QRCode.toBuffer(link(), { type: 'png', width: 1024, margin: 2 }));
  });

  r.get('/qr.svg', async (req, res) => {
    res.type('image/svg+xml').set('Content-Disposition', 'inline; filename="qr-karaoke.svg"');
    res.send(await QRCode.toString(link(), { type: 'svg', margin: 2 }));
  });

  r.get('/cartaz.html', async (req, res) => {
    const qrSvg = await QRCode.toString(link(), { type: 'svg', margin: 0 });
    res.type('html').send(renderizarCartaz({ festa: lerFesta(db), link: link(), qrSvg }));
  });

  return r;
}
