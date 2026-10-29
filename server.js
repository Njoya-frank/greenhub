const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 4173);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).reduce((values, line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) return values;

    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
    return values;
  }, {});
}

function loadEnvironment() {
  return {
    ...parseEnvFile(path.join(ROOT_DIR, '.env')),
    ...parseEnvFile(path.join(ROOT_DIR, '.env.local')),
    ...process.env
  };
}

function normalizeSupabaseUrl(value) {
  return String(value || '').trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

function isPublicSupabaseKey(value) {
  const key = String(value || '').trim();
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    return payload.role === 'anon' || payload.role === 'authenticated';
  } catch (error) {
    return false;
  }
}

function getSupabaseConfig() {
  const env = loadEnvironment();
  const publicKey = isPublicSupabaseKey(env.SUPABASE_ANON_KEY) ? env.SUPABASE_ANON_KEY : '';
  return {
    url: normalizeSupabaseUrl(env.SUPABASE_URL),
    anonKey: publicKey,
    authRedirectTo: env.SUPABASE_AUTH_REDIRECT_TO || ''
  };
}

function configScript() {
  return `window.GREENHUB_FILE_PROTOCOL = window.location.protocol === 'file:';\nwindow.GREENHUB_SUPABASE_CONFIG = Object.freeze(${JSON.stringify(getSupabaseConfig())});\n`;
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8'
};

function serveStaticFile(request, response) {
  const requestPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname);
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const filePath = path.resolve(ROOT_DIR, relativePath);

  if (relativePath.split('/').some((segment) => segment.startsWith('.'))) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  if (filePath !== ROOT_DIR && !filePath.startsWith(`${ROOT_DIR}${path.sep}`)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Could not read file');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentTypes[path.extname(filePath)] || 'application/octet-stream'
    });
    response.end(request.method === 'HEAD' ? undefined : contents);
  });
}

const server = http.createServer((request, response) => {
  const requestPath = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  if (requestPath === '/supabase-config.js') {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/javascript; charset=utf-8'
    });
    response.end(request.method === 'HEAD' ? undefined : configScript());
    return;
  }

  serveStaticFile(request, response);
});

server.listen(PORT, () => {
  const config = getSupabaseConfig();
  console.log(`Greenhub running at http://localhost:${PORT}`);
  console.log(`Supabase config: ${config.url && config.anonKey ? 'loaded from .env/.env.local' : 'not configured'}`);
});
