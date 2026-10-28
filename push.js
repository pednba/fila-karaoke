// Avisos por notificação (SPEC 9.3): Web Push padrão com node:crypto.
// Conteúdo cifrado pela RFC 8291 (aes128gcm) e identificação do servidor pela RFC 8292 (VAPID).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { erro } from './erros.js';
import { lerFesta } from './festa.js';
import { pedidoNaVez, filaOrdenada } from './operacao.js';

export const VALIDADE_AVISO_MIN = 15;
export const TEXTO_AVISO_MAX = 200;
const TAMANHO_REGISTRO = 4096;
const VALIDADE_JWT_S = 12 * 60 * 60;

// Só os serviços de push dos navegadores conhecidos: o servidor nunca faz POST para endereço qualquer.
const SERVICOS = [
  /^fcm\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const hkdf = (ikm, sal, info, tamanho) => Buffer.from(crypto.hkdfSync('sha256', ikm, sal, info, tamanho));

export function endpointValido(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.port && SERVICOS.some((r) => r.test(url.hostname));
}

// Valida o corpo de PushSubscription.toJSON().
export function validarInscricao(corpo) {
  const { endpoint, keys } = corpo ?? {};
  const chave = (v, bytes) => typeof v === 'string' && /^[A-Za-z0-9_-]+=*$/.test(v) && Buffer.from(v, 'base64url').length === bytes;
  if (!endpointValido(endpoint) || !chave(keys?.p256dh, 65) || !chave(keys?.auth, 16)) {
    throw erro(422, 'inscricao_invalida', 'Não deu para ativar os avisos neste navegador.');
  }
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

// Chaves VAPID: geradas uma vez e guardadas em data/vapid.json (fora do Git).
export function carregarChaves(dataDir) {
  const arquivo = path.join(dataDir, 'vapid.json');
  let jwk;
  if (fs.existsSync(arquivo)) {
    jwk = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } else {
    jwk = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(arquivo, JSON.stringify(jwk), { mode: 0o600 });
  }
  const publica = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  return { privada: crypto.createPrivateKey({ key: jwk, format: 'jwk' }), publica: b64(publica) };
}

export function cabecalhoVapid(endpoint, chaves, sub, agora = Date.now()) {
  const cabecalho = b64(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const corpo = b64(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(agora / 1000) + VALIDADE_JWT_S, sub }));
  const assinatura = crypto.sign('sha256', Buffer.from(`${cabecalho}.${corpo}`), { key: chaves.privada, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${cabecalho}.${corpo}.${b64(assinatura)}, k=${chaves.publica}`;
}

// RFC 8291: um único registro, terminado em 0x02.
export function cifrar(texto, { p256dh, auth }, { sal = crypto.randomBytes(16) } = {}) {
  const chaveDele = Buffer.from(p256dh, 'base64url');
  const local = crypto.createECDH('prime256v1');
  local.generateKeys();
  const chaveMinha = local.getPublicKey();
  const ikm = hkdf(local.computeSecret(chaveDele), Buffer.from(auth, 'base64url'),
    Buffer.concat([Buffer.from('WebPush: info\0'), chaveDele, chaveMinha]), 32);
  const cek = hkdf(ikm, sal, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, sal, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cifra = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const conteudo = Buffer.concat([cifra.update(Buffer.concat([Buffer.from(texto), Buffer.from([2])])), cifra.final(), cifra.getAuthTag()]);
  const cabecalho = Buffer.alloc(21);
  sal.copy(cabecalho, 0);
  cabecalho.writeUInt32BE(TAMANHO_REGISTRO, 16);
  cabecalho[20] = chaveMinha.length;
  return Buffer.concat([cabecalho, chaveMinha, conteudo]);
}

export function validarTextoAviso(texto) {
  const limpo = String(texto ?? '').trim();
  if (!limpo) throw erro(422, 'texto_vazio', 'Escreva a mensagem.');
  if (limpo.length > TEXTO_AVISO_MAX) throw erro(422, 'texto_longo', `A mensagem pode ter até ${TEXTO_AVISO_MAX} caracteres.`);
  return limpo;
}

// Mensagem de quem organiza ainda dentro da janela de 15 minutos, ou null.
export function avisoVigente(db) {
  return db.prepare(`SELECT id, texto FROM avisos WHERE criado_em > datetime('now', '-${VALIDADE_AVISO_MIN} minutes') ORDER BY id DESC LIMIT 1`).get() ?? null;
}

// config: { publicUrl, dataDir, fetch? }. Sem https, o push fica desligado (os navegadores exigem).
export function criarPush({ db, config }) {
  const ativo = String(config.publicUrl ?? '').startsWith('https://');
  const chaves = ativo ? carregarChaves(config.dataDir) : null;
  const buscar = config.fetch ?? fetch;
  const sub = ativo ? new URL('/', config.publicUrl).href : null;
  let versaoVista = null;

  async function enviar(inscricao, dados, { ttl = 3600 } = {}) {
    try {
      const resposta = await buscar(inscricao.endpoint, {
        method: 'POST',
        headers: {
          Authorization: cabecalhoVapid(inscricao.endpoint, chaves, sub),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(ttl),
          Urgency: 'high',
        },
        body: cifrar(JSON.stringify(dados), inscricao),
        signal: AbortSignal.timeout(10_000),
      });
      if (resposta.status === 404 || resposta.status === 410) {
        db.prepare('DELETE FROM inscricoes_push WHERE endpoint = ?').run(inscricao.endpoint);
      } else if (!resposta.ok) {
        console.error(`Push recusado (${resposta.status}) por ${new URL(inscricao.endpoint).hostname}`);
      }
      return resposta.status;
    } catch (e) {
      console.error(`Push falhou: ${e.message}`);
      return null;
    }
  }

  const inscricoes = (pessoa_id) => pessoa_id
    ? db.prepare('SELECT endpoint, p256dh, auth FROM inscricoes_push WHERE pessoa_id = ?').all(pessoa_id)
    : db.prepare('SELECT endpoint, p256dh, auth FROM inscricoes_push').all();

  const titulo = () => {
    const festa = lerFesta(db);
    return festa.nome_destaque || festa.titulo || 'Karaokê';
  };

  return {
    ativo,
    chavePublica: chaves?.publica ?? null,

    // Chamado a cada poucos segundos: avisa o dono do primeiro da fila, uma vez por pedido.
    // A marca `avisado` não muda nada que as telas mostram, então não incrementa meta.versao.
    async verificarProxima() {
      if (!ativo) return [];
      const versao = db.prepare("SELECT valor FROM meta WHERE chave = 'versao'").pluck().get();
      if (versao === versaoVista) return [];
      versaoVista = versao;
      const festa = lerFesta(db);
      if (festa.status !== 'aberta' || !pedidoNaVez(db)) return [];
      const proximo = filaOrdenada(db, festa)[0];
      if (!proximo || proximo.avisado) return [];
      const lista = inscricoes(proximo.pessoa_id);
      if (!lista.length) return [];
      db.prepare('UPDATE pedidos SET avisado = 1 WHERE id = ?').run(proximo.id);
      const dados = { titulo: titulo(), corpo: `${proximo.cantor}, sua música “${proximo.titulo}” é a próxima!`, tag: `proxima-${proximo.id}` };
      return Promise.all(lista.map((i) => enviar(i, dados, { ttl: 600 })));
    },

    // Mensagem de quem organiza para todas as inscrições.
    enviarAviso(aviso) {
      if (!ativo) return Promise.resolve([]);
      const dados = { titulo: titulo(), corpo: aviso.texto, tag: `aviso-${aviso.id}` };
      return Promise.all(inscricoes().map((i) => enviar(i, dados, { ttl: VALIDADE_AVISO_MIN * 60 })));
    },
  };
}
