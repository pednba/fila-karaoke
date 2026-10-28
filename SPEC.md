# Fila Karaokê: especificação v1

App web para organizar a fila de um karaokê em festas: convidados entram pelo celular via QR code, buscam no catálogo do aparelho, pedem músicas e votam nas performances. Quem organiza controla tudo por um painel de admin, que começa com um setup da festa.

Uma instalação atende **uma festa por vez**. Ao terminar, o admin arquiva a festa e começa outra. Multi-tenant (várias festas simultâneas no mesmo servidor) está fora do escopo.

## 1. Conceitos

- **Festa:** o evento configurado no setup (nome em destaque, data, convidados, arte, regras).
- **Catálogo:** a lista de músicas do aparelho de karaokê usado na festa, importada no setup. Cada música tem o código numérico que se digita no aparelho.
- **Pessoa:** um aparelho que entrou na festa com um nome (identidade por cookie).
- **Pedido:** uma música pedida por uma pessoa.
- **Performance:** um pedido que foi cantado; recebe a Nota da festa.

### Dimensionamento
O setup mostra a capacidade estimada da festa: `músicas = duração_em_min / minutos_por_música`. Com 4 h e 5 min por música dá ~48 músicas. Se `músicas < convidados`, o setup avisa que nem todos devem conseguir cantar duas vezes. A fila por rodadas existe para esse cenário.

## 2. Escopo

### Entra na v1
- **Setup da festa** no admin (seção 4).
- Busca no catálogo (título, artista, início da letra, código), filtro Nacionais/Internacionais.
- Cadastro só com nome, identidade por cookie no aparelho.
- Pedido de música com limite de pendentes por pessoa, cancelar o próprio pedido.
- Fila por rodadas com regra de "ninguém canta 2 seguidas".
- Destaque da música da vez + próximos 10.
- "Cantou?" para o cantor da vez; "Fulano já terminou?" para quem está na fila (menos o próximo) depois de 2 minutos (8.4).
- Admin: Cantou, Pular ausente, mudar ordem, bypass da regra, VIP (várias pessoas), adicionar pedido para quem não tem celular.
- Nota da festa: voto 0 a 10 por performance, mediana, ranking de performances e ranking de pessoas (cada um pode ser desligado no setup).
- Encerrar festa (ranking final em modo leitura) e arquivar para começar outra.

### Fora da v1
- Várias festas simultâneas, contas de usuário, duetos, modo telão, renomear/mesclar pessoas, pedido fora do catálogo, WebSocket/SSE, extração automática de cores da arte.

## 3. Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Servidor | Node 20 + Express | Front e back em JS |
| Banco | SQLite via `better-sqlite3` | Uma festa, um processo, backup é copiar um arquivo |
| Front | HTML + CSS + JS puro, sem build | Poucas telas |
| Tempo real | Polling a cada 4 s com versão (10.1) | ~50 clientes = ~12 req/s |
| Uploads | `multer` em disco (`data/uploads/`) | Arte da festa e arquivo do catálogo |
| QR code | `qrcode` (gera PNG/SVG no servidor) | Para imprimir |
| PDF do catálogo | `pdftotext` (pacote `poppler-utils`) chamado via `child_process` | Extrai o texto preservando colunas |
| Proxy/TLS | Caddy | HTTPS automático |
| Processo | pm2 ou systemd | Reinício automático |
| E-mail (opcional) | `nodemailer` via SMTP do `.env` | Ranking final por e-mail (9.1) |

Estrutura:

```
fila-karaoke/
  server.js
  db.js                 schema e migrações
  fila.js               algoritmo da fila (puro, testado)
  votos.js              mediana e rankings (puro, testado)
  importadores/
    index.js            escolhe o importador pelo tipo de arquivo
    csv.js
    pdf-lista-aparelho.js   porte em JS de pdf_lista_aparelho.py
    pdf_lista_aparelho.py   implementação de referência (Python)
  scripts/reset_festa.js, arquivar_festa.js
  public/               index.html, admin.html, setup.html, privacidade.html, app.css, *.js
    fontes/             fontes da interface (woff2) e licença OFL
  data/                 banco, uploads e catálogos (fora do git)
  test/
  docs/design/          referência visual
```

## 4. Setup da festa

### 4.1 Primeiro acesso
- Sem festa configurada, `/` mostra "Festa em preparação" e `/admin` abre o setup.
- **Proteção do primeiro acesso:** o setup exige o `SETUP_TOKEN` definido no `.env` (o servidor recusa subir sem ele). Sem isso, qualquer pessoa que abrisse a URL antes do dono viraria admin. Depois do setup, o acesso ao admin passa a ser pelo PIN criado no passo 1.

### 4.2 Passos do assistente (salvar a cada passo, pode voltar)

