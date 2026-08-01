import { useState } from 'react';
import RunView from './views/RunView';
import BuildView from './views/BuildView';
import SettingsView from './views/SettingsView';
import { isSidePanelSupported, openSidePanel } from '@/lib/sidepanel';

export type ShellView = 'run' | 'build' | 'settings';

const TABS: { id: ShellView; label: string }[] = [
  { id: 'run', label: 'Run' },
  { id: 'build', label: 'Build' },
  { id: 'settings', label: 'Settings' },
];

export interface AppShellProps {
  /** Popup is width-constrained; side panel can use full column height. */
  variant?: 'popup' | 'sidepanel';
}

// Default view is Run — least intimidating for the PO persona (spec §3.8).
export default function AppShell({ variant = 'popup' }: AppShellProps) {
  const [view, setView] = useState<ShellView>('run');
  // Set by RunView's "Edit" button, consumed by BuildView to load an
  // already-imported scenario's steps + meta back into the editor. Owned
  // here (not in either view) since it's the thing that both crosses views
  // and switches which one is active.
  const [editScenarioId, setEditScenarioId] = useState<string | null>(null);

  const handleEditScenario = (id: string) => {
    setEditScenarioId(id);
    setView('build');
  };

  const handleOpenSidePanel = async () => {
    try {
      await openSidePanel();
      window.close(); // dismiss the popup; the panel replaces it
    } catch (error) {
      console.warn('[aitomate] could not open side panel', error);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: variant === 'popup' ? 360 : '100%',
        height: variant === 'sidepanel' ? '100vh' : undefined,
        fontFamily: 'system-ui, sans-serif',
        color: '#1a1a1a',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px 8px',
          borderBottom: '1px solid #e5e5e5',
        }}
      >
        <h1 style={{ fontSize: 15, margin: 0, fontWeight: 600 }}>Aitomate</h1>
        {variant === 'popup' && isSidePanelSupported() && (
          <button
            onClick={handleOpenSidePanel}
            title="Open in side panel"
            style={{
              fontSize: 12,
              padding: '2px 8px',
              border: '1px solid #ccc',
              borderRadius: 6,
              background: '#fff',
              color: '#333',
              cursor: 'pointer',
            }}
          >
            Side panel
          </button>
        )}
      </header>

      <nav
        aria-label="Aitomate sections"
        style={{ display: 'flex', borderBottom: '1px solid #e5e5e5' }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            aria-current={view === tab.id ? 'page' : undefined}
            onClick={() => setView(tab.id)}
            style={{
              flex: 1,
              padding: '8px 0',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: view === tab.id ? 600 : 400,
              color: view === tab.id ? '#1a1a1a' : '#777',
              borderBottom: view === tab.id ? '2px solid #1a1a1a' : '2px solid transparent',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
        {view === 'run' && <RunView onEdit={handleEditScenario} />}
        {view === 'build' && (
          <BuildView
            editScenarioId={editScenarioId}
            onEditConsumed={() => setEditScenarioId(null)}
          />
        )}
        {view === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
