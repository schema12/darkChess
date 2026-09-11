/**
 * SoundManager / AudioManager：集中管理音效，不散落在棋盘组件中。
 * 第一版使用 Web Audio 合成简单占位音效（无外部素材）；
 * 后续替换正式音效只需改本模块（资源层），调用方无需改动。
 */
export type SoundEvent = 'reveal' | 'move' | 'capture' | 'win' | 'draw';

export interface SoundManager {
  play(event: SoundEvent): void;
  /** 开关与音量（设置页实装；音量为增益乘数 0–1）。 */
  configure(options: { enabled?: boolean; volume?: number }): void;
}

export function createSoundManager(): SoundManager {
  let ctx: AudioContext | null = null;
  let enabled = true;
  let volume = 1;

  function ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume();
      return ctx;
    }
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }

  function tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    gain = 0.12,
    delay = 0,
  ): void {
    if (!enabled || volume <= 0) return;
    const c = ensureContext();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const peak = Math.max(0.0001, gain * volume);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  return {
    play(event) {
      switch (event) {        case 'reveal':
          tone(660, 0.09, 'triangle', 0.12);
          break;
        case 'move':
          tone(440, 0.08, 'sine', 0.1);
          break;
        case 'capture':
          tone(200, 0.14, 'square', 0.09);
          break;
        case 'win':
          tone(523.25, 0.12, 'triangle', 0.13, 0);
          tone(659.25, 0.12, 'triangle', 0.13, 0.12);
          tone(783.99, 0.22, 'triangle', 0.13, 0.24);
          break;
        case 'draw':
          tone(392, 0.16, 'sine', 0.11, 0);
          tone(311.13, 0.24, 'sine', 0.11, 0.16);
          break;
      }
    },
    configure(options) {
      if (options.enabled !== undefined) enabled = options.enabled;
      if (options.volume !== undefined) volume = Math.min(1, Math.max(0, options.volume));
    },
  };
}

/** 单例，供应用内共享。 */
export const soundManager: SoundManager = createSoundManager();
