// Languages people can pick, and how JDoodle names them.
export const LANGUAGES = {
  javascript: { label: 'JavaScript', jdoodle: { language: 'nodejs', versionIndex: '4' } },
  python: { label: 'Python 3', jdoodle: { language: 'python3', versionIndex: '4' } },
  c: { label: 'C', jdoodle: { language: 'c', versionIndex: '5' } },
  cpp: { label: 'C++', jdoodle: { language: 'cpp17', versionIndex: '1' } },
};

export const DEFAULT_LANGUAGE = 'javascript';

export const isSupportedLanguage = (value) =>
  typeof value === 'string' && Object.hasOwn(LANGUAGES, value);