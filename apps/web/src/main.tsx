import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadSettings } from './settings';
import { soundManager } from './audio/soundManager';
import './styles.css';

// 启动时应用持久化设置（音效开关/音量）。
const settings = loadSettings();
soundManager.configure({ enabled: settings.soundOn, volume: settings.volume });

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');

createRoot(container).render(<App />);
