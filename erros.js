// Erro de API: vira { erro, mensagem } com o status HTTP (SPEC seção 10).
export function erro(status, codigo, mensagem, extra = {}) {
  return Object.assign(new Error(mensagem), { status, codigo, extra });
}