1. **Acesso:** PIN do admin (4 a 8 dígitos, confirmado duas vezes).
2. **Festa**
   - Nome em destaque (ex.: "Helena"): aparece na fonte de destaque.
   - Título (padrão: "Karaokê da {nome}"; editável, ex.: "Karaokê do Escritório").
   - Subtítulo opcional (ex.: "45 anos", "Formatura 2026").
   - Data e hora de início, duração em horas.
   - Local (opcional, texto livre).
   - Contato de quem organiza (opcional, texto livre até 120 caracteres: e-mail ou telefone). Aparece na página de privacidade (7.1).
   - Chave Pix de quem organiza (opcional, até 77 caracteres), para o prêmio de quem ganhar o ranking (9.2).
   - Número estimado de convidados.
3. **Visual**
   - Arte da festa: upload JPG/PNG/WebP até 5 MB (o convite, por exemplo). Aparece na tela de entrada dos convidados e no topo do ranking final. Redimensionar no servidor para no máximo 1200 px de largura.
   - Tema: escolher um preset (seção 11) e opcionalmente ajustar a cor de destaque. O app recusa combinações que não passam contraste 4.5:1 para texto.
   - Fonte de destaque: uma de uma lista curta (Great Vibes, Playfair Display, Pacifico, Bebas Neue).
   - Prévia ao vivo da tela de entrada do convidado e do cartão "Agora no palco".
4. **Catálogo**
   - Upload do arquivo do aparelho: PDF no formato "lista de músicas do aparelho" (seção 5.2) ou CSV (seção 5.3).
   - O servidor importa e mostra o resultado antes de confirmar: total de músicas, quantas por idioma, linhas ignoradas (com amostra), códigos duplicados. Se o PDF tiver um total no rodapé, comparar e avisar se não bater.
   - Pode reimportar a qualquer momento antes de abrir a festa. Depois de aberta, reimportar exige confirmação (pedidos de músicas que sumirem são cancelados).
   - Gênero musical (opcional, 5.7): classificar os artistas com uma chave de API da Anthropic, ver a precisão estimada e decidir se liga o filtro por gênero.
5. **Regras** (todas com padrão)

   | Regra | Padrão |
   |---|---|
   | Pedidos pendentes por pessoa | 3 |
   | Minutos por música (para estimativas) | 5 |
   | Pulos até sair da fila | 2 |
   | Votação ligada | sim |
   | Mínimo de votos para ter nota | 3 |
   | Ranking de pessoas ligado | sim |
   | Mínimo de performances no ranking de pessoas | 2 |
   | VIP disponível | sim |

   O passo mostra o dimensionamento (seção 1) com os números da festa.
6. **Publicar**
   - Resumo de tudo, link público e QR code (baixar PNG e SVG; versão para imprimir em A4 com a arte, o título e o QR).
   - Botão "Abrir festa": muda o status para `aberta` e libera a entrada dos convidados.

### 4.3 Ciclo de vida
`rascunho` → `aberta` → `encerrada` → (arquivar) → novo `rascunho`.
- `aberta`: tudo funcionando.
- `encerrada`: convidados veem só o ranking final e "Obrigado!"; pedidos e votos bloqueados.
- **Arquivar:** copia o banco para `data/arquivo/<data>-<slug>.db` e zera pessoas, pedidos, votos e a festa. O catálogo pode ser mantido para a próxima festa, com a classificação de gênero (5.7); o filtro de gênero volta desligado.
- Os dados da festa podem ser editados no admin a qualquer momento (menu "Festa"), exceto o PIN, que tem tela própria.

## 5. Catálogo

### 5.1 Tabela
Ver `musicas` na seção 6. A coluna `busca` guarda título + artista + início da letra + código, com a normalização da busca (5.4).

### 5.2 Importador PDF "lista de aparelho"
Formato comum em listas de aparelhos de karaokê alugados: PDF com camada de texto (não escaneado), colunas `Intérprete · Cod · Título · Início da letra · Idioma`, cabeçalho repetido em cada página e linha final "Total de musicas listadas N".

Algoritmo (referência: `importadores/pdf_lista_aparelho.py`, validado num catálogo real de 10.927 músicas, com 100% das linhas reconhecidas):
1. `pdftotext -layout arquivo.pdf -`.
2. Ignorar linhas de cabeçalho (contêm `APARELHO`, `AUDIOVISUAL`, `DE KARAOKE`, `LISTA DE MUSICAS`, `Ordem alfabetica`, `por interprete`, `codigo`, `Interprete`) e a primeira linha do arquivo (costuma ter o contato da locadora, que **não** deve ser importado).
3. Linha de música: `^(artista)\s+(cod 3-6 dígitos)\s+(título)\s{2,}(início)\s+(idioma 3 letras maiúsculas)$`. Alternativa sem início da letra.
4. Quando título e início vêm colados com um espaço só: o título está em maiúsculas; separar na primeira palavra com letra minúscula (puxando junto uma letra isolada anterior, como "E").
5. Títulos quebrados em várias linhas: linhas só com texto em maiúsculas, recuadas, adjacentes a uma linha de música sem título; juntar ao título.
6. Ler o total do rodapé e comparar.

A posição das colunas muda de página para página; por isso o parser usa regex por linha, e não posições fixas.
Limitação conhecida: o PDF trunca artistas longos ("...") e títulos em ~30 caracteres. Não há como recuperar.

