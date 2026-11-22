import { useEffect, useState } from 'react';

const read = () => (document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light');

/** 'dark' or 'light', following the theme toggle in the top bar. */
export function useColorMode() {
  const [mode, setMode] = useState(read);

  useEffect(() => {
    const observer = new MutationObserver(() => setMode(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] });
    setMode(read());
    return () => observer.disconnect();
  }, []);

  return mode;
}