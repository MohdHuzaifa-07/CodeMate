// Same ids as the backend (backend/src/code/languages.js) and as Monaco's language ids.
export const LANGUAGES = [
  ['javascript', 'JavaScript'],
  ['python', 'Python 3'],
  ['c', 'C'],
  ['cpp', 'C++'],
];

export const languageLabel = (id) => LANGUAGES.find(([value]) => value === id)?.[1] ?? id;