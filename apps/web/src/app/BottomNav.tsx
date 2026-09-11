export type NavKey = 'home' | 'online' | 'settings';

/** 底部导航：仅壳页面（首页/联机/设置）显示；GamePage 沉浸式不显示。 */
export function BottomNav({ active, onSelect }: { active: NavKey; onSelect: (key: NavKey) => void }) {
  const items: ReadonlyArray<{ key: NavKey; label: string }> = [
    { key: 'home', label: '首页' },
    { key: 'online', label: '联机' },
    { key: 'settings', label: '设置' },
  ];
  return (
    <nav className="bottom-nav">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          className={it.key === active ? 'nav-item active' : 'nav-item'}
          onClick={() => onSelect(it.key)}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
