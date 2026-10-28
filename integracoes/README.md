# Integração com a máquina de karaokê (infravermelho)

Com esta integração, quando alguém vira a vez na fila, o código da música é "digitado" sozinho na máquina por um emissor de infravermelho Wi-Fi. Servem dois tipos: **Broadlink** (RM4 Mini, RM Mini 3...) ou **controle universal Tuya / Smart Life**. A regra está na SPEC 10.5. A máquina recebe **só a música da vez**: ela nunca guarda fila própria. Assim não há limite de músicas na máquina nem fila fora de sincronia.

```
convidado pede ──► app (servidor) ──► celular ao lado da máquina ──Wi-Fi──► emissor IR ──IR──► máquina
                                      (Termux + maquina_ir.py)
```

O script só faz consultas de saída (`GET /api/maquina/comando`). Não precisa abrir porta nem ter IP fixo.

## 1. No servidor

1. Gere um token: `openssl rand -hex 24`.
2. Ponha no `.env` do app: `MAQUINA_TOKEN=<token>`.
3. Reinicie o app. No admin aparecem o estado da máquina e o botão "Ligar envio" (com a máquina ainda desconectada). O envio começa desligado: o script consulta, mas não recebe código até alguém ligar.

## 2. No celular que fica ao lado da máquina (Android)

1. Instale o **Termux pelo F-Droid** (a versão da Play Store está parada).
2. No Termux:
   ```sh
   pkg update && pkg upgrade
   pkg install python python-cryptography
   pip install broadlink      # se o emissor for Broadlink
   pip install tinytuya       # se o emissor for Tuya / Smart Life
   ```
3. Copie `maquina_ir.py` para `~/maquina/`, por exemplo com `curl -fO <endereço raw do arquivo no GitHub>`.
4. Ligue o **hotspot do próprio celular em 2.4 GHz** e conecte o emissor a ele pelo app do fabricante, com o mesmo nome e senha que serão usados na festa.
5. No Android: tire o Termux da otimização de bateria, desligue as atualizações automáticas e deixe o celular na tomada.

Para achar o IP do emissor: Configurações → Hotspot → aparelhos conectados → toque no aparelho. Para conferir que ele está na rede: `ping -c 3 <IP>`.

### Broadlink

No app Broadlink, nas configurações do aparelho, **desligue "Bloquear dispositivo"** (Lock device). Bloqueado, o script não consegue falar com ele.

### Tuya / Smart Life

O Tuya só aceita comandos locais com a **chave local** do aparelho, que se consegue uma vez pela plataforma de desenvolvedor:

1. Crie uma conta em **iot.tuya.com** e um projeto em Cloud → Development → Create Cloud Project (tipo "Smart Home"; data center Western America).
2. No projeto, abra Devices → **Link App Account** e escaneie o QR com o app Smart Life ou Tuya.
3. No Termux, em `~/maquina`: `python -m tinytuya wizard`. Cole o Access ID e o Access Secret do projeto. Ele grava o `devices.json` com o `id` e a `local_key` de cada aparelho.

Para saber se um IP é Tuya: `python -c "import socket; socket.create_connection(('<IP>', 6668), 5); print('é Tuya')"`.

O `devices.json` e o `tinytuya.json` são segredos: não vão para o repositório nem para prints. Se o controle for reconfigurado no app, a chave muda e é preciso rodar o wizard de novo.

## 3. Configurar e aprender as teclas (no dia, com a máquina e o controle)

```sh
cd ~/maquina
python maquina_ir.py                # cria o maquina.json
python maquina_ir.py descobrir      # Broadlink: lista e mostra "bloqueado: não"; Tuya: mostra a versão que respondeu
```

Edite o `maquina.json` (por exemplo com `nano maquina.json`):

| Campo | O que é |
|---|---|
| `url` | endereço da festa, ex.: `https://karaoke.seudominio.com.br` |
| `token` | o mesmo `MAQUINA_TOKEN` do servidor |
| `tipo` | `broadlink`, `tuya` ou `auto` (padrão: Tuya se existir `devices.json`) |
| `ip` | IP do emissor. Obrigatório no Tuya; no Broadlink, vazio procura na rede |
| `tuya_id` | vazio usa o controle universal do `devices.json`; com mais de um, ponha o `id` |
| `tuya_versao` | vazio usa a do `devices.json` (ou 3.3); ponha a que o `descobrir` mostrou |
| `sequencia` | o que apertar para cada música; `"digitos"` são os números um a um. Padrão: `["digitos", "reservar"]` |
| `intervalo_teclas` | segundos entre teclas (padrão 0.5); aumente se a máquina perder dígitos |
| `consulta_segundos` | de quanto em quanto tempo o script pergunta ao app (padrão 2) |

O hotspot pode dar outro IP ao emissor quando ele reconecta. Se o script deixar de achá-lo, confira o IP de novo.

Grave as teclas do controle (aponte o controle para o emissor, a uns 10 cm):

```sh
python maquina_ir.py aprender               # 0 a 9, reservar e parar
python maquina_ir.py aprender reservar      # regrava só uma tecla
```

Os nomes das teclas são livres. Se a máquina pede outra tecla antes dos números (por exemplo "apagar"), aprenda essa tecla e mude a sequência para `["apagar", "digitos", "reservar"]`. Teclas gravadas num tipo de emissor não servem no outro: trocou de emissor, aprenda de novo.

Teste sem passar pelo app, com a máquina parada e depois tocando uma música:

```sh
python maquina_ir.py testar 1234
```

Confira duas coisas:

- Com a máquina parada, o código + "reservar" começa a música?
- Com uma música tocando, o código entra como a próxima ou interrompe a atual?

Se precisar de outra tecla para começar a tocar, inclua na `sequencia`.

## 4. Na festa

```sh
termux-wake-lock                        # o Android não derruba o Termux com a tela apagada
python maquina_ir.py rodar
```

- O script guarda o último comando em `ultimo_comando.txt`. Ao reiniciar, não manda de novo a música que já mandou.
- Sem internet ou com o emissor fora do ar, ele tenta de novo a cada 5 segundos.
- Ligue o envio no admin ("Ligar envio") ou no setup, passo 5, só depois de testar com `testar`. "Desligar envio" para tudo na hora, sem parar o script.
- No admin: "Máquina conectada · código enviado" mostra que deu certo. "Desconectada" quer dizer que o script parou de consultar há mais de 30 segundos.
- **"Reenviar código"** no admin manda de novo a música da vez (para quando o sinal não pegou).
- **Plano B:** o código da vez aparece grande no palco do admin. Digite no controle da máquina.

Os arquivos `maquina.json`, `codigos.json`, `ultimo_comando.txt`, `devices.json` e `tinytuya.json` ficam só no celular: não vão para o repositório (têm token e chaves).
