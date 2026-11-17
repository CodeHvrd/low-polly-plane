/**
 * Vercel Serverless Catch-All Function (`/api/*`).
 * Reutiliza el mismo router liviano en Node.js de `server/src/app.js`.
 */
import { handleApiRequest } from '../server/src/app.js';

export default async function handler(req, res) {
  try {
    await handleApiRequest(req, res);
  } catch (err) {
    const status = err.status || 500;
    console.error('[vercel-api-error]', err);
    if (!res.headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: err.message || 'Error interno' }));
    }
  }
}
