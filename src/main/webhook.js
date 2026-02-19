const http = require('http');
const { URL } = require('url');

function createWebhookServer({ port, host = '127.0.0.1', maxBodyBytes = 1024 * 1024, log }) {
  let server;
  const routes = new Map();

  function register(method, routePath, handler) {
    routes.set(`${String(method || '').toUpperCase()} ${routePath}`, handler);
  }

  async function invokeHandler(handler, context) {
    try {
      await handler(context);
    } catch (error) {
      if (log) log('error', 'webhook handler failed', { error: String(error) });
      if (!context.res.headersSent) {
        context.res.statusCode = 500;
        context.res.end('error');
      }
    }
  }

  function start() {
    if (server) return;
    server = http.createServer(async (req, res) => {
      try {
        const method = String(req.method || 'GET').toUpperCase();
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const key = `${method} ${url.pathname}`;
        const handler = routes.get(key);
        if (!handler) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        if (method === 'GET' || method === 'HEAD') {
          await invokeHandler(handler, { req, res, url, body: '' });
          return;
        }

        let body = '';
        let bodyBytes = 0;
        let finished = false;
        const done = (statusCode, message) => {
          if (finished) return;
          finished = true;
          if (!res.headersSent) {
            res.statusCode = statusCode;
            res.end(message);
          }
        };

        req.on('error', (error) => {
          if (log) log('warn', 'webhook request error', { error: String(error) });
          done(400, 'bad request');
        });

        req.on('aborted', () => {
          done(400, 'aborted');
        });

        req.on('data', (chunk) => {
          if (finished) return;
          bodyBytes += chunk.length;
          if (bodyBytes > maxBodyBytes) {
            done(413, 'payload_too_large');
            try {
              req.destroy();
            } catch {
              // ignore
            }
            return;
          }
          body += chunk.toString('utf8');
        });

        req.on('end', async () => {
          if (finished) return;
          finished = true;
          await invokeHandler(handler, { req, res, url, body });
        });
      } catch (error) {
        if (log) log('error', 'webhook server error', { error: String(error) });
        res.statusCode = 500;
        res.end('error');
      }
    });

    server.on('error', (error) => {
      if (log) log('error', 'webhook server failed', { error: String(error) });
    });
    server.listen(port, host, () => {
      if (log) log('info', 'webhook server started', { host, port });
    });
  }

  function stop() {
    if (!server) return;
    server.close();
    server = null;
  }

  return {
    register,
    start,
    stop,
  };
}

module.exports = { createWebhookServer };
