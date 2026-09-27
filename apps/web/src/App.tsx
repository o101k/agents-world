import { SettingsDialog } from './components/SettingsDialog.tsx';
import { WorldScreen } from './screens/WorldScreen.tsx';
import { WorldsScreen } from './screens/WorldsScreen.tsx';
import { useApp } from './store.ts';

export function App() {
  const { connection, loaded, activeWorldId, showWorldsScreen } = useApp();

  return (
    <>
      {connection === 'offline' && (
        <div className="banner banner-error" role="alert">
          Can’t reach the Agents World helper. Is it running? Start it with <code>npm start</code>{' '}
          in the project folder — this page reconnects automatically.
        </div>
      )}
      {!loaded ? (
        <div className="splash">
          <div className="splash-title">Agents World</div>
          <div className="muted">Connecting to the local helper…</div>
        </div>
      ) : activeWorldId && !showWorldsScreen ? (
        <WorldScreen key={activeWorldId} worldId={activeWorldId} />
      ) : (
        <WorldsScreen />
      )}
      <SettingsDialog />
    </>
  );
}
