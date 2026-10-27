# Fila Karaokê

Gerencia a fila de karaokê da sua festa e gera ranking!

Você aluga (ou tem) um aparelho de karaokê que toca músicas por código. Os convidados escaneiam um QR code, buscam no catálogo do aparelho, pedem músicas e entram numa fila justa. Você controla tudo por um painel de admin.

## O que faz

- **Setup da festa:** nome em destaque, título, data, duração, número de convidados, arte do convite, tema visual, catálogo e regras. Gera o QR code e um cartaz para imprimir.
- **Catálogo:** importa o PDF da lista de músicas do aparelho (formato comum em locadoras) ou um CSV. Busca por título, artista, trecho da letra ou código.
- **Fila por rodadas:** quem cantou menos vai antes, e ninguém canta duas vezes seguidas. Limite de pedidos por pessoa.
- **Música da vez em destaque**, com o código grande para digitar no aparelho, e os próximos 10 da fila.
- **"Cantou?":** o próprio cantor confirma; o admin pula quem sumiu.
- **Admin:** reordenar, liberar a regra de duas seguidas (bypass), marcar VIPs, adicionar pedido para quem está sem celular.
- **Nota da festa:** todos votam de 0 a 10 em cada performance; a nota é a mediana. Ranking de performances e ranking geral de pessoas.

## Requisitos

- Um servidor com Node 20+ (testado em EC2 com Ubuntu 22.04/24.04), acessível pela internet.
- `poppler-utils` (para importar PDF): `sudo apt install poppler-utils`.
- Um domínio ou subdomínio apontando para o servidor (HTTPS é necessário para o cookie seguro).
- Caddy (recomendado) ou outro proxy com TLS. Se a máquina já usa nginx nas portas 80/443, veja abaixo.

## Instalação

```bash
git clone https://github.com/pednba/fila-karaoke.git
cd fila-karaoke
npm install
cp .env.example .env      # preencha PUBLIC_URL, SETUP_TOKEN e COOKIE_SECRET (SMTP_* é opcional: ranking por e-mail)
npm start                 # ou: pm2 start server.js --name karaoke
```

`Caddyfile`:

```
karaoke.seudominio.com.br {
  encode gzip
  reverse_proxy localhost:3000
}
```

Para gerar segredos: `openssl rand -hex 24`.

O app escuta só em `127.0.0.1` (variável `HOST`), então o proxy é o único caminho até ele. Para testar de outro aparelho na rede local, use `HOST=0.0.0.0`.

### Máquina que já usa nginx

Use `deploy/nginx.conf.example` no lugar do `Caddyfile` e emita o certificado com `sudo certbot --nginx -d <seu domínio>`. O `client_max_body_size` do modelo libera o upload do catálogo em PDF; sem ele, o nginx recusa arquivos acima de 1 MB.

Para manter o app no ar sem pm2, há um serviço systemd em `deploy/fila-karaoke.service.example`.

## Primeira festa

1. Abra `https://karaoke.seudominio.com.br/admin` e informe o `SETUP_TOKEN` do `.env`.
2. Siga o setup: PIN do admin, dados da festa, visual, catálogo, regras.
3. Baixe o QR code ou o cartaz e clique em **Abrir festa**.
4. Faça um teste com algumas pessoas em celulares reais antes do dia.
5. No fim, **Encerrar** mostra o ranking final; **Arquivar** guarda a festa e libera para a próxima.

## Catálogo

- **PDF de lista de aparelho:** colunas Intérprete, Cod, Título, Início da letra, Idioma. Precisa ter texto selecionável (não pode ser foto escaneada). Detalhes em `SPEC.md`, seção 5.2.
- **CSV:** `cod,titulo,artista,idioma,inicio` em UTF-8. Exemplo em `data/catalogos/exemplo.csv`.

O catálogo do seu aparelho fica só no seu servidor (`data/` está no `.gitignore`). Não publique listas de terceiros no repositório.

Para testar um PDF fora do app:

```bash
pdftotext -layout lista.pdf lista.txt
python3 importadores/pdf_lista_aparelho.py lista.txt catalogo.json
```

## Backup no dia

```bash
# crontab -e
*/10 * * * * sqlite3 /caminho/fila-karaoke/data/karaoke.db ".backup /caminho/backup/karaoke-$(date +\%H\%M).db"
```

## Desenvolvimento

- Especificação completa: `SPEC.md`.
- Referência visual: `docs/design/`.
- Testes: `npm test`.

## Licença

MIT. Ver `LICENSE`.
