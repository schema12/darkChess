import { useState } from 'react';

export interface ConnectionPanelProps {
  defaultUrl?: string;
  defaultRoomId?: string;
  onConnect: (connection: { url: string; roomId: string }) => void;
  onCancel: () => void;
}

/**
 * 联机大厅：输入服务器地址与房间 ID 加入房间（创建=加入不存在的房间，
 * 服务器按需创建）。若本机存有该房间的重连令牌将自动恢复原座位。
 */
export function ConnectionPanel({
  defaultUrl = 'ws://localhost:8787',
  defaultRoomId = 'room-1',
  onConnect,
  onCancel,
}: ConnectionPanelProps) {
  const [url, setUrl] = useState(defaultUrl);
  const [roomId, setRoomId] = useState(defaultRoomId);

  return (
    <div className="lobby-card">
      <h2>三人联机</h2>
      <p className="lobby-hint">
        三个浏览器填相同的服务器与房间 ID；第三人加入后自动开局。中途刷新页面可用重连令牌恢复座位。
      </p>
      <label className="lobby-field">
        服务器
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={defaultUrl} />
      </label>
      <label className="lobby-field">
        房间 ID
        <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder={defaultRoomId} />
      </label>
      <div className="lobby-actions">
        <button type="button" disabled={url.trim().length === 0 || roomId.trim().length === 0} onClick={() => onConnect({ url: url.trim(), roomId: roomId.trim() })}>
          加入房间
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          返回
        </button>
      </div>
    </div>
  );
}
