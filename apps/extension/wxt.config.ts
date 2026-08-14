import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  outDir: 'output',
  manifest: ({ manifestVersion }) => ({
    name: 'Aitomate',
    description: 'Collaborative, AI-assisted test automation for any web app',
    permissions: ['storage', 'activeTab', 'tabs', 'webNavigation', 'webRequest'],
    // Network-error capture (FR-5) observes request outcomes via webRequest;
    // MV3 requires host permissions for the URLs observed.
    host_permissions: ['<all_urls>'],
    // Upload replay (T2.4) fetches bundled fixtures from the content script;
    // without this the chrome-extension:// fetch is blocked. Fixtures are
    // public test data by definition — never put secrets in fixtures/.
    web_accessible_resources:
      manifestVersion === 2
        ? ['fixtures/*']
        : [{ resources: ['fixtures/*'], matches: ['<all_urls>'] }],
  }),
});
