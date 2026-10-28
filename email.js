// Ranking final por e-mail (SPEC 9.1): quem pediu recebe ao encerrar a festa, e o endereço é apagado depois.
import nodemailer from 'nodemailer';
import { erro } from './erros.js';
import { escrever } from './db.js';
import { lerFesta } from './festa.js';
import { ranking } from './operacao.js';
import { formatarNota } from './votos.js';

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

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

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

  const html = `<div style="font-family: sans-serif; line-height: 1.5; max-width: 560px;">
<p>Oi, ${escHtml(nome)}!</p>
<p>A festa <strong>${escHtml(titulo)}</strong> terminou. Aqui está o ranking final.</p>
${destaque ? `<p><strong>${escHtml(destaque)}</strong></p>` : ''}
${secoes.map(([nomeSecao, linhas]) => `<h3>${nomeSecao}</h3>${linhas.length ? `<ol>${linhas.map((l) => `<li>${escHtml(l.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>` : `<p>${vazio}</p>`}`).join('\n')}
<p><a href="${escHtml(link)}">Ver o ranking completo</a></p>
<p style="font-size: 12px; color: #777;">${rodape}</p>
${rodapeExtra ? `<p style="font-size: 12px; color: #777;">${escHtml(rodapeExtra)}</p>` : ''}
</div>`;

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
