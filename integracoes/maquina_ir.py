#!/usr/bin/env python3
"""Manda o código da vez para a máquina de karaokê por infravermelho (SPEC 10.5).

Roda num aparelho ao lado da máquina (Android com Termux, ou um computador) na mesma
rede Wi-Fi de um emissor de infravermelho: Broadlink (RM4 Mini, RM Mini 3...) ou
controle universal Tuya / Smart Life. Só fala com o app para fora (consulta
GET /api/maquina/comando); a máquina recebe só a música da vez, nunca a fila.

Uso:
  python maquina_ir.py descobrir          procura o emissor na rede
  python maquina_ir.py aprender [teclas]  grava as teclas do controle (padrão: 0-9, reservar, parar)
  python maquina_ir.py testar 1234        manda um código sem passar pelo app
  python maquina_ir.py rodar              consulta o app e manda cada código da vez

Arquivos ao lado do script: maquina.json (configuração), codigos.json (teclas aprendidas),
ultimo_comando.txt (último comando enviado, para não repetir ao reiniciar) e, no Tuya,
devices.json (gerado por `python -m tinytuya wizard`, com a chave local do aparelho).
"""
import base64
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PASTA = Path(__file__).resolve().parent
ARQ_CONFIG = PASTA / 'maquina.json'
ARQ_CODIGOS = PASTA / 'codigos.json'
ARQ_ULTIMO = PASTA / 'ultimo_comando.txt'
ARQ_TUYA = PASTA / 'devices.json'

PADRAO = {
    'url': '',                       # endereço da festa, ex.: https://karaoke.seudominio.com.br
    'token': '',                     # MAQUINA_TOKEN do .env do servidor
    'tipo': 'auto',                  # broadlink, tuya ou auto (tuya se existir devices.json)
    'ip': '',                        # IP do emissor; vazio = procurar na rede (só Broadlink)
    'tuya_id': '',                   # vazio = o controle IR do devices.json
    'tuya_versao': '',               # vazio = a do devices.json, ou 3.3
    'sequencia': ['digitos', 'reservar'],  # o que apertar para cada código; 'digitos' = um por um
    'intervalo_teclas': 0.5,         # segundos entre uma tecla e outra
    'consulta_segundos': 2,
}
TECLAS_PADRAO = [str(d) for d in range(10)] + ['reservar', 'parar']
VERSOES_TUYA = ['3.3', '3.4', '3.5', '3.1']
CATEGORIA_IR_TUYA = 'wnykq'  # "controle universal" na Tuya


def log(msg):
    print(time.strftime('%H:%M:%S'), msg, flush=True)


def ler_config():
    if not ARQ_CONFIG.exists():
        ARQ_CONFIG.write_text(json.dumps(PADRAO, indent=2, ensure_ascii=False) + '\n')
        log(f'Criei {ARQ_CONFIG.name}: preencha url e token e rode de novo.')
    config = {**PADRAO, **json.loads(ARQ_CONFIG.read_text())}
    config['ip'] = config['ip'] or config.get('broadlink_ip', '')
    if config['tipo'] == 'auto':
        config['tipo'] = 'tuya' if ARQ_TUYA.exists() else 'broadlink'
    return config


def ler_codigos():
    return json.loads(ARQ_CODIGOS.read_text()) if ARQ_CODIGOS.exists() else {}


class Broadlink:
    def __init__(self, config):
        import broadlink
        if config['ip']:
            self.dispositivo = broadlink.hello(config['ip'])
        else:
            achados = broadlink.discover(timeout=5)
            if not achados:
                raise RuntimeError('Nenhum Broadlink encontrado. Ele está ligado e no mesmo Wi-Fi? Tente pôr o IP em "ip".')
            self.dispositivo = achados[0]
        self.dispositivo.auth()

    def aprender(self, segundos):
        from broadlink.exceptions import ReadError, StorageError
        self.dispositivo.enter_learning()
        fim = time.time() + segundos
        while time.time() < fim:
            time.sleep(1)
            try:
                return base64.b64encode(self.dispositivo.check_data()).decode()
            except (ReadError, StorageError):
                pass
        return None

    def enviar(self, codigo):
        self.dispositivo.send_data(base64.b64decode(codigo))

    @staticmethod
    def descobrir(config):
        import broadlink
        achados = broadlink.discover(timeout=5, discover_ip_address=config['ip'] or '255.255.255.255')
        if not achados:
            log('Nenhum Broadlink encontrado.')
        for d in achados:
            log(f'{d.type} {d.model or ""} em {d.host[0]}  (bloqueado: {"sim" if d.is_locked else "não"})')


def aparelho_tuya(config):
    if not ARQ_TUYA.exists():
        raise RuntimeError(f'Falta {ARQ_TUYA.name}. Rode nesta pasta: python -m tinytuya wizard')
    aparelhos = json.loads(ARQ_TUYA.read_text())
    if config['tuya_id']:
        escolhidos = [a for a in aparelhos if a.get('id') == config['tuya_id']]
    else:
        escolhidos = [a for a in aparelhos if a.get('category') == CATEGORIA_IR_TUYA] or aparelhos
    if len(escolhidos) != 1:
        nomes = ', '.join(f'{a.get("name")} ({a.get("id")})' for a in aparelhos)
        raise RuntimeError(f'Não sei qual aparelho usar. Ponha o id em "tuya_id". Aparelhos: {nomes}')
    return escolhidos[0]


