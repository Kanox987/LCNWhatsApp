// Config do PM2 para o modo "seco" (sem container). Opcional.
// Uso:  pm2 start ecosystem.config.cjs   |   pm2 logs LCNWhatsApp
module.exports = {
  apps: [
    {
      name: 'LCNWhatsApp',
      script: 'index.js',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '400M',   // segura o consumo de RAM
      restart_delay: 2000,
      env: { NODE_ENV: 'production' }
    }
  ]
}
