// Rotas de operação do admin (SPEC 10.4).
import express from 'express';
import { erro } from '../erros.js';
import { verificarPin } from '../auth.js';
import { lerFesta } from '../festa.js';

export function rotasAdmin({ db, auth }) {
  const r = express.Router();

  r.post('/login', auth.limitarLogin, (req, res) => {
    const { admin_pin_hash } = lerFesta(db);
    if (!admin_pin_hash) throw erro(409, 'sem_pin', 'A festa ainda não foi configurada.');
    if (!verificarPin(req.body?.pin, admin_pin_hash)) throw erro(401, 'pin_incorreto', 'PIN incorreto.');
    auth.emitirCookieAdmin(res, admin_pin_hash);
    res.json({ ok: true });
  });

  return r;
}