### 5.3 Importador CSV
UTF-8, cabeçalho obrigatório, separador `,` ou `;` (detectar):
`cod,titulo,artista,idioma,inicio` (`inicio` opcional; `idioma` aceita `BRA`, `EUA`, etc. ou vazio, tratado como `BRA`). Exemplo em `data/catalogos/exemplo.csv`.

### 5.4 Busca
`WHERE busca LIKE '%' || ? || '%'` com o termo normalizado (até 20 mil linhas, sem necessidade de FTS).

Normalização da busca, aplicada igual ao catálogo e ao termo digitado (não vale para nomes de convidados):
- minúsculas e sem acento;
- pontuação vira espaço; apóstrofo some sem espaço (`Destiny's` → `destinys`);
- conectivos soltos somem: `e`, `&`, `and`, `y`, `n` e as formas `'n'` (`Sandy & Junior` = `Sandy e Júnior`; `Rock'n'Roll` = `Rock and Roll`);
- abreviações: `jr` → `junior`; `ft`, `featuring` → `feat` (`Fábio Jr.` = `Fabio Júnior`);
- letras repetidas em sequência viram uma (`Barretto` = `Barreto`, `Mello` = `Melo`). Ordenação: casamento no título, depois artista, depois letra; idioma `JAP` por último. Filtro "Nacionais" = `BRA`; "Internacionais" = o resto. Páginas de 20 resultados + total, com `offset` (inteiro ≥ 0; outro valor dá `422 offset_invalido`); o convidado rola a lista e a próxima página carrega sozinha (rolagem infinita). Com a busca vazia, a lista é o catálogo inteiro.

### 5.5 Navegação por artista
O PDF não traz gênero musical, então quem não sabe o que buscar navega por artista. O campo artista é dividido em participantes por ` - ` (`Bruninho e Davi - Gusttavo Lima` conta para os dois); participante cortado pelo PDF (termina em `...` ou `…`) é ignorado. Grafias com a mesma normalização da busca (5.4) são o mesmo artista, exibido com a grafia mais frequente. Lista A–Z com o total de músicas de cada um, respeitando o filtro Nacionais/Internacionais e filtrável pelo campo de busca. Tocar num artista mostra as músicas dele (filtro `artista`, combinável com a busca e com o filtro de idioma), com um chip "Artista: X ✕" para sair.

### 5.6 Você pode gostar
Quem já cantou alguma música vê **um** espaço reservado no topo do catálogo (só com a busca vazia e sem filtro de artista): uma música de um artista que a pessoa já cantou e que ela nunca pediu (em nenhum status), com o texto "Porque você cantou X". Com vários artistas, alterna entre eles a cada pedido novo da pessoa; a escolha não muda entre atualizações da tela se os pedidos dela não mudaram. Sem candidata, o espaço não aparece.

### 5.7 Gênero musical (opcional)
O PDF não traz gênero. No passo 4, depois de importar o catálogo, quem organiza pode colar uma chave de API da Anthropic para o app pedir ao Claude o gênero de cada artista.
- **A chave não é guardada:** vai só no corpo de cada pedido ao servidor e dele para `api.anthropic.com`. Não entra no banco, no `.env`, nos registros nem em respostas da API; a tela a mantém só enquanto a página está aberta. Só nomes de artistas saem do servidor, nada de convidados. Chave recusada pela Anthropic: `422 chave_invalida`.
- **O que é classificado:** o artista principal de cada música (o primeiro participante, 5.5), pela chave normalizada da busca (5.4). A classificação fica por artista, então sobrevive a reimportar o catálogo; rodar de novo classifica só os artistas que faltam. Cada pedido classifica até 150 artistas, os com mais músicas primeiro; a tela repete os pedidos até acabar, mostrando o progresso, e pode parar no meio.
- **Categorias fixas:** MPB, Sertanejo, Samba/Pagode, Forró/Piseiro, Axé, Funk, Brega/Arrocha, Pop Nacional, Rock Nacional, Gospel, Infantil, Pop Internacional, Rock Internacional, Latino, Reggae, Outros. Para cada artista o modelo devolve uma categoria e a confiança (alta, média ou baixa), ou diz que não conhece o artista: aí ele fica sem gênero e não é perguntado de novo.
- **Resultado mostrado antes de ligar:** cobertura (% das músicas com gênero), artistas e músicas por confiança, músicas por gênero, amostra dos artistas de confiança baixa com mais músicas e a **precisão estimada**: média, ponderada pelo número de músicas, de 95% (alta), 75% (média) e 50% (baixa). A tela diz que é uma estimativa a partir da confiança declarada pelo modelo, não uma conferência.
- **Ligar é decisão de quem organiza:** o filtro (`filtro_genero`) começa desligado e pode ser ligado ou desligado a qualquer momento; também dá para apagar a classificação.
- **No catálogo do convidado,** com o filtro ligado, no modo Músicas aparece uma linha de chips com os gêneros que têm músicas (respeitando o filtro Nacionais/Internacionais), em ordem de quantidade, com "Todos os gêneros" primeiro. Combina com a busca, o idioma e o artista. Música sem gênero só aparece em "Todos os gêneros".
- **Classificação pronta:** `node scripts/importar-generos.js <arquivo.csv>` grava uma classificação feita fora do app (CSV `artista;genero;confianca`, cabeçalho opcional, colunas a mais ignoradas). Linha com categoria ou confiança fora da lista é ignorada e contada.

