// Chaves de atributo que o SISTEMA usa, e que automação nenhuma pode escrever.
//
// A convenção já existia — `owners.js` diz, em comentário, que o prefixo `__`
// "deixa claro que não é variável comum de usuário". Só que era comentário: nada
// no código impedia a escrita, e as consequências eram reais.
//
// A pior delas nem exigia adulterar documento nenhum:
//
//     PUT /api/v1/entities/contact/<jid>/attributes/__owner__   {"value": true}
//
// promovia qualquer contato a dono. E o caminho inverso é igualmente ruim: uma
// automação comum gravando a string "true" (em vez do booleano) em `__owner__`
// faz `ehDono()` parar de reconhecer um dono de verdade — revoga acesso de quem
// já tinha, o que é pior que conceder, porque acontece em silêncio.
//
// Isto NÃO tira poder de ninguém. Os caminhos legítimos continuam abertos:
// `POST /owners` grava `__owner__` por `definirDono`, e a configuração de menu
// grava `__menu_config__` pela ação dedicada. Ambos chamam o acesso de baixo
// nível direto, não a rota genérica nem `action.variable.set`.
//
// DELIBERADAMENTE DE FORA: `grupo_ativo` (o portão de grupo) não tem prefixo
// `__` e continua gravável. É o /ativar que a escreve, por `define chat
// grupo_ativo` num .lcn — blindá-la trancaria o portão com a chave do lado de
// dentro. Que ela seja forjável por outra automação é limitação conhecida:
// resolver exige uma marca de "só o dono grava", não um prefixo.
export const PREFIXO_RESERVADO = '__'

export function ehChaveReservada (chave) {
  return typeof chave === 'string' && chave.startsWith(PREFIXO_RESERVADO)
}

// A mesma frase nos dois lugares que recusam, para quem leu uma reconhecer a
// outra. Diz o que fazer, não só o que não fazer.
export function motivoDeRecusa (chave) {
  return `A chave "${chave}" é reservada do sistema (prefixo "${PREFIXO_RESERVADO}") e não pode ser gravada assim. ` +
    'Para marcar um dono use a tela de Donos; para o menu, o comando de configuração de menu. ' +
    'Escolha outro nome para a sua variável.'
}