class Tuya:
    def __init__(self, config):
        from tinytuya.Contrib import IRRemoteControlDevice
        aparelho = aparelho_tuya(config)
        ip = config['ip'] or aparelho.get('ip')
        if not ip:
            raise RuntimeError('Ponha o IP do controle em "ip" no maquina.json.')
        versao = float(config['tuya_versao'] or aparelho.get('version') or 3.3)
        self.ir = IRRemoteControlDevice(aparelho['id'], ip, aparelho['key'], version=versao, persist=True,
                                         connection_retry_limit=2, connection_retry_delay=1)
        if not self.ir.control_type:
            raise RuntimeError(f'O controle em {ip} não respondeu. Confira o IP e rode "descobrir" para achar a versão.')

    def aprender(self, segundos):
        codigo = self.ir.receive_button(timeout=segundos)
        return codigo if isinstance(codigo, str) else None

    def enviar(self, codigo):
        self.ir.send_button(codigo)

    @staticmethod
    def descobrir(config):
        import tinytuya
        aparelho = aparelho_tuya(config)
        ip = config['ip'] or aparelho.get('ip')
        log(f'{aparelho.get("name")} ({aparelho.get("id")}, categoria {aparelho.get("category")})')
        if not ip:
            log('  sem IP: ponha o IP do controle em "ip" no maquina.json.')
            return
        for versao in VERSOES_TUYA:
            estado = tinytuya.Device(aparelho['id'], ip, aparelho['key'], version=float(versao),
                                    connection_retry_limit=1, connection_retry_delay=1).status()
            if isinstance(estado, dict) and 'dps' in estado:
                log(f'  respondeu em {ip} com a versão {versao}. Ponha "tuya_versao": "{versao}" se não for a do devices.json.')
                return
        log(f'  não respondeu em {ip} com nenhuma versão ({", ".join(VERSOES_TUYA)}). Confira o IP e a chave.')


TIPOS = {'broadlink': Broadlink, 'tuya': Tuya}


def tipo(config):
    if config['tipo'] not in TIPOS:
        sys.exit(f'"tipo" no {ARQ_CONFIG.name} deve ser broadlink, tuya ou auto.')
    return TIPOS[config['tipo']]


def aprender(config, teclas):
    emissor = tipo(config)(config)
    codigos = ler_codigos()
    for tecla in teclas or TECLAS_PADRAO:
        log(f'Aponte o controle para o emissor e aperte: {tecla}  (30 s; sem resposta, pula)')
        codigo = emissor.aprender(30)
        if codigo is None:
            log(f'  {tecla}: nada recebido, pulei.')
            continue
        codigos[tecla] = codigo
        ARQ_CODIGOS.write_text(json.dumps(codigos, indent=2) + '\n')
        log(f'  {tecla}: gravada.')
    log(f'Pronto. Teclas em {ARQ_CODIGOS.name}: {", ".join(codigos)}')


def teclas_do_codigo(config, cod):
    teclas = []
    for passo in config['sequencia']:
        teclas.extend(list(cod) if passo == 'digitos' else [passo])
    return teclas


def mandar(emissor, config, cod):
    codigos = ler_codigos()
    teclas = teclas_do_codigo(config, cod)
    faltando = [t for t in teclas if t not in codigos]
    if faltando:
        raise RuntimeError(f'Faltam teclas aprendidas: {", ".join(sorted(set(faltando)))}. Rode: aprender {" ".join(sorted(set(faltando)))}')
    for tecla in teclas:
        emissor.enviar(codigos[tecla])
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
    emissor = None
    log(f'Esperando a vez de alguém... (emissor: {config["tipo"]})')
    while True:
        try:
            comando = consultar(config, feito)
            if comando and comando['id'] != feito:
                emissor = emissor or tipo(config)(config)
                log(f'Mandando {comando["cod"]} ({comando["titulo"]} · {comando["cantor"]})')
                mandar(emissor, config, comando['cod'])
                feito = comando['id']
                ARQ_ULTIMO.write_text(feito)
                log('  enviado.')
            time.sleep(config['consulta_segundos'])
        except urllib.error.HTTPError as e:
            log(f'O app respondeu {e.code}: {e.read().decode(errors="replace")}')
            if e.code in (401, 404):
                sys.exit('Confira url e token em maquina.json e se MAQUINA_TOKEN está no .env do servidor.')
            time.sleep(5)
        except Exception as e:  # sem internet, emissor fora do ar: tenta de novo
            log(f'Falhou ({e}). Tentando de novo em 5 s.')
            emissor = None
            time.sleep(5)


def main():
    args = sys.argv[1:]
    acao = args[0] if args else 'rodar'
    config = ler_config()
    if acao == 'descobrir':
        tipo(config).descobrir(config)
    elif acao == 'aprender':
        aprender(config, args[1:])
    elif acao == 'testar' and len(args) == 2:
        mandar(tipo(config)(config), config, args[1])
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
