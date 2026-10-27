// Acesso (SPEC seção 7): PIN do admin, cookie `adm` assinado, SETUP_TOKEN antes do PIN.
import crypto from 'node:crypto';
import { erro } from './erros.js';

const SCRYPT = { N: 16384, r: 8, p: 1 };
const VALIDADE_ADMIN_MS = 7 * 24 * 60 * 60 * 1000;
const TENTATIVAS_POR_MINUTO = 5;

export function validarPin(pin) {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) {
    throw erro(422, 'pin_invalido', 'O PIN deve ter de 4 a 8 dígitos.');
  }
}

export function hashPin(pin) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, sal, 32, SCRYPT);
  return `scrypt$${sal.toString('hex')}$${hash.toString('hex')}`;
}

export function verificarPin(pin, guardado) {
  if (typeof pin !== 'string' || !guardado) return false;
  const [, salHex, hashHex] = guardado.split('$');
  const esperado = Buffer.from(hashHex, 'hex');
  const hash = crypto.scryptSync(pin, Buffer.from(salHex, 'hex'), esperado.length, SCRYPT);
  return crypto.timingSafeEqual(hash, esperado);
}

export function iguais(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// O cookie leva uma marca derivada do hash do PIN: trocar o PIN ou arquivar a festa invalida sessões antigas.
function marca(pinHash) {
  return crypto.createHash('sha256').update(pinHash).digest('hex').slice(0, 24);
}

export function criarAuth({ config, lerPinHash }) {
  const tentativas = new Map();

  function emitirCookieAdmin(res, pinHash) {
    res.cookie('adm', marca(pinHash), {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookiesSeguros,
      maxAge: VALIDADE_ADMIN_MS,
    });
  }

  function ehAdmin(req) {
    const pinHash = lerPinHash();
    const valor = req.signedCookies?.adm;
    return Boolean(pinHash && valor && iguais(valor, marca(pinHash)));
  }

  function exigirAdmin(req, res, next) {
    if (ehAdmin(req)) return next();
    next(erro(401, 'nao_autorizado', 'Entre com o PIN do admin.'));
  }

  // Rotas de setup: X-Setup-Token enquanto não existe PIN; depois, só cookie de admin.
  function exigirSetup(req, res, next) {
    if (lerPinHash()) return exigirAdmin(req, res, next);
    const token = req.get('X-Setup-Token');
    if (token && iguais(token, config.setupToken)) return next();
    next(erro(401, 'token_invalido', 'Informe o código de configuração (SETUP_TOKEN).'));
  }

  // Máximo de 5 tentativas de login por minuto por IP.
  function limitarLogin(req, res, next) {
    const agora = Date.now();
    const lista = (tentativas.get(req.ip) ?? []).filter((t) => agora - t < 60_000);
    if (lista.length >= TENTATIVAS_POR_MINUTO) {
      tentativas.set(req.ip, lista);
      return next(erro(429, 'muitas_tentativas', 'Muitas tentativas. Espere um minuto e tente de novo.'));
    }
    lista.push(agora);
    tentativas.set(req.ip, lista);
    next();
  }

  return { emitirCookieAdmin, ehAdmin, exigirAdmin, exigirSetup, limitarLogin };
}