## 6. Modelo de dados

```sql
CREATE TABLE festa (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  status       TEXT NOT NULL DEFAULT 'rascunho',  -- rascunho | aberta | encerrada
  nome_destaque TEXT NOT NULL DEFAULT '',
  titulo       TEXT NOT NULL DEFAULT '',
  subtitulo    TEXT NOT NULL DEFAULT '',
  inicio_em    TEXT,                -- ISO 8601 com fuso
  duracao_min  INTEGER NOT NULL DEFAULT 240,
  local        TEXT NOT NULL DEFAULT '',
  contato      TEXT NOT NULL DEFAULT '',  -- de quem organiza (7.1)
  pix          TEXT NOT NULL DEFAULT '',  -- chave Pix de quem organiza (9.2)
  filtro_genero INTEGER NOT NULL DEFAULT 0, -- 1 = chips de gênero no catálogo (5.7)
  maquina_ativa INTEGER NOT NULL DEFAULT 0, -- 1 = envia o código da vez para a máquina (10.5)
  convidados   INTEGER NOT NULL DEFAULT 30,
  arte_arquivo TEXT,                -- caminho em data/uploads
  tema         TEXT NOT NULL,       -- JSON: preset + tokens finais (seção 11)
  regras       TEXT NOT NULL,       -- JSON com as regras do passo 5
  admin_pin_hash TEXT,              -- scrypt
  catalogo_origem TEXT,             -- nome do arquivo importado + data
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE musicas (
  cod      TEXT PRIMARY KEY,
  titulo   TEXT NOT NULL,
  artista  TEXT NOT NULL,
  inicio   TEXT NOT NULL DEFAULT '',
  idioma   TEXT NOT NULL DEFAULT 'BRA',
  busca    TEXT NOT NULL
);

CREATE TABLE pessoas (
  id         TEXT PRIMARY KEY,           -- UUID do cookie; criadas pelo admin: 'adm-<uuid>'
  nome       TEXT NOT NULL,
  nome_norm  TEXT NOT NULL UNIQUE,
  vip        INTEGER NOT NULL DEFAULT 0,
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pedidos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pessoa_id      TEXT NOT NULL REFERENCES pessoas(id),
  musica_cod     TEXT NOT NULL REFERENCES musicas(cod),
  status         TEXT NOT NULL DEFAULT 'pendente',
                 -- pendente | na_vez | cantou | cancelado | removido
  t_fila         REAL NOT NULL,
  pulos          INTEGER NOT NULL DEFAULT 0,
  ordem_manual   INTEGER,
  bypass         INTEGER NOT NULL DEFAULT 0,
  votacao_aberta INTEGER NOT NULL DEFAULT 0,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  na_vez_em      TEXT,
  finalizado_em  TEXT
);

CREATE TABLE votos (
  pedido_id  INTEGER NOT NULL REFERENCES pedidos(id),
  pessoa_id  TEXT NOT NULL REFERENCES pessoas(id),
  nota       INTEGER NOT NULL CHECK (nota BETWEEN 0 AND 10),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pedido_id, pessoa_id)
);

CREATE TABLE generos_artista (     -- 5.7
  chave     TEXT PRIMARY KEY,       -- artista com a normalização da busca
  genero    TEXT NOT NULL DEFAULT '', -- '' = o modelo não conhece
  confianca TEXT NOT NULL,          -- alta | media | baixa
  origem    TEXT NOT NULL           -- claude | importado
);

CREATE TABLE meta (chave TEXT PRIMARY KEY, valor TEXT);  -- versao, ultimo_cantor_id
```

`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`

## 7. Identidade e acesso

- **Convidado:** `POST /api/pessoas {nome}` cria a pessoa e grava o cookie `kid` (UUID, `HttpOnly`, `SameSite=Lax`, `Secure`, validade até 24 h depois do fim da festa).
- **Nome único** na festa (sem acento e sem caixa). Se já existe: `409`, e a tela sugere acrescentar uma inicial.
- **Admin:** `POST /api/admin/login {pin}` compara com o hash e grava cookie `adm` assinado com `COOKIE_SECRET`. Máximo de 5 tentativas por minuto por IP.
- **Setup inicial:** rotas `/api/setup/*` aceitam o cabeçalho `X-Setup-Token` enquanto não existe PIN; depois disso, só cookie de admin.
- Risco aceito: limpar cookie ou usar aba anônima cria outra pessoa (outro voto, outra cota de pedidos).

