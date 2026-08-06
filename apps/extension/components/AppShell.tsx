import { useState } from 'react';
import { browser } from 'wxt/browser';
import RunView from './views/RunView';
import BuildView from './views/BuildView';
import SettingsView from './views/SettingsView';
import { isSidePanelSupported, openSidePanel } from '@/lib/sidepanel';
import { IconAitomateLogo, IconCode, IconPanelLeft, IconPlay, IconProps, IconSettings } from './ui/icons';
import '@/assets/styles.css';

export type ShellView = 'run' | 'build' | 'settings';

const TABS: { id: ShellView; label: string; icon: React.ComponentType<IconProps> }[] = [
  { id: 'run', label: 'Run', icon: IconPlay },
  { id: 'build', label: 'Build', icon: IconCode },
  { id: 'settings', label: 'Settings', icon: IconSettings },
];

export interface AppShellProps {
  /** Popup is width-constrained; side panel can use full column height. */
  variant?: 'popup' | 'sidepanel';
}

// Default view is Run — least intimidating for the PO persona (spec §3.8).
export default function AppShell({ variant = 'popup' }: AppShellProps) {
  const [view, setView] = useState<ShellView>('run');
  const [editScenarioId, setEditScenarioId] = useState<string | null>(null);

  const handleEditScenario = (id: string) => {
    setEditScenarioId(id);
    setView('build');
  };

  const handleOpenSidePanel = async () => {
    try {
      await openSidePanel();
      window.close();
    } catch (error) {
      console.warn('[aitomate] could not open side panel', error);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: variant === 'popup' ? 380 : '100%',
        minHeight: variant === 'popup' ? 520 : undefined,
        height: variant === 'sidepanel' ? '100vh' : undefined,
        background: 'var(--bg-app)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        overflow: 'hidden',
      }}
    >
      {/* Sleek Top Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'rgba(19, 25, 36, 0.95)',
          backdropFilter: 'blur(10px)',
          borderBottom: '1px solid var(--border-subtle)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconAitomateLogo size={22} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em', color: '#fff' }}>
                Aitomate
              </span>
              <span className="ait-badge ait-badge-primary" style={{ fontSize: 9, padding: '1px 5px' }}>
                v{browser.runtime.getManifest().version}
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              AI Test Automation
            </div>
          </div>
        </div>

        {variant === 'popup' && isSidePanelSupported() && (
          <button
            onClick={handleOpenSidePanel}
            className="ait-btn ait-btn-secondary ait-btn-sm"
            title="Open in side panel for full height view"
            style={{ fontSize: 11, padding: '4px 9px' }}
          >
            <IconPanelLeft size={13} />
            <span>Side Panel</span>
          </button>
        )}
      </header>

      {/* High-Tech Tab Bar */}
      <nav
        aria-label="Aitomate sections"
        style={{
          display: 'flex',
          background: 'var(--bg-app)',
          borderBottom: '1px solid var(--border-subtle)',
          padding: '4px 8px 0',
          gap: 4,
        }}
      >
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = view === tab.id;
          return (
            <button
              key={tab.id}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => setView(tab.id)}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 12px 10px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                position: 'relative',
                transition: 'all 0.2s ease',
              }}
            >
              <Icon size={14} color={isActive ? 'var(--accent-primary)' : 'currentColor'} />
              <span>{tab.label}</span>
              {isActive && (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 12,
                    right: 12,
                    height: 2,
                    background: 'var(--accent-gradient)',
                    borderRadius: '2px 2px 0 0',
                    boxShadow: '0 0 8px var(--accent-primary)',
                  }}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Main View Container */}
      <main
        style={{
          flex: 1,
          padding: 16,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
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
