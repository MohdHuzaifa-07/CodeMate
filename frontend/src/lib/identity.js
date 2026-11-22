// The browser's secret id for the backend. It is kept per tab (sessionStorage), so
// a refresh keeps your seat in the room, and two tabs behave like two different people.
const CLIENT_KEY = 'codemate.clientId';
const NAME_KEY = 'codemate.name';

export const NAME_MAX = 30;

let fallbackClientId = null; // used only if the browser blocks storage

export function getClientId() {
  try {
    let id = sessionStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    fallbackClientId ??= crypto.randomUUID();
    return fallbackClientId;
  }
}

export function getSavedName() {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // not saving the name is fine
  }
}

export const cleanName = (value) => value.trim().slice(0, NAME_MAX);