### 7.1 Privacidade
- Só cookies essenciais (`kid` e `adm`), sem rastreamento, anúncios nem pedidos a terceiros: fontes e imagens saem do próprio servidor (11). Por isso não há banner de consentimento.
- **Tela de entrada:** junto do campo de nome, o texto "Usamos um cookie só para lembrar quem você é nesta festa. Sem rastreamento." com o link "Privacidade" para `/privacidade`.
- **Página `/privacidade`:** genérica, com o título e o tema da festa. Diz:
  - o que é guardado: o nome escolhido, os pedidos, as notas dadas, o e-mail (só se a pessoa deixar, 9.1) e, nos registros técnicos do servidor, endereço IP e horário dos acessos;
  - para quê: montar a fila, a votação e o ranking desta festa; os registros técnicos servem só para manter o site no ar e evitar abuso;
  - quem vê: todos na festa veem nomes, músicas pedidas e rankings; quem organiza vê também os pedidos de cada pessoa, mas não vê e-mails nem as notas individuais;
  - por quanto tempo: o cookie vale até 24 h depois do fim da festa; o e-mail é apagado depois do envio do ranking; ao arquivar, uma cópia do banco (sem e-mails) fica guardada só com quem organiza;
  - quem responde pelos dados: quem organiza a festa, com o contato do passo 2 quando preenchido.

## 8. Regras da fila

Os números citados abaixo vêm de `festa.regras`.

### 8.1 Estados
- `pendente`: na fila.
- `na_vez`: música atual. No máximo um pedido com esse status, e ele fica **travado**: nenhum recálculo tira alguém do palco no meio da música.
- `cantou`, `cancelado`, `removido`: finais.

### 8.2 Ordenação dos pendentes (`ordenar`, função pura)
Entrada: pendentes, cantadas por pessoa, cantor da vez, último cantor, VIPs.
1. Para cada pessoa, ordenar os pendentes dela por `t_fila`; índice `i` = 0, 1, 2...
2. Rodada: pessoa comum `cantadas + i`; VIP `i` (conta sempre como quem ainda não cantou).
3. Ordenar por `(rodada, t_fila)`.
4. Pedidos com `ordem_manual` vêm primeiro, nessa ordem, sem passar pela regra do passo 5.
5. Nos demais, passe anti-repetição: o "anterior" inicial é o último manual, senão o cantor da vez, senão o último cantor. Escolher o primeiro restante de pessoa diferente do anterior ou com `bypass = 1`. Se só sobrou a mesma pessoa, aceitar.

### 8.3 Avanço
Quando o `na_vez` sai (cantou, pulado ou removido), na mesma transação, promover o primeiro de `ordenar` a `na_vez` e zerar o `ordem_manual` dele. Fila vazia: o próximo pedido criado vira `na_vez` direto.

### 8.4 Ações
| Ação | Quem | Efeito |
|---|---|---|
| Pedir | convidado | Valida música, limite de pendentes (`pendente` + `na_vez`) e pedido repetido. `t_fila = agora`. |
| Cancelar | dono | Só `pendente`. |
| Cantou | dono do `na_vez` ou admin a qualquer momento; outra pessoa com pedido `pendente`, menos o dono do primeiro de `ordenar` (o próximo), depois de 2 minutos de `na_vez_em` | Vira `cantou`, atualiza último cantor, votações (seção 9), avança. Fora da regra: `403 pedido_alheio`; antes dos 2 minutos: `403 cedo_demais`. |
| Pular ausente | admin | Antes do limite de pulos: volta a `pendente`, `pulos + 1`, `t_fila = agora`, `ordem_manual = NULL`, apaga votos do pedido, avança. No limite: `removido`, avança. |
| Mover ↑/↓ | admin | Materializa a ordem atual em `ordem_manual = 0..n` e troca o par. |
| Bypass | admin | Liga/desliga no pedido. |
| VIP | admin | Liga/desliga na pessoa (várias permitidas). O admin mostra quantos VIPs há. |
| Adicionar pedido | admin | Para convidado sem celular; cria ou reaproveita a pessoa pelo nome. |

Toda escrita incrementa `meta.versao`.

## 9. Nota da festa

- Pode ser desligada no setup; desligada, somem os cartões de voto e a aba Ranking.
- Vota qualquer pessoa cadastrada, menos o próprio cantor; um voto por performance, alterável enquanto aberta.
- Abre quando o pedido vira `na_vez`; fecha quando a **próxima** performance vira `cantou`. No máximo duas abertas.
- Parcial escondida enquanto aberta: a API devolve só contagem e o voto do próprio usuário.
- Nota = mediana (par: média dos dois do meio), exibida com 1 casa e vírgula.
- Mínimo de votos configurável (padrão 3). Pedido pulado perde os votos.

### Rankings
- **Performances:** `cantou`, votação fechada, votos ≥ mínimo; mediana desc, empate por número de votos.
- **Pessoas:** pessoas com performances com nota ≥ mínimo configurado (padrão 2); média das medianas (1 casa); empate pela melhor performance, depois número de performances. Se vazio, a aba abre em Performances com aviso.

