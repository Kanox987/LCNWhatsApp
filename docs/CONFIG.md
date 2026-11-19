# config.json

Editável pelo painel (`lcn` > Configurações) ou à mão. O bot recarrega a quente
(`fs.watch`) e aplica na próxima mensagem — sem reconectar. Só
`hardware.logLevel`/`hardware.markOnline` (usados na criação do socket) disparam
uma reconexão leve quando mudam.

> A recuperação de visualização única foi retirada (o WhatsApp mudou o
> tratamento desses arquivos). Os campos `destino` e `captura` eram dela e não
> são mais usados; se ainda estiverem no seu `config.json`, são ignorados.

```jsonc
{
  "hardware": {
    "markOnline": false,             // não aparecer "online" p/ quem envia
    "logLevel": "silent",
    "maxMidiaMB": 60,                // ignora mídia acima disso
    "downloadConcorrencia": 2,       // downloads simultâneos
    "modoEconomia": true,
    "debug": false                   // loga cada mensagem recebida (diagnóstico)
  },
  "transcricao": {
    "provedor": "off",               // off | faster-whisper | openai | custom
    "modelo": "base", "idioma": "pt",
    "pythonBin": "",                 // faster-whisper: caminho do python do venv (gravado pelo instalador); vazio = usa LCN_PYTHON ou "python3" do PATH
    "openaiApiKey": "", "openaiModelo": "whisper-1",
    "comando": "",                   // custom: usa {file} como caminho do áudio
    "comandoTerceiros": false,       // padrão geral: só o dono pode usar /transcrever
    "conversas": [                   // overrides por conversa (número ou ID de grupo)
      { "id": "5511999999999", "auto": true, "comandoTerceiros": null }
    ]
  },
  "download": {                      // baixar link de mídia por um serviço externo
    "api": "http://127.0.0.1:8765",  // endereço do serviço (só loopback)
    "tokenArquivo": "/app/.ytdlp-token",  // arquivo com o token; NUNCA o token aqui
    "modoPadrao": "auto",            // auto | video | audio | thumbnail
    "limiteMB": 64,                  // acima disso, recusa antes de transferir
    "esperaMaximaSegundos": 300      // passou disso, CANCELA o trabalho no serviço
  },
  "atualizacao": { "autoUpdateLib": false, "falhasParaUpdate": 5 },
  "outputApi": { "enabled": false, "host": "127.0.0.1", "porta": 8787, "token": "" }
}
```

- **download**: o serviço que baixa link de mídia. `esperaMaximaSegundos` é
  quanto o bot espera antes de desistir — e desistir **cancela o trabalho no
  serviço** (`POST /jobs/{job}/cancelar`), em vez de largar a vaga ocupada: como
  o serviço roda poucos downloads ao mesmo tempo, largar dois trabalhos travados
  parava a fila para todo mundo. O serviço também derruba sozinho o download que
  fica 90s sem avançar.
- **download.tokenArquivo**: o token fica em ARQUIVO, e não aqui, para não
  entrar em backup de configuração por acidente.

  > Esta seção continua valendo, e é o caminho para quem tem terminal. Mas ela
  > deixou de ser o único: o mesmo serviço aparece agora na aba **Conexões** do
  > painel, com endereço, credencial e as funções que dá para pedir a ele. Quem
  > administra pelo painel — o caso de quem não tem acesso ao terminal —
  > configura por lá, e pode colar a chave em vez de apontar um arquivo. A
  > conexão que já vem pronta aponta para o mesmo `tokenArquivo` daqui, sem
  > copiar o segredo para o banco.

- **hardware.debug**: liga logs detalhados de cada mensagem recebida — útil pra
  diagnosticar "mandei e o bot não reagiu". Ver [SOLUCAO-DE-PROBLEMAS.md](SOLUCAO-DE-PROBLEMAS.md).
- **hardware.logLevel**: nível de log da `zapo-js` (`silent` em produção; `warn`/`error`
  ajuda a ver falhas de descriptografia). Mudança exige reconexão.
- **transcricao.conversas**: lista de overrides por conversa. `auto: true` liga
  transcrição automática de todo áudio normal ali (responde na própria conversa).
  `comandoTerceiros: true/false` sobrepõe o padrão geral só pra essa conversa;
  `null`/ausente usa `transcricao.comandoTerceiros`. Editável em `lcn` >
  Configurações > Transcrição por conversa.
