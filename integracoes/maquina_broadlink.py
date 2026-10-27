#!/usr/bin/env python3
"""Manda o código da vez para a máquina de karaokê por infravermelho (SPEC 10.5).

Roda num aparelho ao lado da máquina (Android com Termux, ou um computador) na mesma
rede Wi-Fi de um Broadlink (RM4 Mini, RM Mini 3...). Só fala com o app para fora
(consulta GET /api/maquina/comando); a máquina recebe só a música da vez, nunca a fila.

Uso:
  python maquina_broadlink.py descobrir          procura o Broadlink na rede
  python maquina_broadlink.py aprender [teclas]  grava as teclas do controle (padrão: 0-9, reservar, parar)
  python maquina_broadlink.py testar 1234        manda um código sem passar pelo app
  python maquina_broadlink.py rodar              consulta o app e manda cada código da vez

Arquivos ao lado do script: maquina.json (configuração), codigos.json (teclas aprendidas)
e ultimo_comando.txt (último comando enviado, para não repetir ao reiniciar).
"""
import base64
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import broadlink
from broadlink.exceptions import ReadError, StorageError

PASTA = Path(__file__).resolve().parent
ARQ_CONFIG = PASTA / 'maquina.json'
ARQ_CODIGOS = PASTA / 'codigos.json'
ARQ_ULTIMO = PASTA / 'ultimo_comando.txt'

PADRAO = {
    'url': '',                       # endereço da festa, ex.: https://karaoke.seudominio.com.br
    'token': '',                     # MAQUINA_TOKEN do .env do servidor
    'broadlink_ip': '',              # vazio = procurar na rede
    'sequencia': ['digitos', 'reservar'],  # o que apertar para cada código; 'digitos' = um por um
    'intervalo_teclas': 0.5,         # segundos entre uma tecla e outra
    'consulta_segundos': 2,
}
TECLAS_PADRAO = [str(d) for d in range(10)] + ['reservar', 'parar']


def log(msg):
    print(time.strftime('%H:%M:%S'), msg, flush=True)


def ler_config():
    if not ARQ_CONFIG.exists():
        ARQ_CONFIG.write_text(json.dumps(PADRAO, indent=2, ensure_ascii=False) + '\n')
        log(f'Criei {ARQ_CONFIG.name}: preencha url e token e rode de novo.')
    return {**PADRAO, **json.loads(ARQ_CONFIG.read_text())}


def ler_codigos():
    return json.loads(ARQ_CODIGOS.read_text()) if ARQ_CODIGOS.exists() else {}


def conectar(config):
    if config['broadlink_ip']:
        dispositivo = broadlink.hello(config['broadlink_ip'])
    else:
        achados = broadlink.discover(timeout=5)
        if not achados:
            raise RuntimeError('Nenhum Broadlink encontrado. Ele está ligado e no mesmo Wi-Fi? Tente pôr o IP em broadlink_ip.')
        dispositivo = achados[0]
    dispositivo.auth()
    return dispositivo


def descobrir():
    achados = broadlink.discover(timeout=5)
    if not achados:
        log('Nenhum Broadlink encontrado.')
    for d in achados:
        log(f'{d.type} {d.model or ""} em {d.host[0]}  (bloqueado: {"sim" if d.is_locked else "não"})')


def aprender(config, teclas):
    dispositivo = conectar(config)
    codigos = ler_codigos()
    for tecla in teclas or TECLAS_PADRAO:
        dispositivo.enter_learning()
        log(f'Aponte o controle para o Broadlink e aperte: {tecla}  (30 s; sem resposta, pula)')
        dado = None
        fim = time.time() + 30
        while time.time() < fim and dado is None:
            time.sleep(1)
            try:
                dado = dispositivo.check_data()
            except (ReadError, StorageError):
                pass
        if dado is None:
            log(f'  {tecla}: nada recebido, pulei.')
            continue
        codigos[tecla] = base64.b64encode(dado).decode()
        ARQ_CODIGOS.write_text(json.dumps(codigos, indent=2) + '\n')
        log(f'  {tecla}: gravada.')
    log(f'Pronto. Teclas em {ARQ_CODIGOS.name}: {", ".join(codigos)}')


def teclas_do_codigo(config, cod):
    teclas = []
    for passo in config['sequencia']:
        teclas.extend(list(cod) if passo == 'digitos' else [passo])
    return teclas


def mandar(dispositivo, config, cod):
    codigos = ler_codigos()
    teclas = teclas_do_codigo(config, cod)
    faltando = [t for t in teclas if t not in codigos]
    if faltando:
        raise RuntimeError(f'Faltam teclas aprendidas: {", ".join(sorted(set(faltando)))}. Rode: aprender {" ".join(sorted(set(faltando)))}')
    for tecla in teclas:
        dispositivo.send_data(base64.b64decode(codigos[tecla]))
        time.sleep(config['intervalo_teclas'])


def consultar(config, feito):
    rota = urllib.parse.urljoin(config['url'].rstrip('/') + '/', 'api/maquina/comando')
    if feito:
        rota += '?' + urllib.parse.urlencode({'feito': feito})
    pedido = urllib.request.Request(rota, headers={'X-Maquina-Token': config['token']})
    with urllib.request.urlopen(pedido, timeout=10) as resposta:
        return json.loads(resposta.read())['comando']


def rodar(config):
    if not config['url'] or not config['token']:
        sys.exit(f'Preencha url e token em {ARQ_CONFIG.name}.')
    feito = ARQ_ULTIMO.read_text().strip() if ARQ_ULTIMO.exists() else ''
    dispositivo = None
    log('Esperando a vez de alguém...')
    while True:
        try:
            comando = consultar(config, feito)
            if comando and comando['id'] != feito:
                dispositivo = dispositivo or conectar(config)
                log(f'Mandando {comando["cod"]} ({comando["titulo"]} · {comando["cantor"]})')
                mandar(dispositivo, config, comando['cod'])
                feito = comando['id']
                ARQ_ULTIMO.write_text(feito)
                log('  enviado.')
            time.sleep(config['consulta_segundos'])
        except urllib.error.HTTPError as e:
            log(f'O app respondeu {e.code}: {e.read().decode(errors="replace")}')
            if e.code in (401, 404):
                sys.exit('Confira url e token em maquina.json e se MAQUINA_TOKEN está no .env do servidor.')
            time.sleep(5)
        except Exception as e:  # sem internet, Broadlink fora do ar: tenta de novo
            log(f'Falhou ({e}). Tentando de novo em 5 s.')
            dispositivo = None
            time.sleep(5)


def main():
    args = sys.argv[1:]
    acao = args[0] if args else 'rodar'
    config = ler_config()
    if acao == 'descobrir':
        descobrir()
    elif acao == 'aprender':
        aprender(config, args[1:])
    elif acao == 'testar' and len(args) == 2:
        mandar(conectar(config), config, args[1])
        log(f'Mandei {args[1]}.')
    elif acao == 'rodar':
        rodar(config)
    else:
        print(__doc__)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
