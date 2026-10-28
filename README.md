# Fila Karaokê

Fila de karaokê para festas, com votação e ranking.

Você aluga (ou tem) um aparelho de karaokê que toca músicas por código. Os convidados escaneiam um QR code, buscam no catálogo do aparelho, pedem músicas e entram numa fila justa. Cada performance recebe uma nota da festa, e no fim sai o ranking. Quem organiza controla tudo por um painel de admin. Opcionalmente, o código da vez é "digitado" sozinho na máquina por infravermelho.

- **Uma festa por instalação.** Ao terminar, arquiva e começa outra.
- **Sem conta e sem app:** o convidado entra só com o nome, pelo navegador do celular.
- **Genérico:** nome, data, arte, cores e regras vêm do setup. Nada de uma festa específica fica no código.

A fonte da verdade é a [`SPEC.md`](SPEC.md). Este README resume o que existe e como as peças se encaixam.

## Sumário

- [Funcionalidades](#funcionalidades)
- [Como funciona](#como-funciona)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Instalação](#instalação)
- [Primeira festa](#primeira-festa)
- [Catálogo](#catálogo)
- [Máquina de karaokê (opcional)](#máquina-de-karaokê-opcional)
- [Desenvolvimento](#desenvolvimento)
- [Em evolução](#em-evolução)

## Funcionalidades

### Para o convidado (`/`)

| Recurso | Detalhe | SPEC |
|---|---|---|
| Entrada | Só com o nome, único na festa; identidade por cookie no aparelho | 7 |
| Catálogo | Busca por título, artista, trecho da letra ou código, tolerante a grafias ("Fábio Jr." = "Fabio Júnior"). Filtro Nacionais/Internacionais e rolagem infinita | 5.4 |
| Navegar por artista | Lista A–Z com o total de músicas de cada artista; duplas e participações contam para cada um | 5.5 |
| Você pode gostar | Sugere uma música de um artista que a pessoa já cantou | 5.6 |
| Filtro por gênero | Opcional: chips de gênero musical na busca, quando quem organiza classificou o catálogo e ligou o filtro | 5.7 |
| Pedidos | Limite de pedidos pendentes por pessoa, posição e espera estimada, cancelar | 8.4 |
| Fila | "Agora no palco" com o código grande e os próximos 10 | 12 |
| Cantou? | O cantor confirma. Depois de 2 minutos, quem está na fila (menos o próximo) também pode: "Fulano já terminou?" | 8.4 |
| Nota da festa | Voto de 0 a 10 em cada performance; a nota é a mediana. A parcial fica escondida enquanto a votação está aberta | 9 |
| Ranking | De performances e de pessoas, com mínimos configuráveis | 9 |
| Prêmio por Pix | Opcional: com a chave Pix de quem organiza, a aba Ranking convida a contribuir para o prêmio de quem ganhar. O app não confere pagamentos | 9.2 |
| Ranking por e-mail | Opcional, com SMTP: quem deixar o e-mail recebe o ranking final, e o endereço é apagado depois | 9.1 |
| Privacidade | Aviso de cookie na entrada e página `/privacidade`. Só cookies essenciais, nada de terceiros no navegador (as fontes saem do próprio servidor), por isso sem banner de consentimento | 7.1 |

### Para quem organiza (`/admin`)

| Recurso | Detalhe | SPEC |
|---|---|---|
| Setup em 6 passos | PIN, dados da festa, visual (arte, tema, fonte), catálogo, regras, publicar. Salva a cada passo | 4 |
| Temas | 4 presets (Dourado clássico, Noite neon, Tropical, Minimalista) e cor de destaque com checagem de contraste | 11 |
| QR code e cartaz | PNG, SVG e cartaz A4 para imprimir | 4.2 |
| Operação | Cantou, Pular ausente, mover ↑/↓, bypass da regra de duas seguidas, VIP, pedido para quem está sem celular | 8.4 |
| Ciclo de vida | Rascunho → aberta → encerrada (ranking final) → arquivada (backup do banco e festa nova) | 4.3 |
| Máquina | Estado da conexão e "Reenviar código", quando a integração está ligada | 10.5 |

### Regras da fila em uma frase

**Quem cantou menos vai antes, e ninguém canta duas vezes seguidas.** Há três exceções: a ordem manual do admin prevalece, o bypass libera duas seguidas e o VIP conta como quem ainda não cantou. A música no palco nunca muda por recálculo. Detalhes e casos de borda na SPEC 8.

## Como funciona

```
celulares dos convidados ─┐
                          ├── HTTPS ──► Caddy/nginx ──► Node + Express ──► SQLite (data/)
painel do admin ──────────┘                               ▲
                                                          │ consulta o código da vez (opcional)
       máquina de karaokê ◄── IR ── emissor Wi-Fi ◄── celular ao lado da máquina (integracoes/)
```

- **Servidor:** Node 20+, Express 5, `better-sqlite3`. Um processo, um arquivo de banco.
- **Tempo real por polling:** as telas consultam `/api/estado` a cada 4 s com `ETag`. Sem mudança, a resposta é `304`, e o polling pausa com a aba escondida. Cada escrita roda numa transação que incrementa `meta.versao` (`escrever` em `db.js`).
- **Front sem build:** HTML, CSS e JS puros em `public/`, com o tema aplicado por variáveis CSS (`/tema.css`).
- **Regras puras e testadas:** a ordem da fila (`fila.js`) e a votação (`votos.js`) não tocam no banco. `operacao.js` lê o estado, aplica a decisão e grava.
- **Acesso:**
  - convidado pelo cookie `kid`;
  - admin pelo cookie `adm`, assinado e ligado ao PIN;
  - setup inicial pelo cabeçalho `X-Setup-Token`, só enquanto não existe PIN;
  - script da máquina pelo cabeçalho `X-Maquina-Token`.

## Estrutura do repositório

```
server.js               lê o .env e sobe a porta
app.js                  monta o Express (rotas, estáticos, tema)
db.js                   schema, migrações e escrever() (transação + versão)
fila.js                 ordem da fila e regras de pedido (puro)
votos.js                mediana, votações e rankings (puro)
operacao.js             ações da fila e da votação sobre o banco
festa.js                dados da festa, regras, dimensionamento, arquivar
auth.js                 PIN, cookie do admin, SETUP_TOKEN
catalogo.js             gravação do catálogo importado
artistas.js             navegação por artista e "Você pode gostar"
generos.js              gênero musical por artista: classificação pelo Claude, resumo e filtro
texto.js                normalização de texto (busca e nomes)
temas.js                presets, contraste e CSS do tema
cartaz.js               cartaz A4 com arte e QR
email.js                ranking final por e-mail (SMTP opcional)
maquina.js              comando da vez para o script da máquina
erros.js                formato de erro da API
rotas/
  publico.js            convidado: entrada, estado, catálogo, pedidos, votos, ranking
  admin.js              operação do admin
  setup.js              assistente de setup
  festa.js              abrir, encerrar, arquivar e arte
importadores/
  index.js              escolhe o importador e monta a prévia
  pdf-lista-aparelho.js PDF de lista de aparelho (porte do .py)
  pdf_lista_aparelho.py implementação de referência em Python
  csv.js                CSV com , ou ;
public/
  index.html, convidado.js   tela do convidado
  admin.html, admin.js       painel do admin
  setup.html, setup.js       assistente de setup
  privacidade.html, .js      página de privacidade
  comum.js, estilo.css       utilitários e estilos comuns
  fontes/                    fontes woff2 servidas pelo app (licença OFL)
integracoes/            script opcional da máquina de karaokê (Python)
deploy/                 modelos de nginx e systemd
docs/design/            referência visual aprovada (tema Dourado clássico)
test/                   testes node:test e fixtures
data/                   banco, uploads e catálogos (fora do Git)
```

## Instalação

### Requisitos

- Um servidor com Node 20+ acessível pela internet (testado em EC2 com Ubuntu 22.04/24.04).
- `poppler-utils`, para importar PDF: `sudo apt install poppler-utils`.
- Um domínio ou subdomínio apontando para o servidor. O HTTPS é necessário para o cookie seguro.
- Caddy (recomendado) ou outro proxy com TLS. Se a máquina já usa nginx nas portas 80/443, veja abaixo.

### Passo a passo

```bash
git clone https://github.com/pednba/fila-karaoke.git
cd fila-karaoke
npm install
cp .env.example .env      # preencha PUBLIC_URL, SETUP_TOKEN e COOKIE_SECRET
npm start                 # ou: pm2 start server.js --name karaoke
```

Para gerar segredos: `openssl rand -hex 24`.

| Variável | Obrigatória | Para quê |
|---|---|---|
| `PUBLIC_URL` | sim | endereço público da festa (vai no QR code) |
| `SETUP_TOKEN` | sim | protege o primeiro acesso ao `/admin`, antes de existir PIN |
| `COOKIE_SECRET` | sim | assina o cookie do admin |
| `PORT`, `HOST`, `DATA_DIR` | não | padrões: `3000`, `127.0.0.1`, `./data` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | não | ranking final por e-mail (SPEC 9.1) |
| `MAQUINA_TOKEN` | não | integração com a máquina de karaokê (SPEC 10.5) |

`Caddyfile`:

```
karaoke.seudominio.com.br {
  encode gzip
  reverse_proxy localhost:3000
}
```

O app escuta só em `127.0.0.1`, então o proxy é o único caminho até ele. Para testar de outro aparelho na rede local, use `HOST=0.0.0.0`.

### Máquina que já usa nginx

Use `deploy/nginx.conf.example` no lugar do `Caddyfile` e emita o certificado com `sudo certbot --nginx -d <seu domínio>`. O `client_max_body_size` do modelo libera o upload do catálogo em PDF; sem ele, o nginx recusa arquivos acima de 1 MB.

Para manter o app no ar sem pm2, há um serviço systemd em `deploy/fila-karaoke.service.example`.

### Backup no dia

```bash
# crontab -e
*/10 * * * * sqlite3 /caminho/fila-karaoke/data/karaoke.db ".backup /caminho/backup/karaoke-$(date +\%H\%M).db"
```

## Primeira festa

1. Abra `https://<seu domínio>/admin` e informe o `SETUP_TOKEN` do `.env`.
2. Siga o setup: PIN do admin, dados da festa, visual, catálogo e regras.
3. Baixe o QR code ou o cartaz e clique em **Abrir festa**.
4. Faça um teste com algumas pessoas em celulares reais antes do dia.
5. No fim, **Encerrar** mostra o ranking final. **Arquivar** guarda uma cópia do banco em `data/arquivo/` e libera para a próxima festa.

As regras padrão podem ser mudadas no setup:
- 3 pedidos pendentes por pessoa;
- 5 min por música (usado nas estimativas);
- 2 pulos até sair da fila;
- votação ligada, com mínimo de 3 votos;
- ranking de pessoas com mínimo de 2 performances;
- VIP disponível.

## Catálogo

- **PDF de lista de aparelho:** colunas Intérprete, Cod, Título, Início da letra, Idioma. O PDF precisa ter texto selecionável; foto escaneada não serve. A primeira linha (contato da locadora) nunca é importada. Detalhes na SPEC 5.2.
- **CSV:** `cod,titulo,artista,idioma,inicio` em UTF-8, separado por `,` ou `;`. Exemplo em `data/catalogos/exemplo.csv`.

O setup mostra uma prévia antes de gravar: total de músicas, quantas por idioma, linhas ignoradas e códigos duplicados.

O catálogo do seu aparelho fica só no seu servidor, porque `data/` está no `.gitignore`. Não publique listas de terceiros no repositório.

Para testar um PDF fora do app:

```bash
pdftotext -layout lista.pdf lista.txt
python3 importadores/pdf_lista_aparelho.py lista.txt catalogo.json
```

### Gênero musical (opcional)

As listas de aparelho não trazem gênero. No passo 4 do setup, quem organiza pode colar uma chave de API da Anthropic para o Claude classificar os artistas (cerca de US$ 1 a cada mil artistas, na conta de quem cola a chave). A chave não é gravada em lugar nenhum. O setup mostra a cobertura e a precisão estimada antes de ligar o filtro para os convidados. Detalhes na SPEC 5.7.

Uma classificação feita fora do app entra por CSV `artista;genero;confianca`, rodado no servidor com o mesmo `DATA_DIR` do app:

```bash
node scripts/importar-generos.js generos.csv
```

## Máquina de karaokê (opcional)

Quando alguém vira a vez, um script num celular Android (Termux) ao lado da máquina pega o código da música no app. Ele "digita" esse código por infravermelho, usando um emissor Wi-Fi: **Broadlink** ou **controle universal Tuya / Smart Life**.

- **Só o código da vez:** a máquina recebe apenas a música da vez, nunca a fila.
- **Só conexões de saída:** o script consulta `GET /api/maquina/comando`, então não precisa de porta aberta nem de VPN.
- **Acompanhamento no admin:** mostra "Máquina conectada · código enviado" e tem o botão "Reenviar código".
- **Plano B:** o código da vez aparece grande no admin, para alguém digitar no controle.

Instalação, configuração e aprendizado das teclas: [`integracoes/README.md`](integracoes/README.md). Regra: SPEC 10.5.

## Desenvolvimento

```bash
npm run dev     # reinicia ao salvar
npm test        # node:test
```

- **SPEC antes do código:** a [`SPEC.md`](SPEC.md) é a fonte da verdade. Regra nova entra lá antes de entrar no código. As decisões tomadas estão na seção 15.
- **Instruções para agentes:** o [`CLAUDE.md`](CLAUDE.md) tem a stack fixa, as dependências permitidas e as regras que não podem quebrar.
- **Visual:** a referência é `docs/design/`. O CSS final está em `public/estilo.css`, com o tema em variáveis.
- **Banco:** as migrações ficam em `db.js`. Nunca edite uma migração publicada; acrescente uma nova no fim.
- **Importador de PDF:** o `.js` é porte do `.py`. Altere os dois juntos.
- **Testes:** cobrem fila, votos, importadores, setup, operação, temas, e-mail, máquina e partes do front.
- **Textos:** a interface é toda em português do Brasil.

## Em evolução

Pontos conhecidos e ideias em aberto. O que estiver fora da SPEC precisa de decisão antes de virar código.

- **Máquina por infravermelho:**
  - Falta validar com máquinas reais: se o código + "reservar" começa a música e o que acontece com uma música tocando (entra como a próxima ou interrompe a atual).
  - O emissor Tuya exige a chave local do aparelho, obtida pela plataforma de desenvolvedor da Tuya. Ainda não há um caminho mais simples.
- **"Pular ausente" com a máquina:** a música do ausente já foi enviada e pode estar tocando. Hoje o app não manda "parar". Decidir se o Pular deve enviar essa tecla.
- **Gênero musical:** a classificação é por artista principal, não por música. Artista que muda de gênero fica com o gênero pelo qual é mais conhecido, e a precisão mostrada é uma estimativa a partir da confiança declarada pelo modelo.
- **Artistas com hífen sem espaço** ("Fulano-Ciclano") não são separados em participantes, para não quebrar nomes como A-ha e Jay-Z.
- **Truncamento do PDF:** artistas longos ("...") e títulos com mais de ~30 caracteres vêm cortados na lista do aparelho. Não há como recuperar.
- **Identidade por cookie:** limpar o cookie ou usar aba anônima cria outra pessoa, com outro voto e outra cota de pedidos. É um risco aceito.
- **Fora da v1** (SPEC 2):
  - várias festas simultâneas;
  - contas de usuário;
  - duetos;
  - modo telão;
  - renomear ou mesclar pessoas;
  - pedido fora do catálogo;
  - WebSocket/SSE;
  - extração automática de cores da arte.

## Licença

MIT. Ver [`LICENSE`](LICENSE).
