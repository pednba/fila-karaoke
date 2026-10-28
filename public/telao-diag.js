// Telão (SPEC 12): navegador de TV antigo demais para o telao.js. Sem módulo e só com JavaScript antigo
// (var, function), para rodar em qualquer navegador e dizer o que aconteceu em vez de ficar em "Carregando…".
(function () {
  function avisar() {
    if (window.telaoCarregou) return;
    var app = document.getElementById('app');
    if (!app) return;
    var ua = String(navigator.userAgent).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    app.innerHTML =
      '<div style="margin: auto; max-width: 90%; text-align: center; font-family: sans-serif;">' +
      '<p style="font-size: 40px; font-weight: bold; margin: 0 0 16px;">Este navegador não consegue abrir o telão.</p>' +
      '<p style="font-size: 24px; margin: 0 0 24px;">Use um notebook no HDMI com o Chrome, ou outro aparelho com navegador atualizado.</p>' +
      '<p style="font-size: 18px; opacity: 0.7; margin: 0; word-wrap: break-word;">Navegador: ' + ua + '</p>' +
      '</div>';
  }
  var semModulos = !('noModule' in document.createElement('script'));
  if (semModulos) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avisar);
    else avisar();
  } else {
    setTimeout(avisar, 10000);
  }
})();
