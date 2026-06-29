import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Aitomate',
    description: 'Collaborative, AI-assisted test automation for any web app',
    permissions: ['storage', 'activeTab', 'tabs', 'webNavigation'],
  },
});
