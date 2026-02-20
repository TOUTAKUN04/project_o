const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase();
  if (!value) return false;
  return value === '127.0.0.1'
    || value === '::1'
    || value === '::ffff:127.0.0.1';
}

function extractAuthToken(req) {
  const direct = req?.headers?.['x-overlay-webhook-token'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const authorization = req?.headers?.authorization;
  if (typeof authorization !== 'string') return '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match && match[1] ? match[1].trim() : '';
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  if (!a.length || !b.length || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function createWebhookServer({
  port,
  host = '127.0.0.1',
  maxBodyBytes = 1024 * 1024,
  requireLocal = true,
  authToken = '',
  authExemptPaths = [],
  rateLimitWindowMs = 60 * 1000,
  maxRequestsPerWindow = 120,
  log,
}) {
  let server;
  const routes = new Map();
  const requiredToken = typeof authToken === 'string' ? authToken.trim() : '';
  const rateWindow = Number.isFinite(rateLimitWindowMs) && rateLimitWindowMs > 0 ? rateLimitWindowMs : 60 * 1000;
  const rateMax = Number.isFinite(maxRequestsPerWindow) && maxRequestsPerWindow > 0 ? maxRequestsPerWindow : 120;
  const requestBuckets = new Map();
  const exemptPaths = new Set(
    Array.isArray(authExemptPaths)
      ? authExemptPaths.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
  );

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

  function hitRateLimit(remoteAddress, pathname) {
    const now = Date.now();
    const key = `${String(remoteAddress || '')}|${String(pathname || '')}`;
    const existing = requestBuckets.get(key);
    if (!existing || (now - existing.windowStartMs) >= rateWindow) {
      requestBuckets.set(key, { windowStartMs: now, count: 1 });
      if (requestBuckets.size > 2000) {
        for (const [bucketKey, bucket] of requestBuckets) {
          if ((now - bucket.windowStartMs) >= rateWindow * 2) requestBuckets.delete(bucketKey);
        }
      }
      return false;
    }
    existing.count += 1;
    return existing.count > rateMax;
  }

  function start() {
    if (server) return;
    server = http.createServer(async (req, res) => {
      try {
        const method = String(req.method || 'GET').toUpperCase();
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const remoteAddress = req?.socket?.remoteAddress || '';
        if (requireLocal && !isLoopbackAddress(remoteAddress)) {
          if (log) log('warn', 'webhook blocked non-local request', { remoteAddress });
          res.statusCode = 403;
          res.end('forbidden');
          return;
        }

        const authExempt = exemptPaths.has(url.pathname);
        if (requiredToken && !authExempt) {
          const incomingToken = extractAuthToken(req);
          if (!timingSafeEqualString(incomingToken, requiredToken)) {
            if (log) {
              log('warn', 'webhook authentication failed', {
                remoteAddress,
                path: url.pathname,
              });
            }
            res.statusCode = 401;
            res.end('unauthorized');
            return;
          }
        }

        const key = `${method} ${url.pathname}`;
        const handler = routes.get(key);
        if (!handler) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        if (hitRateLimit(remoteAddress, url.pathname)) {
          if (log) log('warn', 'webhook rate limit exceeded', { remoteAddress, path: url.pathname });
          res.statusCode = 429;
          res.end('too_many_requests');
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
    server.requestTimeout = 15000;
    server.headersTimeout = 16000;
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
