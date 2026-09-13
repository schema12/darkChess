import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createDarkChess4x8Mode,
  createDarkChess3p4x8Mode,
} from '@darkchess/core';
import { NULL_CONNECTION, useLocalGame, useOnlineGame } from './game/useGame';
import type { OnlineConnection } from './game/useGame';
import { BottomNav } from './app/BottomNav';
import type { NavKey } from './app/BottomNav';
import { HomePage } from './app/HomePage';
import { OnlinePage } from './app/OnlinePage';
import { RoomPage } from './app/RoomPage';
import { SettingsPage } from './app/SettingsPage';
import { GameView } from './ui/GameView';
import { loadSettings, saveSettings, defaultServerUrl } from './settings';
import type { AppSettings } from './settings';
import { soundManager } from './audio/soundManager';

type Screen =
  | { readonly kind: 'home' }
  | { readonly kind: 'online' }
  | { readonly kind: 'room'; readonly mode: '2p' | '3p'; readonly scanEntry?: boolean }
  | { readonly kind: 'settings' }
  // 沉浸式对局页：无底部导航，Header 返回。
  | { readonly kind: 'local-game'; readonly players: '2p' | '3p' }
  | { readonly kind: 'online-game' };

/** 扫码/分享链接的 URL 参数（?room=X&mode=2p|3p）：读取一次后即从地址栏清除。 */
function readJoinParams(): { roomId: string; mode: '2p' | '3p' } | null {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  const room = p.get('room');
  const mode = p.get('mode') === '2p' ? '2p' : p.get('mode') === '3p' ? '3p' : null;
  return room && mode ? { roomId: room, mode } : null;
}

const INITIAL_SETTINGS = loadSettings();

export function App() {
  const initialJoin = useMemo(() => readJoinParams(), []);
  const [screen, setScreen] = useState<Screen>(() =>
    initialJoin ? { kind: 'room', mode: initialJoin.mode } : { kind: 'home' },
  );
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  // 联机会话提升到 App 层：房间页与对局页共享同一控制器。
  const [onlineConn, setOnlineConn] = useState<OnlineConnection | null>(null);
  const online = useOnlineGame(
    onlineConn?.mode === '2p' ? 'dark-chess-4x8' : 'dark-chess-3p-4x8',
    onlineConn ?? NULL_CONNECTION,
  );

  const updateSettings = (next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
    soundManager.configure({ enabled: next.soundOn, volume: next.volume });
  };

  // 等待房间收到权威状态（满员开局）→ 自动进入对局页。
  useEffect(() => {
    if (screen.kind === 'room' && online.state !== null) {
      setScreen({ kind: 'online-game' });
    }
  }, [screen.kind, online.state]);

  // 扫码/分享链接：挂载后自动加入一次（URL 由当前主机名推导），随后清理地址栏。
  const autoJoinFired = useRef(false);
  useEffect(() => {
    if (!initialJoin || autoJoinFired.current) return;
    autoJoinFired.current = true;
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setOnlineConn({
      url: defaultServerUrl(),
      roomId: initialJoin.roomId,
      mode: initialJoin.mode,
    });
  }, [initialJoin]);

  const exitOnline = () => {
    setOnlineConn(null); // effect 清理关闭会话
    setScreen({ kind: 'online' });
  };

  const navKey: NavKey =
    screen.kind === 'online' || screen.kind === 'room' || screen.kind === 'online-game'
      ? 'online'
      : screen.kind === 'settings'
        ? 'settings'
        : 'home';

  const shell = screen.kind === 'home' || screen.kind === 'online' || screen.kind === 'settings';

  return (
    <main className={shell ? 'app shell' : 'app immersive'}>
      {screen.kind === 'home' ? (
        <HomePage
          onLocal={(players) => setScreen({ kind: 'local-game', players })}
          onOnline={() => setScreen({ kind: 'online' })}
        />
      ) : screen.kind === 'online' ? (
        <OnlinePage
          game={online}
          onEnter2p={() => setScreen({ kind: 'room', mode: '2p' })}
          onEnter3p={() => setScreen({ kind: 'room', mode: '3p' })}
          onEnterScan={() => setScreen({ kind: 'room', mode: '3p', scanEntry: true })}
          onReturnToRoom={
            online.online && online.online.playerId !== '' && online.online.status !== 'closed'
              ? () =>
                  setScreen(
                    online.state
                      ? { kind: 'online-game' }
                      : { kind: 'room', mode: onlineConn?.mode ?? '3p' },
                  )
              : null
          }
        />
      ) : screen.kind === 'room' ? (
        <RoomPage
          game={online}
          settings={settings}
          mode={screen.mode}
          allowModeSelect={screen.scanEntry === true}
          scanGuidance={screen.scanEntry === true}
          autoJoin={!!initialJoin}
          defaultRoomId={initialJoin?.roomId}
          onJoin={(conn) =>
            setOnlineConn({
              ...conn,
              mode: conn.mode ?? screen.mode,
              timerSec: conn.timerSec,
              url: normalizeServerUrl(conn.url),
            })
          }
          onExit={exitOnline}
        />
      ) : screen.kind === 'settings' ? (
        <SettingsPage settings={settings} onChange={updateSettings} />
      ) : screen.kind === 'local-game' ? (
        <LocalGameScreen players={screen.players} onExit={() => setScreen({ kind: 'home' })} />
      ) : (
        <OnlineGameScreen game={online} onExit={exitOnline} onSettings={() => setScreen({ kind: 'settings' })} />
      )}

      {shell ? <BottomNav active={navKey} onSelect={(key) => setScreen({ kind: key })} /> : null}
    </main>
  );
}

/** 服务器地址规范化：无协议时按页面协议补 ws/wss；空值回退到页面主机名推导。 */
function normalizeServerUrl(raw: string): string {
  const value = raw.trim();
  if (value === '') return defaultServerUrl();
  if (/^wss?:\/\//i.test(value)) return value;
  const scheme = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${value}`;
}

/** 本地对局页：组件挂载即创建会话；返回首页即结束本局。 */
function LocalGameScreen({ players, onExit }: { players: '2p' | '3p'; onExit: () => void }) {
  const createMode = useMemo(
    () => (players === '3p' ? createDarkChess3p4x8Mode : createDarkChess4x8Mode),
    [players],
  );
  const game = useLocalGame(createMode);
  return (
    <GameView
      game={game}
      modeLabel={players === '3p' ? '本地·三人' : '本地·双人'}
      onExit={onExit}
      onSettings={onExit}
    />
  );
}

/** 联机对局页：控制器由 App 持有（房间页与对局页共享同一会话）。 */
function OnlineGameScreen({
  game,
  onExit,
  onSettings,
}: {
  game: ReturnType<typeof useOnlineGame>;
  onExit: () => void;
  onSettings: () => void;
}) {
  return (
    <GameView
      game={game}
      modeLabel={game.mode.id === 'dark-chess-3p-4x8' ? '联机·三人' : '联机·双人'}
      onExit={onExit}
      onSettings={onSettings}
    />
  );
}
