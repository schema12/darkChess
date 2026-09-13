import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { GameController } from '../game/useGame';
import { peekStoredToken } from '../game/useGame';
import { friendlyConnectError } from '../ui/friendly';
import { defaultServerUrl } from '../settings';
import type { AppSettings } from '../settings';

/**
 * 联机房间页（原 ConnectionPanel 的正式化）：
 * 服务器 / 房间 ID 表单 + 座位列表 + 等待/重连状态。
 * 连接建立后由 App 自动切换到 GamePage（权威状态到达即开局）。
 */
export function RoomPage({
  game,
  settings,
  mode,
  autoJoin = false,
  defaultRoomId = 'room-1',
  onJoin,
  onExit,
}: {
  game: GameController;
  settings: AppSettings;
  mode: '2p' | '3p';
  /** 扫码/分享链接进入：挂载即自动加入（一次性）。 */
  autoJoin?: boolean;
  /** 扫码 URL 携带的房间号（作为表单预填与自动加入目标）。 */
  defaultRoomId?: string;
  onJoin: (connection: { url: string; roomId: string; timerSec?: number }) => void;
  onExit: () => void;
}) {
  const maxPlayers = mode === '3p' ? 3 : 2;
  const online = game.online;
  // 表单仅在空闲态显示；'connecting'/'open'/'waiting'/'playing' 均视为已发起连接。
  const connecting =
    online !== null && online.status !== 'closed' && online.status !== 'idle';
  const [url, setUrl] = useState(settings.defaultServer);
  const [roomId, setRoomId] = useState(defaultRoomId);
  // 计时策略（好友房可选）：undefined = 不限时；创建房间的一方决定，后加入者沿用房间策略。
  const [timerSec, setTimerSec] = useState<number | undefined>(undefined);
  const hasToken = peekStoredToken(url.trim(), mode, roomId.trim());

  // —— 扫码加入（房主等待页）：二维码内容 = 本页面 URL + 房间/模式参数 ——
  // 手机扫码 → 浏览器直接打开加入页（App 从 URL 参数自动进入对应房间）。
  // 主机名默认取当前页面地址；若房主用 localhost 打开页面，则从游戏服务器
  // /lan 端点取局域网 IPv4 候选供选择（不猜、不写死）。
  const isLocalHost = /^localhost$|^127\./.test(window.location.hostname);
  const [lanCandidates, setLanCandidates] = useState<readonly string[]>([]);
  const [qrHost, setQrHost] = useState<string>(window.location.hostname);
  useEffect(() => {
    if (!isLocalHost) return;
    const httpBase = settings.defaultServer.replace(/^ws/, 'http');
    fetch(`${httpBase}/lan`)
      .then((r) => r.json())
      .then((d: { addresses?: string[] }) => {
        if (d.addresses?.length) {
          setLanCandidates(d.addresses);
          setQrHost(d.addresses[0]!);
        }
      })
      .catch(() => undefined);
  }, [isLocalHost, settings.defaultServer]);

  const webPort = window.location.port ? `:${window.location.port}` : '';
  const joinUrl = `http://${qrHost}${webPort}/?room=${encodeURIComponent(roomId.trim())}&mode=${mode}`;
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(joinUrl, { margin: 1, width: 220, color: { dark: '#2b2118', light: '#f7ecd6' } })
      .then((url: string) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [joinUrl]);

  const seatList = online?.roomPlayers ?? [];
  const connectedCount = seatList.filter((p) => p.connected).length;

  // 扫码进入：自动加入一次（失败时错误会显示在本页，可改参数重试）。
  const autoJoinFired = useRef(false);
  useEffect(() => {
    if (!autoJoin || autoJoinFired.current) return;
    autoJoinFired.current = true;
    onJoin({ url: defaultServerUrl(), roomId: defaultRoomId });
  }, [autoJoin, defaultRoomId, onJoin]);

  return (
    <div className="page">
      <h2 className="page-title">联机·{mode === '3p' ? '三人' : '双人'}</h2>

      {!connecting ? (
        <div className="room-form">
          <label className="field">
            <span>服务器</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="ws://192.168.x.x:8787" />
          </label>
          <label className="field">
            <span>房间</span>
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="room-1" />
          </label>
          <label className="field">
            <span>回合计时（创建房间时生效；加入已有房间以房主设置为准）</span>
            <select
              value={timerSec === undefined ? 'off' : String(timerSec)}
              onChange={(e) => setTimerSec(e.target.value === 'off' ? undefined : Number(e.target.value))}
            >
              <option value="off">不限时</option>
              <option value="30">30 秒</option>
              <option value="60">60 秒</option>
              <option value="90">90 秒</option>
              <option value="120">120 秒</option>
            </select>
          </label>
          <button
            type="button"
            className="primary-btn"
            disabled={url.trim().length === 0 || roomId.trim().length === 0}
            onClick={() => onJoin({ url: url.trim(), roomId: roomId.trim(), timerSec })}
          >
            加入房间
          </button>
          {hasToken && url.trim() && roomId.trim() ? (
            <p className="page-hint ok">检测到本机重连令牌，加入后将恢复原座位。</p>
          ) : null}
          <button type="button" className="secondary-btn" onClick={onExit}>
            返回
          </button>
        </div>
      ) : (
        <div className="room-form">
          <p className="page-hint">
            服务器 <b>{url}</b> · 房间 <b>{online?.roomId || roomId}</b>
          </p>
          {online?.config ? (
            <p className="page-hint ok">
              房间配置（房主决定）：
              {online.config.modeId === 'dark-chess-3p-4x8' ? '三人' : '双人'} ·{' '}
              {online.config.timerSec !== null ? `每回合 ${online.config.timerSec} 秒` : '不限时'}
            </p>
          ) : null}
          {online?.lastError ? (
            <p className="page-hint error">{friendlyConnectError(online.lastError)}</p>
          ) : null}
          <ul className="seat-list">
            {seatList.map((p) => (
              <li key={p.playerId} className={p.connected ? 'seat on' : 'seat off'}>
                <span className="dot">{p.connected ? '●' : '○'}</span>
                {p.connected ? `玩家 ${p.playerId}` : '等待玩家'}
                {p.connected && p.eliminated ? '（已淘汰）' : ''}
              </li>
            ))}
            {seatList.length === 0 ? <li className="seat off">连接中…</li> : null}
          </ul>
          {qrDataUrl ? (
            <div className="qr-section">
              <h3>扫码加入</h3>
              <img className="qr-img" src={qrDataUrl} alt="扫码加入房间" />
              <p className="page-hint">房间号：{roomId}</p>
            </div>
          ) : null}
          <p className="page-hint">
            {online?.status === 'playing'
              ? '游戏即将开始'
              : `等待其他玩家...（${connectedCount}/${maxPlayers}）`}
          </p>
          <button type="button" className="secondary-btn" onClick={onExit}>
            退出房间
          </button>
        </div>
      )}
    </div>
  );
}
