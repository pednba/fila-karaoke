// Gravação do catálogo importado (SPEC 4.2, passo 4).
import { escrever } from './db.js';
import { erro } from './erros.js';

// Pedidos ativos de músicas que não estão no catálogo novo.
export function pedidosAfetados(db, musicas) {
  const novos = new Set(musicas.map((m) => m.cod));
  return db
    .prepare("SELECT id, musica_cod, status FROM pedidos WHERE status IN ('pendente', 'na_vez')")
    .all()
    .filter((p) => !novos.has(p.musica_cod));
}

// Substitui o catálogo. Com a festa aberta exige `confirmar`; pedidos pendentes de músicas
// que sumiram são cancelados. O pedido na vez continua no palco (SPEC 8.1).
export function gravarCatalogo(db, { musicas, origem, statusFesta, confirmar = false }) {
  const afetados = pedidosAfetados(db, musicas);
  if (statusFesta !== 'rascunho' && !confirmar) {
    throw erro(409, 'confirmacao_necessaria', 'A festa já está aberta. Confirme para trocar o catálogo.', {
      pedidos_cancelados: afetados.filter((p) => p.status === 'pendente').length,
    });
  }

  return escrever(db, () => {
    const cancelar = db.prepare("UPDATE pedidos SET status = 'cancelado', finalizado_em = datetime('now') WHERE id = ?");
    for (const p of afetados) if (p.status === 'pendente') cancelar.run(p.id);

    db.exec('CREATE TEMP TABLE IF NOT EXISTS novos_cods (cod TEXT PRIMARY KEY); DELETE FROM novos_cods;');
    const marcar = db.prepare('INSERT INTO novos_cods (cod) VALUES (?)');
    for (const m of musicas) marcar.run(m.cod);

    // Sumiram: apagar se ninguém pediu; senão esconder da busca.
    db.exec(`
      DELETE FROM musicas
       WHERE cod NOT IN (SELECT cod FROM novos_cods)
         AND cod NOT IN (SELECT musica_cod FROM pedidos);
      UPDATE musicas SET fora_do_catalogo = 1 WHERE cod NOT IN (SELECT cod FROM novos_cods);
    `);
    const gravar = db.prepare(`
      INSERT INTO musicas (cod, titulo, artista, inicio, idioma, busca, fora_do_catalogo)
      VALUES (@cod, @titulo, @artista, @inicio, @idioma, @busca, 0)
      ON CONFLICT(cod) DO UPDATE SET titulo = excluded.titulo, artista = excluded.artista, inicio = excluded.inicio,
        idioma = excluded.idioma, busca = excluded.busca, fora_do_catalogo = 0
    `);
    for (const m of musicas) gravar.run(m);
    db.exec('DELETE FROM novos_cods');

    db.prepare("UPDATE festa SET catalogo_origem = ?, atualizado_em = datetime('now') WHERE id = 1").run(origem);
    return { total: musicas.length, pedidos_cancelados: afetados.filter((p) => p.status === 'pendente').length };
  });
}
