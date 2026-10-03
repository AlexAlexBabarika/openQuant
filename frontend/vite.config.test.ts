import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, loadConfigFromFile, type ViteDevServer } from 'vite';

describe('development API routing', () => {
  let backend: Server;
  let vite: ViteDevServer;
  let base: string;

  beforeAll(async () => {
    backend = createHttpServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          url: request.url,
          method: request.method,
          body,
          authorization: request.headers.authorization,
          cookie: request.headers.cookie,
        }),
      );
    });
    await new Promise<void>(resolve => backend.listen(0, '127.0.0.1', resolve));
    const target = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'test' },
      fileURLToPath(new URL('vite.config.ts', import.meta.url)),
    );
    const config = loaded!.config;
    const proxy = Object.fromEntries(
      Object.entries(config.server?.proxy ?? {}).map(([prefix, options]) => {
        expect(typeof options === 'string' ? options : options.target).toBe(
          'http://127.0.0.1:8000',
        );
        return [
          prefix,
          typeof options === 'string' ? target : { ...options, target },
        ];
      }),
    );
    vite = await createServer({
      ...config,
      configFile: false,
      root: fileURLToPath(new URL('.', import.meta.url)),
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        ...config.server,
        host: '127.0.0.1',
        port: 0,
        open: false,
        proxy,
      },
    });
    await vite.listen();
    base = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await vite?.close();
    if (backend) {
      await new Promise<void>((resolve, reject) => {
        backend.close(error => (error ? reject(error) : resolve()));
        backend.closeAllConnections();
      });
    }
  });

  it.each([
    ['GET', '/symbols/search?q=AAPL&limit=20'],
    ['POST', '/scripts'],
    ['PUT', '/strategies/42'],
    ['DELETE', '/sweeps/run-id'],
    ['POST', '/portfolio-backtests/run'],
    ['POST', '/datastore/ingest'],
    ['GET', '/trial/catalog'],
    ['POST', '/backtests/run'],
    ['POST', '/auth/refresh'],
    ['GET', '/user/me'],
    ['GET', '/data/ohlcv?symbol=AAPL'],
    ['GET', '/health'],
  ])('forwards %s %s to the backend, not the SPA', async (method, url) => {
    const body = ['POST', 'PUT'].includes(method) ? '{"code":"draft"}' : '';
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
        Cookie: 'refresh_token=test-cookie',
      },
      ...(body ? { body } : {}),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      url,
      method,
      body,
      authorization: 'Bearer test-token',
      cookie: 'refresh_token=test-cookie',
    });
  });

  it('keeps the workspace entry point on Vite', async () => {
    const response = await fetch(`${base}/`);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('/src/main.ts');
    expect(vite.config.server.proxy?.['/ws']).toMatchObject({ ws: true });
  });
});
