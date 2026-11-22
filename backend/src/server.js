import { config } from './config.js';
import { buildServer } from './app.js';

const { httpServer } = buildServer(config);
httpServer.listen(config.port, () => {
  console.log(`CodeMate backend listening on http://localhost:${config.port}`);
});