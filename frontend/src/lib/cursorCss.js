import { cursorColor } from './drawBoard.js';

// Text that ends up inside a CSS string must not be able to break out of it
const cssString = (value) =>
  String(value)
    .replace(/[\\"]/g, '\\$&')
    .replace(/[\r\n\u2028\u2029]/g, ' ')
    .slice(0, 40);

/**
 * Styles for other people's cursors in the code editor (the editor binding marks each
 * person's cursor with a class that contains their Yjs client id).
 * Names come from the server's list of people, and colors are computed here,
 * never taken from what another browser sends.
 */
export function buildCursorCss(states, myClientId, users) {
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const rules = [];
  states.forEach((state, clientId) => {
    if (clientId === myClientId || !Number.isInteger(clientId)) return;
    const userId = state?.user?.id;
    if (typeof userId !== 'string' || !nameById.has(userId)) return;
    const color = cursorColor(userId);
    const name = cssString(nameById.get(userId));
    rules.push(`.yRemoteSelection-${clientId}{background-color:${color};opacity:.3}`);
    rules.push(
      `.yRemoteSelectionHead-${clientId}{position:absolute;border-left:2px solid ${color};height:100%;box-sizing:border-box}`,
    );
    rules.push(
      `.yRemoteSelectionHead-${clientId}::after{content:"${name}";position:absolute;top:-1.4em;left:-2px;` +
        `padding:0 4px;font-size:11px;line-height:1.4;white-space:nowrap;color:#fff;background:${color};` +
        'border-radius:3px;pointer-events:none}',
    );
  });
  return rules.join('\n');
}