### 9.1 Ranking por e-mail
- Opcional: só existe com SMTP configurado no `.env` (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) e com a votação ligada; senão o campo não aparece (`email_ranking: false` em `GET /api/festa`).
- Na aba Ranking, com a festa aberta, o convidado pode deixar um e-mail (validação simples, até 254 caracteres) e removê-lo depois. Texto obrigatório junto do campo: "Usamos seu e-mail só para mandar o ranking desta festa quando ela terminar. Depois do envio, ele é apagado."
- Ao encerrar a festa, o app envia em segundo plano para cada pessoa com e-mail: a colocação dela no ranking de pessoas (se estiver nele), os 10 primeiros de Pessoas e de Performances e o link da festa. Assunto: "Ranking final · {título}".
- Enviou, apaga o e-mail. Falhou, o e-mail fica e o envio é tentado de novo quando o app reinicia com a festa encerrada. Arquivar a festa apaga os e-mails restantes antes do backup.
- O admin não vê os e-mails.
- Rodapé extra opcional: `SMTP_RODAPE` no `.env` (texto livre de quem hospeda o app). Se preenchido, aparece no fim do e-mail, depois do aviso de que o endereço foi apagado.

### 9.2 Prêmio por Pix
- Com a votação ligada, a festa aberta e a chave Pix preenchida no passo 2, a aba Ranking mostra um cartão "Prêmio de quem ganhar": quem quiser contribuir faz um Pix para quem organiza, que repassa a quem ganhar. Mostra a chave e um botão "Copiar".
- O app não recebe nem confere pagamentos e não mostra valores arrecadados.

## 10. API

JSON. Erros: `{ "erro": "codigo", "mensagem": "texto para a tela" }`.

### 10.1 Polling
`GET /api/estado` com `ETag: "<versao>-<pessoa>"` e `If-None-Match` → `304`. A cada 4 s; pausar com `document.hidden`.

