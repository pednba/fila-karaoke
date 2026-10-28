// Ranking final por e-mail (SPEC 9.1): quem pediu recebe ao encerrar a festa, e o endereço é apagado depois.
import nodemailer from 'nodemailer';
import { erro } from './erros.js';
import { escrever } from './db.js';
import { lerFesta } from './festa.js';
import { ranking } from './operacao.js';
import { formatarNota } from './votos.js';
import { PRESETS, PRESET_PADRAO, FONTE_BASE } from './temas.js';

const TOPO = 10;

export function validarEmail(email) {
  const e = String(email ?? '').trim();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw erro(422, 'email_invalido', 'Confira o e-mail digitado.');
  return e;
}

// Transporte SMTP a partir do .env; null quando o envio não está configurado.
export function transporteSmtp({ host, port, user, pass }) {
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } });
}

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const ICONES = { coracao: '♥', estrela: '★', sol: '☀', nota: '♪' };

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// HTML no visual da tela de festa encerrada (SPEC 12), com as cores e a fonte do tema.
// Tudo em tabelas e estilos inline, que é o que os programas de e-mail respeitam. As fontes vêm
// do próprio servidor; onde o programa não carrega (Gmail), cai numa fonte do sistema.
function htmlRanking({ festa, link, nome, destaque, pessoas, performances, vazio, rodape, rodapeExtra }) {
  const base = PRESETS[PRESET_PADRAO];
  const t = { ...base.tokens, ...festa.tema?.tokens };
  const origem = new URL(link).origin;
  const fonteDestaque = `'${festa.tema?.fonte || base.fonte}', Georgia, 'Times New Roman', serif`;
  const fonteBase = `'${FONTE_BASE}', Helvetica, Arial, sans-serif`;
  const icone = ICONES[festa.tema?.icone] ?? ICONES.coracao;
  const linhaFilete = `<td width="50%" style="border-bottom: 1px solid ${t.decor}; font-size: 0; line-height: 0;">&nbsp;</td>`;
  const filete = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 6px 0 4px;"><tr>${linhaFilete}`
    + `<td style="padding: 0 10px; font-size: 12px; color: ${t.texto}; white-space: nowrap;">${icone}</td>${linhaFilete}</tr></table>`;

  const item = (i, titulo, sub, valor, legenda) => {
    const topo = i === 0;
    const cor = topo ? t['texto-palco'] : t.texto;
    const corSub = topo ? t['texto-palco-2'] : t['texto-2'];
    const corValor = topo ? t['destaque-palco'] : t.texto;
    const pos = topo
      ? `background: ${t['destaque-palco']}; color: ${t.palco}; border: 1px solid ${t['destaque-palco']};`
      : `color: ${t.texto}; border: 1px solid ${t.decor};`;
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 10px; border-collapse: separate; border-radius: 16px; background: ${topo ? t.palco : t.superficie}; border: 1px solid ${topo ? t.decor : t.borda};"><tr>
<td width="32" style="padding: 14px 0 14px 14px; vertical-align: middle;"><div style="width: 32px; height: 32px; line-height: 32px; border-radius: 16px; text-align: center; font-size: 14px; font-weight: 700; ${pos}">${i + 1}</div></td>
<td style="padding: 14px 12px; vertical-align: middle;"><div style="font-family: ${fonteDestaque}; font-size: 28px; line-height: 1.1; color: ${cor};">${escHtml(titulo)}</div><div style="font-size: 12px; color: ${corSub}; padding-top: 2px;">${escHtml(sub)}</div></td>
<td align="right" style="padding: 14px 14px 14px 0; vertical-align: middle; white-space: nowrap;"><div style="font-size: 30px; font-weight: 700; line-height: 1; color: ${corValor};">${escHtml(valor)}</div><div style="font-size: 12px; color: ${corSub};">${escHtml(legenda)}</div></td>
</tr></table>`;
  };

  const secao = (titulo, legenda, itens) => `
<div style="text-align: center; padding: 28px 0 12px;">
  <div style="font-size: 11px; font-weight: 600; letter-spacing: 0.24em; text-transform: uppercase; color: ${t.texto};">Nota da festa</div>
  <div style="font-family: ${fonteDestaque}; font-size: 44px; line-height: 1.1; color: ${t.texto};">${titulo}</div>
  ${filete}
  <div style="font-size: 12px; color: ${t['texto-2']}; padding-top: 4px;">${legenda}</div>
</div>
${itens.length ? itens.join('\n') : `<p style="font-family: ${fonteDestaque}; font-size: 26px; text-align: center; color: ${t.texto}; margin: 12px 0;">${vazio}</p>`}`;

  const r = festa.regras ?? {};
  const secoes = [
    pessoas ? secao('Pessoas', `Média das notas de cada pessoa${r.minimo_performances ? ` · mínimo de ${plural(r.minimo_performances, 'performance', 'performances')}` : ''}`,
      pessoas.slice(0, TOPO).map((p, i) => item(i, p.nome,
        [p.n_performances ? plural(p.n_performances, 'performance', 'performances') : null, p.melhor != null ? `melhor: ${formatarNota(p.melhor)}` : null].filter(Boolean).join(' · '),
        formatarNota(p.media), 'média'))) : '',
    secao('Performances', `Mediana dos votos de 0 a 10${r.minimo_votos ? ` · mínimo de ${plural(r.minimo_votos, 'voto', 'votos')}` : ''}`,
      performances.slice(0, TOPO).map((p, i) => item(i, p.cantor, `${p.titulo} · ${p.artista}`, formatarNota(p.nota),
        p.n_votos ? plural(p.n_votos, 'voto', 'votos') : 'nota'))),
  ].join('\n');

  const arte = festa.arte_arquivo
    ? `<img src="${escHtml(`${origem}/api/festa/arte`)}" alt="" width="512" style="display: block; width: 100%; max-width: 512px; height: auto; border: 0; border-radius: 12px; margin: 0 auto 8px;">` : '';
  const pe = (texto) => `<p style="font-size: 12px; line-height: 1.5; color: ${t['texto-2']}; text-align: center; margin: 8px 0 0;">${escHtml(texto)}</p>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
@font-face { font-family: '${FONTE_BASE}'; src: url(${origem}/fontes/montserrat-latin.woff2) format('woff2'); font-weight: 400 700; }
${festa.tema?.fonte || base.fonte ? `@font-face { font-family: '${festa.tema?.fonte || base.fonte}'; src: url(${origem}/fontes/${(festa.tema?.fonte || base.fonte).toLowerCase().replace(/ /g, '-')}-latin.woff2) format('woff2'); }` : ''}
</style></head>
<body style="margin: 0; padding: 0; background: ${t.fundo};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: ${t.fundo};"><tr><td align="center" style="padding: 24px 16px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px; font-family: ${fonteBase}; font-size: 15px; line-height: 1.35; color: ${t.texto};"><tr><td>
${arte}
<div style="text-align: center; padding-top: 8px;">
  <div style="font-family: ${fonteDestaque}; font-size: 56px; line-height: 1.1; color: ${t.texto};">Obrigado!</div>
  <p style="font-size: 14px; color: ${t['texto-2']}; margin: 8px 0 0;">Oi, ${escHtml(nome)}! A festa <strong style="color: ${t.texto};">${escHtml(festa.titulo || festa.nome_destaque)}</strong> terminou. Aqui está o ranking final.</p>
</div>
${destaque ? `<div style="margin-top: 18px; padding: 16px; border-radius: 16px; background: ${t.palco}; color: ${t['texto-palco']}; text-align: center; font-size: 15px;"><strong style="color: ${t['destaque-palco']};">${escHtml(destaque)}</strong></div>` : ''}
${secoes}
<div style="text-align: center; padding: 22px 0 8px;">
  <a href="${escHtml(link)}" style="display: inline-block; padding: 14px 22px; border-radius: 12px; border: 1px solid ${t.decor}; background: ${t.texto}; color: ${t.fundo}; font-size: 13px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none;">Ver o ranking completo</a>
</div>
${pe(rodape)}
${rodapeExtra ? pe(rodapeExtra) : ''}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

// Função pura: monta assunto, texto e HTML para uma pessoa.
export function montarEmailRanking({ festa, link, nome, pessoas, performances, rodapeExtra = '' }) {
  const titulo = festa.titulo || festa.nome_destaque;
  const minha = pessoas?.find((p) => p.nome === nome);
  const linhasPessoas = (pessoas ?? []).slice(0, TOPO).map((p, i) => `${i + 1}. ${p.nome} · média ${formatarNota(p.media)}`);
  const linhasPerformances = performances.slice(0, TOPO).map((p, i) => `${i + 1}. ${p.cantor} · ${p.titulo} (${p.artista}) · nota ${formatarNota(p.nota)}`);
  const destaque = minha ? `Você ficou em ${pessoas.indexOf(minha) + 1}º lugar, com média ${formatarNota(minha.media)}.` : null;
  const secoes = [
    pessoas ? ['Pessoas', linhasPessoas] : null,
    ['Performances', linhasPerformances],
  ].filter(Boolean);
  const vazio = 'Nenhuma votação fechada.';
  const rodape = 'Você recebeu este e-mail porque pediu o ranking na festa. Seu endereço foi apagado depois do envio.';

  const texto = [
    `Oi, ${nome}!`,
    `A festa ${titulo} terminou. Aqui está o ranking final.`,
    destaque,
    ...secoes.map(([nomeSecao, linhas]) => `${nomeSecao}\n${linhas.length ? linhas.join('\n') : vazio}`),
    `Ranking completo: ${link}`,
    rodape,
    rodapeExtra,
  ].filter(Boolean).join('\n\n');

  const html = htmlRanking({ festa, link, nome, destaque, pessoas, performances, vazio, rodape, rodapeExtra });

  return { assunto: `Ranking final · ${titulo}`, texto, html };
}

// Envia para todo mundo que deixou e-mail e ainda não recebeu. Falha de um não para os outros;
// o e-mail de quem falhou fica guardado para a próxima tentativa (ao reiniciar o app).
export function criarEnvioRanking({ db, transporte, de, link, rodapeExtra }) {
  let rodando = null;

  async function enviar() {
    const festa = lerFesta(db);
    if (festa.status !== 'encerrada' || !festa.regras.votacao) return { enviados: 0, falhas: 0 };
    const pendentes = db.prepare('SELECT id, nome, email FROM pessoas WHERE email IS NOT NULL').all();
    if (!pendentes.length) return { enviados: 0, falhas: 0 };
    const pessoas = festa.regras.ranking_pessoas ? ranking(db, 'pessoas') : null;
    const performances = ranking(db, 'performances');
    let enviados = 0;
    let falhas = 0;
    for (const p of pendentes) {
      const { assunto, texto, html } = montarEmailRanking({ festa, link, nome: p.nome, pessoas, performances, rodapeExtra });
      try {
        await transporte.sendMail({ from: de, to: p.email, subject: assunto, text: texto, html });
        escrever(db, () => db.prepare('UPDATE pessoas SET email = NULL WHERE id = ?').run(p.id));
        enviados++;
      } catch (e) {
        falhas++;
        console.error(`Falha ao enviar o ranking para a pessoa ${p.id}: ${e.message}`);
      }
    }
    return { enviados, falhas };
  }

  return {
    ativo: Boolean(transporte),
    // Um envio por vez: chamadas durante um envio esperam o mesmo resultado.
    enviarRankings() {
      if (!transporte) return Promise.resolve({ enviados: 0, falhas: 0 });
      rodando ??= enviar().finally(() => { rodando = null; });
      return rodando;
    },
  };
}
