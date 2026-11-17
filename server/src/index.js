/**
 * Arranque standalone para Render o servidor Node local.
 * En Vercel el entry point es `api/[...route].js`.
 */
import { createServer } from 'node:http';
import { handleApiRequest } from './app.js';
import { hasDatabase } from './db.js';

const PORT = Number(process.env.PORT || 3000);

const server = createServer((req, res) => {
  handleApiRequest(req, res).catch((err) => {
    const status = err.status || 500;
    console.error('[api-error]', err);
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message || 'Error interno' }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`[papercrash-api] escuchando en puerto ${PORT} (Neon: ${hasDatabase() ? 'configurado' : 'pendiente DATABASE_URL'})`);
});
