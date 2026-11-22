import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';

const REMOTE = 'remote'; // marks changes that came from the server, so we never send them back

const toBytes = (value) =>
  value instanceof Uint8Array ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);

/**
 * Keeps this browser's copy of the shared code file in step with the server.
 * The text is a Yjs document: every change is a small update that is sent to the room,
 * and updates from other people are merged in, so nobody's typing is lost.
 * It also shares where everybody's cursor is (Yjs "awareness").
 * The editor (Monaco) only displays this text; it does not own it.
 */
export class CodeSync {
  constructor(socket) {
    this.socket = socket;
    this.doc = new Y.Doc();
    this.ytext = this.doc.getText('code');
    this.awareness = new Awareness(this.doc);
    this.attached = false;

    this.onDocUpdate = (update, origin) => {
      if (origin !== REMOTE) this.socket.emit('code:update', { update });
    };
    this.onRemoteUpdate = ({ update }) => Y.applyUpdate(this.doc, toBytes(update), REMOTE);
    this.onAwarenessChange = ({ added, updated, removed }, origin) => {
      if (origin === REMOTE) {
        // Someone new showed up. They may have missed my earlier cursor message, so answer once.
        if (added.length > 0) this.sendOwnAwareness();
        return;
      }
      if (origin !== 'local') return; // only share my own cursor
      this.socket.volatile.emit('code:awareness', {
        update: encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]),
      });
    };
    this.onRemoteAwareness = ({ update }) => {
      try {
        applyAwarenessUpdate(this.awareness, toBytes(update), REMOTE);
      } catch {
        // ignore a broken cursor message
      }
    };
    // A newcomer does not know where my cursor is yet: tell them
    this.onUserJoined = () => this.sendOwnAwareness();
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessChange);
    this.socket.on('code:update', this.onRemoteUpdate);
    this.socket.on('code:awareness', this.onRemoteAwareness);
    this.socket.on('room:user-joined', this.onUserJoined);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessChange);
    this.socket.off('code:update', this.onRemoteUpdate);
    this.socket.off('code:awareness', this.onRemoteAwareness);
    this.socket.off('room:user-joined', this.onUserJoined);
  }

  destroy() {
    this.detach();
    this.awareness.destroy();
    this.doc.destroy();
  }

  /**
   * The server's copy of the file, sent when we join (and again after a reconnect).
   * If we typed something while we were offline, the server has not seen it yet, so send just that.
   */
  applySnapshot(snapshot) {
    const update = toBytes(snapshot.update);
    Y.applyUpdate(this.doc, update, REMOTE);
    const missing = Y.encodeStateAsUpdate(this.doc, Y.encodeStateVectorFromUpdate(update));
    if (missing.byteLength > 2) this.socket.emit('code:update', { update: missing });
    this.sendOwnAwareness();
  }

  /** Who I am, so others can label my cursor. */
  setIdentity({ id }) {
    this.awareness.setLocalStateField('user', { id });
  }

  sendOwnAwareness() {
    if (this.awareness.getLocalState() === null) return;
    this.socket.volatile.emit('code:awareness', {
      update: encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
    });
  }

  /** Forget the cursors of people who are no longer in the room. */
  pruneAwareness(users) {
    const present = new Set(users.map((u) => u.id));
    const stale = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId !== this.doc.clientID && state?.user && !present.has(state.user.id)) stale.push(clientId);
    });
    if (stale.length) removeAwarenessStates(this.awareness, stale, REMOTE);
  }
}