import { useState } from 'react';
import type { AppSettings } from '../settings';

/**
 * 设置页（信息架构落地）：游戏/声音/外观/联机/关于 五分组。
 * 当前实装：声音开关与音量、默认服务器；其余为占位（灰显，不可点）。
 */
export function SettingsPage({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
}) {
  const [server, setServer] = useState(settings.defaultServer);

  return (
    <div className="page">
      <h2 className="page-title">设置</h2>

      <section className="settings-group">
        <h3>游戏</h3>
        <div className="settings-row disabled">
          <span>操作提示</span>
          <span className="placeholder-tag">预留</span>
        </div>
        <div className="settings-row disabled">
          <span>动画</span>
          <span className="placeholder-tag">预留</span>
        </div>
      </section>

      <section className="settings-group">
        <h3>声音</h3>
        <div className="settings-row">
          <span>音效</span>
          <button
            type="button"
            className={settings.soundOn ? 'toggle on' : 'toggle'}
            onClick={() => onChange({ ...settings, soundOn: !settings.soundOn })}
          >
            {settings.soundOn ? '开' : '关'}
          </button>
        </div>
        <div className="settings-row">
          <span>音量</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            disabled={!settings.soundOn}
            onChange={(e) => onChange({ ...settings, volume: Number(e.target.value) })}
          />
        </div>
      </section>

      <section className="settings-group">
        <h3>外观</h3>
        <div className="settings-row disabled">
          <span>主题 / 棋子样式</span>
          <span className="placeholder-tag">预留</span>
        </div>
      </section>

      <section className="settings-group">
        <h3>联机</h3>
        <div className="settings-row column">
          <span>默认服务器地址</span>
          <div className="inline-edit">
            <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="ws://192.168.x.x:8787" />
            <button
              type="button"
              className="secondary-btn"
              onClick={() => onChange({ ...settings, defaultServer: server.trim() })}
            >
              保存
            </button>
          </div>
          <span className="page-hint">留空恢复默认（自动使用当前页面的主机名）。</span>
        </div>
      </section>

      <section className="settings-group">
        <h3>关于</h3>
        <div className="settings-row">
          <span>版本</span>
          <span>v0.3.0-ws-client + UI IA</span>
        </div>
        <div className="settings-row">
          <span>项目</span>
          <span>DarkChess · 可扩展棋类平台</span>
        </div>
      </section>
    </div>
  );
}
