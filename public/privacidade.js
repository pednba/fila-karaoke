// Página de privacidade (SPEC 7.1): o texto é fixo; título, ícone e contato vêm da festa.
import { $, esc, api, filete, definirIcone } from './comum.js';

try {
  const festa = await api('GET', '/api/festa');
  definirIcone(festa.tema?.icone);
  if (festa.titulo) {
    $('#titulo-festa').textContent = festa.titulo;
    document.title = `Privacidade · ${festa.titulo}`;
  }
  if (festa.contato) {
    $('#responsavel').innerHTML = `Quem organiza a festa: <strong>${esc(festa.contato)}</strong>. Para pedir que seus dados sejam corrigidos ou apagados, é só falar por esse contato.`;
  }
} catch {
  // Sem a festa, a página continua legível com o texto genérico.
}
$('#filete').outerHTML = filete();
