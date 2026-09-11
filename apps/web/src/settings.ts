/**
 * 客户端设置（localStorage 持久化，不引入数据库）。
 * 当前实装项：音效开关、音量、默认联机服务器；其余为占位。
 */

export interface AppSettings {
  /** 音效开关（soundManager 实装）。 */
  soundOn: boolean;
  /** 音量 0–1（soundManager 增益乘数）。 */
  volume: number;
  /** 默认联机服务器（如 ws://192.168.x.x:8787）。 */
  defaultServer: string;
}

const KEY = 'darkchess:settings';

/** 由当前页面地址推导默认服务器：同主机名 + 服务器端口。 */
export function defaultServerUrl(): string {
  if (typeof window === 'undefined' || !window.location?.hostname) return 'ws://localhost:8787';
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.hostname}:8787`;
}

const FALLBACK: AppSettings = {
  soundOn: true,
  volume: 1,
  defaultServer: defaultServerUrl(),
};

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return { ...FALLBACK };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...FALLBACK };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      soundOn: parsed.soundOn ?? FALLBACK.soundOn,
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : FALLBACK.volume,
      defaultServer: parsed.defaultServer ?? FALLBACK.defaultServer,
    };
  } catch {
    return { ...FALLBACK };
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 存储不可用时静默降级。
  }
}
