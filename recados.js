// Recados dos convidados no telão (SPEC 9.4).
import { erro } from './erros.js';
import { lerFesta } from './festa.js';
import { contarCaracteres } from './texto.js';

export const TEXTO_RECADO_MAX = 100;
export const INTERVALO_RECADO_S = 60;
export const RECADOS_TELAO = 6;
export const RECADOS_ADMIN = 10;

export function validarTextoRecado(texto) {
  const limpo = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!limpo) throw erro(422, 'texto_vazio', 'Escreva o recado.');
  if (contarCaracteres(limpo) > TEXTO_RECADO_MAX) throw erro(422, 'texto_longo', `O recado pode ter até ${TEXTO_RECADO_MAX} caracteres.`);
  return limpo;
}

// Os mais recentes primeiro, com o nome de quem mandou.
export function listarRecados(db, n) {
  return db.prepare(`
    SELECT r.id, s.nome, r.texto, r.criado_em
      FROM recados r JOIN pessoas s ON s.id = r.pessoa_id
     ORDER BY r.id DESC LIMIT ?`).all(n);
}

// Chamar dentro de escrever().
export function criarRecado(db, { pessoa_id, texto }) {
  const festa = lerFesta(db);
  if (festa.status !== 'aberta') throw erro(403, 'festa_fechada', 'A festa não está aberta.');
  if (!festa.regras.recados) throw erro(403, 'recados_desligados', 'Os recados no telão estão desligados nesta festa.');
  const limpo = validarTextoRecado(texto);
  const recente = db.prepare(`SELECT 1 FROM recados WHERE pessoa_id = ? AND criado_em > datetime('now', '-${INTERVALO_RECADO_S} seconds')`).get(pessoa_id);
  if (recente) throw erro(429, 'recado_rapido', 'Espere um minuto para mandar outro recado.');
  const { lastInsertRowid } = db.prepare('INSERT INTO recados (pessoa_id, texto) VALUES (?, ?)').run(pessoa_id, limpo);
  return db.prepare('SELECT r.id, s.nome, r.texto, r.criado_em FROM recados r JOIN pessoas s ON s.id = r.pessoa_id WHERE r.id = ?').get(lastInsertRowid);
}

export function apagarRecado(db, id) {
  const { changes } = db.prepare('DELETE FROM recados WHERE id = ?').run(id);
  if (!changes) throw erro(404, 'recado_inexistente', 'Esse recado não existe mais.');
}
