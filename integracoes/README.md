# Integração com a máquina de karaokê (infravermelho)

Com esta integração, quando alguém vira a vez na fila, o código da música é "digitado" sozinho na máquina por um Broadlink (RM4 Mini, RM Mini 3...). A regra está na SPEC 10.5. A máquina recebe **só a música da vez**: ela nunca guarda fila própria. Assim não há limite de músicas na máquina nem fila fora de sincronia.

```
convidado pede ──► app (servidor) ──► celular ao lado da máquina ──Wi-Fi──► Broadlink ──IR──► máquina
                                      (Termux + este script)
```

O script só faz consultas de saída (`GET /api/maquina/comando`). Não precisa abrir porta nem ter IP fixo.

## 1. No servidor

1. Gere um token: `openssl rand -hex 24`.
2. Ponha no `.env` do app: `MAQUINA_TOKEN=<token>`.
3. Reinicie o app. No admin aparecem o estado da máquina e o botão "Reenviar código" (com a máquina ainda desconectada).

## 2. No celular que fica ao lado da máquina (Android)

1. Instale o **Termux pelo F-Droid** (a versão da Play Store está parada).
2. No Termux:
   ```sh
   pkg update && pkg upgrade
   pkg install python python-cryptography
   pip install broadlink
   termux-setup-storage
   ```
3. Copie esta pasta para o celular. Um jeito: `pkg install git`, depois `git clone` do repositório. Outro: copie só `maquina_broadlink.py` para `~/maquina/`.
4. Ligue o **hotspot do próprio celular em 2.4 GHz**.
5. No app **Broadlink**, conecte o RM4 Mini a esse hotspot (mesmo nome e senha que serão usados na festa). Depois, nas configurações do aparelho no app, **desligue "Bloquear dispositivo"** (Lock device). Bloqueado, o script não consegue falar com ele.
6. No Android: tire o Termux da otimização de bateria, desligue as atualizações automáticas e deixe o celular na tomada.

## 3. Configurar e aprender as teclas (no dia, com a máquina e o controle)

```sh
cd ~/maquina
python maquina_broadlink.py descobrir      # deve listar o Broadlink e "bloqueado: não"
python maquina_broadlink.py                # cria o maquina.json
```

Edite o `maquina.json` (por exemplo com `nano maquina.json`):

| Campo | O que é |
|---|---|
| `url` | endereço da festa, ex.: `https://karaoke.seudominio.com.br` |
| `token` | o mesmo `MAQUINA_TOKEN` do servidor |
| `broadlink_ip` | vazio para procurar na rede; se `descobrir` achar mas `rodar` não, ponha o IP que ele mostrou |
| `sequencia` | o que apertar para cada música; `"digitos"` são os números um a um. Padrão: `["digitos", "reservar"]` |
| `intervalo_teclas` | segundos entre teclas (padrão 0.5); aumente se a máquina perder dígitos |
| `consulta_segundos` | de quanto em quanto tempo o script pergunta ao app (padrão 2) |

Grave as teclas do controle (aponte o controle para o Broadlink, a uns 10 cm):

```sh
python maquina_broadlink.py aprender               # 0 a 9, reservar e parar
python maquina_broadlink.py aprender reservar      # regrava só uma tecla
```

Os nomes das teclas são livres. Se a máquina pede outra tecla antes dos números (por exemplo "apagar"), aprenda essa tecla e mude a sequência para `["apagar", "digitos", "reservar"]`.

Teste sem passar pelo app, com a máquina parada e depois tocando uma música:

```sh
python maquina_broadlink.py testar 1234
```

Confira duas coisas:

- Com a máquina parada, o código + "reservar" começa a música?
- Com uma música tocando, o código entra como a próxima ou interrompe a atual?

Se precisar de outra tecla para começar a tocar, inclua na `sequencia`.

## 4. Na festa

```sh
termux-wake-lock                        # o Android não derruba o Termux com a tela apagada
python maquina_broadlink.py rodar
```

- O script guarda o último comando em `ultimo_comando.txt`. Ao reiniciar, não manda de novo a música que já mandou.
- Sem internet ou com o Broadlink fora do ar, ele tenta de novo a cada 5 segundos.
- No admin: "Máquina conectada · código enviado" mostra que deu certo. "Desconectada" quer dizer que o script parou de consultar há mais de 30 segundos.
- **"Reenviar código"** no admin manda de novo a música da vez (para quando o sinal não pegou).
- **Plano B:** o código da vez aparece grande no palco do admin. Digite no controle da máquina.

Os arquivos `maquina.json`, `codigos.json` e `ultimo_comando.txt` ficam só no celular: não vão para o repositório (o `maquina.json` tem o token).