### 10.2 Público
| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/festa` | | dados públicos: status, título, nome em destaque, subtítulo, data, local, contato, pix, `filtro_genero`, url da arte, tema, regras visíveis |
| `GET /api/festa/arte` | | a imagem |
| `POST /api/pessoas` | `{nome}` | `201` + cookie; `409 nome_em_uso`; `403 festa_fechada` |
| `GET /api/estado` | | `{versao, me: {nome, vip, email}, atual, proximos[10], total_fila, meus_pedidos[], votacoes[], limite}`; `atual.liberado_em` (ISO ou `null`) diz a partir de quando o convidado do cookie, se não for o dono, pode marcar Cantou (8.4) |
| `GET /api/musicas?q=&filtro=&artista=&genero=&offset=` | | página de até 20 + `total` + `offset` (5.4, 5.5, 5.7); `genero` fora da lista dá `422 genero_invalido` e é ignorado com o filtro de gênero desligado |
| `GET /api/generos?filtro=` | | `{generos: [{nome, total}]}` em ordem de quantidade; lista vazia com o filtro de gênero desligado (5.7) |
| `GET /api/artistas?filtro=` | | `{artistas: [{nome, chave, total}]}` em ordem A–Z (5.5) |
| `PUT /api/me/email` | `{email}` | `200 {email}`; `email_invalido`, `email_desligado`, `festa_fechada` (9.1) |
| `DELETE /api/me/email` | | `204` |
| `GET /api/sugestao` | | `{sugestao: {musica, artista} \| null}` para o convidado do cookie (5.6) |
| `POST /api/pedidos` | `{musica_cod}` | `201 {pedido, posicao_estimada}`; `limite_atingido`, `ja_pedida`, `musica_inexistente` |
| `DELETE /api/pedidos/:id` | | `204` |
| `POST /api/pedidos/:id/cantou` | | `200` |
| `PUT /api/votos` | `{pedido_id, nota}` | `200 {n_votos}`; `votacao_fechada`, `voto_proprio` |
| `GET /api/ranking?tipo=pessoas\|performances` | | lista |

### 10.3 Setup e festa (admin, ou `X-Setup-Token` antes do PIN)
| Rota | Corpo |
|---|---|
| `GET /api/setup` | estado do assistente e o que falta |
| `PUT /api/setup/pin` | `{pin}` |
| `PUT /api/setup/festa` | campos do passo 2 |
| `PUT /api/setup/visual` | `{preset, destaque, fonte}` |
| `POST /api/setup/arte` | multipart `arte` |
| `POST /api/setup/catalogo` | multipart `arquivo` → `{previa: {total, por_idioma, ignoradas[], duplicados, total_rodape}, token}` |
| `POST /api/setup/catalogo/confirmar` | `{token}` |
| `GET /api/setup/generos` | resumo da classificação (5.7) |
| `POST /api/setup/generos/classificar` | `{chave}` → `{feitos, restantes, resumo}`; `chave_invalida`, `anthropic_limite`, `anthropic_indisponivel` |
| `PUT /api/setup/generos` | `{ativo}` liga ou desliga o filtro |
| `DELETE /api/setup/generos` | apaga a classificação e desliga o filtro |
| `PUT /api/setup/regras` | JSON de regras |
| `GET /api/setup/qr.png`, `/qr.svg`, `/cartaz.pdf` ou `/cartaz.html` | material para imprimir |
| `POST /api/festa/abrir`, `/encerrar`, `/arquivar` | |

### 10.4 Operação (admin)
`POST /api/admin/login`, `GET /api/admin/estado`, `POST /api/admin/cantou`, `POST /api/admin/pular`, `POST /api/admin/pedidos/:id/mover {direcao}`, `PATCH /api/admin/pedidos/:id {bypass}`, `GET /api/admin/pessoas`, `PATCH /api/admin/pessoas/:id {vip}`, `POST /api/admin/pedidos {nome, musica_cod}`.

### 10.5 Máquina de karaokê (opcional)
Um script fora do app (`integracoes/`) roda num aparelho ao lado da máquina e manda o código por infravermelho (Broadlink ou controle universal Tuya). Liga com `MAQUINA_TOKEN` no `.env` (pelo menos 16 caracteres); sem ele, as rotas respondem `404 maquina_desligada` e o admin não mostra nada da máquina.

- **Envio ligado por quem organiza:** mesmo com o token, o envio começa desligado (`festa.maquina_ativa = 0`, também numa festa nova depois de arquivar). Desligado, `GET /api/maquina/comando` devolve `{comando: null}` e o script fica só esperando; a conexão continua aparecendo no admin. Liga e desliga a qualquer momento no admin (`PUT /api/admin/maquina {ativa}`) e no setup, passo 5 (`PUT /api/setup/maquina {ativa}`); `GET /api/setup` traz `maquina: {ativa} | null` (`null` sem token). Ao ligar com alguém no palco, o código da vez sai na hora, a menos que o script já o tenha enviado antes. `ativa` não booleano: `422 valor_invalido`.
- A máquina recebe **só o pedido `na_vez`**: ela nunca guarda fila própria. Cada vez que um pedido vira `na_vez`, nasce um comando novo `{id, cod}`. O `id` muda também quando o admin pede "Reenviar código".
- `GET /api/maquina/comando?feito=<id>` com o cabeçalho `X-Maquina-Token`: devolve `{comando: {id, cod, titulo, cantor} | null}` (`null` sem `na_vez` ou com a festa fora de `aberta`). `feito` é o último comando que o script já mandou; token errado: `401 token_invalido`.
- O script guarda o último `id` feito num arquivo e só manda o código quando o `id` muda; ao reiniciar, não repete.
- Admin: indicador "Máquina conectada" (o script consultou nos últimos 30 segundos), "Código enviado" ou "Enviando…" (o `feito` informado é o comando atual) e o botão "Reenviar código" (`POST /api/admin/maquina/reenviar`, incrementa `meta.maquina_reenvio`; com o envio desligado, `409 maquina_pausada`). Com o envio desligado, o admin mostra "Envio para a máquina desligado" e o botão "Ligar envio"; ligado, "Desligar envio".
- Plano B: o operador digita no controle o código grande mostrado no palco.

## 11. Visual e temas

O tema é um conjunto de tokens CSS aplicado como variáveis em `:root` a partir de `festa.tema`.

| Token | Uso |
|---|---|
| `--fundo` | fundo da página |
| `--superficie` | cartões |
| `--borda` | bordas suaves |
| `--decor` | filetes, círculos, ícones decorativos (nunca texto pequeno) |
| `--palco` | fundo do cartão "Agora no palco" e do 1º do ranking |
| `--destaque-palco` | código da música e destaques sobre `--palco` |
| `--texto`, `--texto-2` | texto principal e secundário sobre `--fundo` |
| `--texto-palco`, `--texto-palco-2` | sobre `--palco` |
| `--alerta`, `--alerta-fundo` | "2 seguidas", cancelar |
| `--fonte-destaque` | nomes de pessoas e frases de efeito |
| `--fonte-base` | todo o resto |

Presets:

| Preset | fundo | superficie | decor | palco | destaque-palco | texto | texto-2 | fonte destaque |
|---|---|---|---|---|---|---|---|---|
| Dourado clássico | `#F7F0E1` | `#FFFBF2` | `#C49A3C` | `#16130F` | `#D9B45A` | `#1A1611` | `#6B5D45` | Great Vibes |
| Noite neon | `#121018` | `#1D1A26` | `#7C5CFF` | `#000000` | `#3EE6C1` | `#F2F0F7` | `#A9A3B5` | Bebas Neue |
| Tropical | `#FFF6EC` | `#FFFFFF` | `#FF7A59` | `#0F3D3E` | `#FFD166` | `#1C2B2B` | `#4F6162` | Pacifico |
| Minimalista | `#FFFFFF` | `#F6F6F6` | `#111111` | `#111111` | `#FFFFFF` | `#111111` | `#5C5C5C` | Playfair Display |

- **Dourado clássico** é o tema do protótipo em `docs/design/`.
- A cor de destaque escolhida pelo admin substitui `--decor` e `--destaque-palco`. Validar contraste: `--texto-2` sobre `--fundo` ≥ 4.5:1; `--destaque-palco` sobre `--palco` ≥ 4.5:1.
- Motivo decorativo: linha fina em `--decor` com um ícone pequeno no meio (coração no Dourado clássico; o preset define o ícone).
- Fonte base: Montserrat em todos os presets. Rótulos em caixa alta com `letter-spacing: 0.2em`.
- As fontes são servidas pelo próprio app (`public/fontes/`, licença OFL), nunca pelo Google Fonts ou outra CDN (7.1).
- Alvos de toque ≥ 44 px; inputs com `font-size: 16px`.

