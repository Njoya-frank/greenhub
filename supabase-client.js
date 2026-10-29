(function initializeGreenhubSupabase() {
  const STORAGE_BUCKET = 'greenhub';
  const config = window.GREENHUB_SUPABASE_CONFIG || {};
  const supabaseUrl = String(config.url || '').trim().replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
  const configured = !window.GREENHUB_FILE_PROTOCOL && Boolean(supabaseUrl && config.anonKey && window.supabase);

  window.GreenhubDB = {
    configured,
    client: configured
      ? window.supabase.createClient(supabaseUrl, config.anonKey, {
        global: {
          fetch: (input, init = {}) => window.fetch(input, { ...init, cache: 'no-store' })
        }
      })
      : null
  };

  window.GreenhubStorage = {
    bucket: STORAGE_BUCKET,
    publicUrl(path) {
      if (!configured || !path) return '';
      const { data } = window.GreenhubDB.client.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      return data?.publicUrl || '';
    },
    resolveUrl(url, path) {
      const generatedUrl = this.publicUrl(path);
      if (generatedUrl) return generatedUrl;
      return String(url || '').replace('/storage/v1/object/greenhub/', '/storage/v1/object/public/greenhub/');
    }
  };
})();
