import * as Y from 'yjs';
import { DEFAULT_LANGUAGE, isSupportedLanguage } from './languages.js';

const MAX_UPDATE_BYTES = 64 * 1024;
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const SIZE_CHECK_EVERY = 50;
const RUN_WINDOW_MS = 60_000;

const ok = (extra = {}) => ({ ok: true, ...extra });
const no = (code, message) => ({ ok: false, code, message });

/** Accepts what Socket.IO delivers for binary data and returns a plain Uint8Array, or null. */
export function toBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

/**
 * The shared code file of one room.
 * The text lives in a Yjs document: every browser keeps its own copy and
 * they merge automatically, so two people typing at once never lose edits.
 * This class also remembers the chosen language and the last run.
 */
export class CodeSession {
  constructor({ maxChars = 100_000 } = {}) {
    this.maxChars = maxChars;
    this.doc = new Y.Doc();
    this.ytext = this.doc.getText('code');
    this.language = DEFAULT_LANGUAGE;
    this.updateCount = 0;
    this.locked = false;
    // run bookkeeping
    this.running = null; // id of the run in progress
    this.runTimes = [];
    this.lastRun = null;
  }

  get text() {
    return this.ytext.toString();
  }

  setLanguage(language) {
    if (!isSupportedLanguage(language)) return no('BAD_LANGUAGE', 'Unsupported language');
    this.language = language;
    return ok();
  }

  /**
   * Applies a Yjs update from a client.
   * If the file ends up too long, the extra tail is cut off and `fix` is the
   * update that every client must also apply to stay identical.
   */
  applyUpdate(raw) {
    const update = toBytes(raw);
    if (!update) return no('BAD_UPDATE', 'Update must be binary data');
    if (update.byteLength > MAX_UPDATE_BYTES) return no('UPDATE_TOO_LARGE', 'That change is too large');
    if (this.locked) return no('DOC_TOO_LARGE', 'This code file has grown too large');

    try {
      Y.applyUpdate(this.doc, update);
    } catch {
      return no('BAD_UPDATE', 'Could not read that update');
    }

    let fix = null;
    const over = this.ytext.length - this.maxChars;
    if (over > 0) {
      const before = Y.encodeStateVector(this.doc);
      this.doc.transact(() => this.ytext.delete(this.maxChars, over));
      fix = Y.encodeStateAsUpdate(this.doc, before);
    }

    this.updateCount += 1;
    if (this.updateCount % SIZE_CHECK_EVERY === 0 && Y.encodeStateAsUpdate(this.doc).byteLength > MAX_DOC_BYTES) {
      this.locked = true;
    }
    return ok({ fix });
  }

  checkRunAllowed({ now = Date.now(), perMinute = 5 } = {}) {
    if (this.running) return no('RUN_IN_PROGRESS', 'A run is already in progress');
    this.runTimes = this.runTimes.filter((t) => now - t < RUN_WINDOW_MS);
    if (this.runTimes.length >= perMinute) {
      return no('RUN_RATE_LIMITED', 'This room is running code too often, wait a moment');
    }
    return ok();
  }

  startRun(id, now = Date.now()) {
    this.running = id;
    this.runTimes.push(now);
  }

  finishRun(result) {
    this.running = null;
    this.lastRun = result;
  }

  snapshot() {
    return {
      language: this.language,
      update: Y.encodeStateAsUpdate(this.doc),
      running: Boolean(this.running),
      lastRun: this.lastRun,
    };
  }
}