// Ciclo de vida da festa (SPEC 4.3) e arte pública.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { erro } from '../erros.js';
import { escrever } from '../db.js';
import { estadoSetup, lerFesta, arquivarFesta } from '../festa.js';

export function rotasFesta({ db, config, auth }) {
  const r = express.Router();

  // Dados públicos (SPEC 10.2).
  r.get('/', (req, res) => {
    const f = lerFesta(db);
    const { pendentes_por_pessoa, minutos_por_musica, votacao, ranking_pessoas, minimo_votos } = f.regras;
    res.json({
      status: f.status,
      titulo: f.titulo,
      nome_destaque: f.nome_destaque,
      subtitulo: f.subtitulo,
      inicio_em: f.inicio_em,
      duracao_min: f.duracao_min,
      local: f.local,
      arte_url: f.arte_arquivo ? '/api/festa/arte' : null,
      tema: f.tema,
      regras: { pendentes_por_pessoa, minutos_por_musica, votacao, ranking_pessoas, minimo_votos },
    });
  });

  r.get('/arte', (req, res) => {
    const { arte_arquivo } = lerFesta(db);
    const arquivo = arte_arquivo && path.join(config.dataDir, arte_arquivo);
    if (!arquivo || !fs.existsSync(arquivo)) throw erro(404, 'sem_arte', 'A festa não tem arte.');
    res.set('Cache-Control', 'public, max-age=300').sendFile(path.resolve(arquivo));
  });

  const exigirStatus = (status) => {
    const atual = lerFesta(db).status;
    if (atual !== status) throw erro(409, 'status_invalido', `A festa está ${atual.replace('_', ' ')}.`, { status: atual });
  };

  r.post('/abrir', auth.exigirSetup, (req, res) => {
    exigirStatus('rascunho');
    const { falta } = estadoSetup(db);
    if (falta.length) throw erro(409, 'setup_incompleto', 'Complete o setup antes de abrir a festa.', { falta });
    escrever(db, () => db.prepare("UPDATE festa SET status = 'aberta', atualizado_em = datetime('now') WHERE id = 1").run());
    res.json({ status: 'aberta' });
  });

  // Encerrar fecha as votações abertas para a última performance entrar no ranking final.
  r.post('/encerrar', auth.exigirSetup, (req, res) => {
    exigirStatus('aberta');
    escrever(db, () => {
      db.prepare("UPDATE festa SET status = 'encerrada', atualizado_em = datetime('now') WHERE id = 1").run();
      db.prepare('UPDATE pedidos SET votacao_aberta = 0 WHERE votacao_aberta = 1').run();
    });
    res.json({ status: 'encerrada' });
  });

  r.post('/arquivar', auth.exigirSetup, async (req, res) => {
    exigirStatus('encerrada');
    const manterCatalogo = req.body?.manter_catalogo !== false;
    const arquivo = await arquivarFesta(db, config.dataDir, { manterCatalogo });
    res.json({ status: 'rascunho', arquivo: path.relative(config.dataDir, arquivo) });
  });

  return r;
}
