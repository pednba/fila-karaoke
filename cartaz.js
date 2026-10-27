// Cartaz A4 para imprimir: arte, título e QR code (SPEC 4.2, passo 6).
import { cssDoTema, urlFontes } from './temas.js';

export function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function renderizarCartaz({ festa, link, qrSvg }) {
  const { tema } = festa;
  const arte = festa.arte_arquivo ? `<img class="arte" src="/api/festa/arte" alt="">` : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cartaz · ${escapar(festa.titulo)}</title>
<link rel="stylesheet" href="${urlFontes(tema.fonte)}">
<style>
${cssDoTema(tema)}
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--fundo); color: var(--texto); font-family: var(--fonte-base); }
.folha { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 18mm 16mm; display: flex; flex-direction: column; align-items: center; gap: 8mm; text-align: center; }
.arte { max-width: 100%; max-height: 95mm; object-fit: contain; border-radius: 4mm; }
.rotulo { font-size: 11pt; font-weight: 600; letter-spacing: 0.2em; text-transform: uppercase; color: var(--texto-2); }
.nome { font-family: var(--fonte-destaque); font-size: 54pt; line-height: 1; margin: 0; }
.subtitulo { font-size: 14pt; font-weight: 700; letter-spacing: 0.04em; margin: 0; }
.filete { display: flex; align-items: center; gap: 4mm; width: 70%; }
.filete span { flex: 1; height: 1px; background: var(--decor); }
.filete i { width: 2.5mm; height: 2.5mm; border-radius: 50%; background: var(--decor); }
.qr { background: #fff; padding: 6mm; border-radius: 4mm; border: 1px solid var(--borda); }
.qr svg { display: block; width: 70mm; height: 70mm; }
.chamada { font-family: var(--fonte-destaque); font-size: 24pt; margin: 0; }
.link { font-size: 12pt; color: var(--texto-2); word-break: break-all; }
@media print { .folha { page-break-after: always; } }
</style>
</head>
<body>
<main class="folha">
  ${arte}
  <span class="rotulo">${escapar(festa.titulo)}</span>
  <h1 class="nome">${escapar(festa.nome_destaque)}</h1>
  ${festa.subtitulo ? `<p class="subtitulo">${escapar(festa.subtitulo)}</p>` : ''}
  <div class="filete" aria-hidden="true"><span></span><i></i><span></span></div>
  <p class="chamada">Escolha sua música e entre na fila!</p>
  <div class="qr">${qrSvg}</div>
  <span class="link">${escapar(link)}</span>
</main>
</body>
</html>`;
}