## 12. Telas

Referência visual: `docs/design/` (formato do protótipo; ver o LEIA-ME de lá).

### Convidado (`/`)
- **Entrada:** arte da festa (se houver), nome em destaque e subtítulo dentro do círculo decorativo, campo de nome com o aviso de cookie (7.1), "Entrar na festa".
- **Cabeçalho:** título curto + nome do convidado.
- **Menu inferior:** Fila · Catálogo · Pedidos (n) · Ranking.
- **Fila:** "Agora no palco" (título, artista, código grande, cantor); "Cantou?" quando é a vez do usuário; "Fulano já terminou?" (com confirmação) quando `atual.liberado_em` já passou; cartões de voto (atual e anterior); "Próximos 10" com o usuário destacado.
- **Catálogo:** busca, Músicas / Artistas, filtros (idioma e, se ligado, gênero), rolagem infinita, "Você pode gostar", "Pedir"/"Na fila", aviso de limite.
- **Pedidos:** posição, espera estimada, cancelar, "Já cantei".
- **Ranking:** Pessoas / Performances, cartão do prêmio por Pix (9.2).
- **Festa em preparação** (rascunho) e **Festa encerrada** (ranking final + agradecimento).
- **Privacidade** (`/privacidade`): o texto de 7.1, acessível sem entrar na festa.

### Admin (`/admin`)
- Sem PIN configurado: assistente de setup (seção 4).
- Com festa: Operação (contadores, palco com Cantou/Pular e, com a máquina ligada (10.5), o estado da máquina e "Reenviar código", fila com ↑ ↓, Bypass, VIP, selos, convidados, adicionar pedido) e um menu Festa (editar dados, visual, catálogo, regras, QR, encerrar, arquivar).

## 13. Instalação

Ver `README.md`. Variáveis de ambiente (`.env.example`): `PORT`, `PUBLIC_URL`, `SETUP_TOKEN`, `COOKIE_SECRET`, `DATA_DIR`; opcionais `SMTP_*` e `SMTP_RODAPE` (9.1) e `MAQUINA_TOKEN` (10.5).

## 14. Testes obrigatórios

`fila.js`, `votos.js` e os importadores têm testes com `node:test`:

1. Quem nunca cantou passa à frente de quem já cantou, mesmo pedindo depois.
2. Rodadas iguais seguem a ordem de chegada.
3. Ninguém aparece duas vezes seguidas, inclusive contra o cantor da vez.
4. Com bypass, pode.
5. Só sobrou uma pessoa: a fila anda.
6. VIP com 3 cantadas empata com quem nunca cantou; dois VIPs seguem rodada e chegada.
7. Pedido novo não tira o `na_vez` do palco.
8. Ordem manual respeitada; pedidos novos entram depois.
9. Pulos: volta ao fim da rodada até o limite configurado, depois é removido.
10. Limite de pendentes configurável; cancelar libera vaga.
11. Mediana ímpar e par; mínimo de votos configurável.
12. Votação: sem voto próprio, voto alterável, fecha quando a próxima performance termina.
13. Ranking de pessoas respeita o mínimo de performances; desempates.
14. Importador PDF: fixture com linha normal, título colado ao início da letra, letra isolada ("E ..."), título quebrado em linhas, cabeçalho repetido, rodapé com total.
15. Importador CSV: `,` e `;`, idioma vazio, código duplicado reportado.
16. Setup: rotas de setup recusam sem token antes do PIN e sem cookie de admin depois.

## 15. Decisões registradas

- Uma festa por instalação; arquivar para reutilizar.
- Primeiro acesso protegido por `SETUP_TOKEN`.
- Fila por rodadas; anti-repetição com bypass; ordem manual do admin prevalece.
- Cantor confirma "Cantou?"; depois de 2 minutos, quem está na fila (menos o próximo) também pode; admin pula ausentes.
- VIP = prioridade leve, várias pessoas, marcado pelo admin.
- Nota da festa: 0 a 10, mediana, parcial escondida, janela até a próxima performance terminar.
- Ranking de pessoas: média das medianas com mínimo de performances.
- Polling em vez de WebSocket.
- Máquina de karaokê recebe só o código da vez, nunca a fila (10.5).
- Nome único por festa.
- Só cookies essenciais e nenhum serviço de terceiros no navegador; transparência pela página de privacidade em vez de banner (7.1).
- Catálogos reais não vão para o repositório (seção 5; ver README). Classificações de gênero de catálogos reais também não.
- Gênero musical por artista, classificado pelo Claude com a chave de quem organiza, que nunca é guardada; ligar o filtro é escolha de quem organiza, depois de ver a precisão estimada (5.7).
- Prêmio por Pix sem integração de pagamento: só a chave de quem organiza (9.2).
