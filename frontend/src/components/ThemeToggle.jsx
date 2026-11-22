import { useTheme } from '../lib/useTheme.js';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className="btn btn-outline-secondary btn-sm" onClick={toggle} aria-label={`Switch to ${next} mode`}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}