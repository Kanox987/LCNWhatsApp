# src/api — stub da saída de mídia

Desligado por padrão. Ver ../../docs/API.md para habilitar (REST local ou webhook).
O evento interno `captura` saiu junto com a recuperação de visualização única;
`output.js` hoje só guarda o gancho `iniciarSaida`, que não faz nada enquanto `outputApi.enabled` for false.
