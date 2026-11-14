import app from './app.js';
import config from './config.js';

const server = app.listen(config.port, () => {
  console.log(`LockStock API server listening on port ${config.port} (${config.nodeEnv})`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});
