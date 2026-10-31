const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = __dirname;
const OUTPUT_DIR = path.join(ROOT_DIR, 'dist');
const STATIC_FILES = [
  'index.html',
  'admin.html',
  'styles.css',
  'admin.css',
  'app.js',
  'admin.js',
  'supabase-client.js'
];

function normalizeSupabaseUrl(value) {
  return String(value || '').trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
}

function isPublicSupabaseKey(value) {
  const key = String(value || '').trim();
  if (!key) return true;
  if (key.startsWith('sb_publishable_')) return true;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    return payload.role === 'anon' || payload.role === 'authenticated';
  } catch {
    return false;
  }
}

function createSupabaseConfig() {
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '').trim();
  if (!isPublicSupabaseKey(anonKey)) {
    throw new Error('SUPABASE_ANON_KEY must be the public anon/publishable key, never a service-role key.');
  }
  return `window.GREENHUB_FILE_PROTOCOL = window.location.protocol === 'file:';\nwindow.GREENHUB_SUPABASE_CONFIG = Object.freeze(${JSON.stringify({
    url: normalizeSupabaseUrl(process.env.SUPABASE_URL),
    anonKey,
    authRedirectTo: String(process.env.SUPABASE_AUTH_REDIRECT_TO || '').trim()
  })});\n`;
}

fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (const file of STATIC_FILES) {
  fs.copyFileSync(path.join(ROOT_DIR, file), path.join(OUTPUT_DIR, file));
}

fs.writeFileSync(path.join(OUTPUT_DIR, 'supabase-config.js'), createSupabaseConfig());
console.log(`Prepared ${STATIC_FILES.length + 1} static files in ${path.relative(ROOT_DIR, OUTPUT_DIR)}/`);
