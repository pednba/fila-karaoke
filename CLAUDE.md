# Fila Karaokê

App web genérico de fila de karaokê para festas. A fonte da verdade é `SPEC.md`: leia inteira antes de escrever código e não invente regra que não esteja lá. Se algo estiver ambíguo, pergunte.

## Stack fixa
Node 20, Express, better-sqlite3, HTML/CSS/JS puro em `public/` (sem bundler nem framework de front), Caddy na frente (ou nginx, quando a máquina já usa as portas 80/443; ver `deploy/`), pm2 ou systemd. Dependências permitidas: express, better-sqlite3, cookie-parser, dotenv, multer, qrcode, sharp (redimensionar a arte). Testes com `node:test`.

## Ordem de construção
1. `db.js` com o schema da seção 6.
2. `fila.js` e `votos.js` como funções puras, com os testes da seção 14 passando.
3. Importadores (seção 5): porte `importadores/pdf_lista_aparelho.py` para `importadores/pdf-lista-aparelho.js` mantendo o mesmo comportamento; CSV; testes com fixtures.
4. Setup (seção 4) e rotas `/api/setup/*`, protegidas por `SETUP_TOKEN` antes do PIN.
5. Rotas públicas e de operação (seção 10), cada escrita numa transação que incrementa `meta.versao`.
6. Front: `public/setup.html`, `public/admin.html`, `public/index.html`, com tokens de tema da seção 11. `docs/design/` é a referência visual aprovada (tema Dourado clássico): reaproveite estrutura e CSS, descarte a sintaxe `{{ }}`, `<sc-if>` e `<sc-for>`.

## Regras que não podem quebrar
- Nada de dados de uma festa específica no código: nomes, datas, cores e textos vêm de `festa`.
- No máximo um pedido `na_vez`, e ele nunca muda por recálculo.
- A parcial da votação nunca sai na API enquanto a votação está aberta.
- Ações de convidado validam o dono pelo cookie `kid`; ações de admin exigem o cookie `adm`; setup sem PIN exige `X-Setup-Token`.
- Nunca importar a primeira linha do PDF (contato da locadora) nem commitar arquivos de `data/`.
- Textos da interface em português do Brasil.

## Comandos
`npm start` · `npm run dev` · `npm test`
