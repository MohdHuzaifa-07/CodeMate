/**
 * Splits an answer into plain text and ``` code blocks, so code can be shown in a box.
 * Everything stays plain text: nothing in an answer is ever treated as HTML.
 */
export function splitAnswer(text) {
  const parts = [];
  const fence = /```[^\n`]*\n?([\s\S]*?)(?:```|$)/g; // an unfinished block (a cut-off answer) runs to the end
  let last = 0;
  let match;
  while ((match = fence.exec(text)) !== null) {
    if (match[0] === '') {
      fence.lastIndex += 1;
      continue;
    }
    if (match.index > last) parts.push({ type: 'text', text: text.slice(last, match.index) });
    parts.push({ type: 'code', text: match[1].replace(/\n$/, '') });
    last = fence.lastIndex;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts.filter((p) => p.text.trim() !== '');
}