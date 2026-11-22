import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Board, BOARD_WIDTH, BOARD_HEIGHT } from '../src/board/board.js';

const stroke = (over = {}) => ({
  id: crypto.randomUUID(),
  type: 'pencil',
  color: '#112233',
  size: 3,
  point: [10, 20],
  ...over,
});

test('begin creates an element owned by the user', () => {
  const board = new Board();
  const data = stroke({ color: '#AABBCC', point: [10.26, 20.04] });
  const res = board.begin('u1', data);
  assert.equal(res.ok, true);
  assert.equal(res.element.ownerId, 'u1');
  assert.equal(res.element.color, '#aabbcc');
  assert.deepEqual(res.element.points, [[10.3, 20]]);
});

test('begin rejects bad input', () => {
  const board = new Board();
  const code = (over) => board.begin('u1', stroke(over)).code;
  assert.equal(code({ id: 'x' }), 'BAD_ID');
  assert.equal(code({ type: 'circle' }), 'BAD_TYPE');
  assert.equal(code({ color: 'red' }), 'BAD_COLOR');
  assert.equal(code({ size: 0 }), 'BAD_SIZE');
  assert.equal(code({ size: 31 }), 'BAD_SIZE');
  assert.equal(code({ point: [-1, 5] }), 'BAD_POINT');
  assert.equal(code({ point: [BOARD_WIDTH + 1, 5] }), 'BAD_POINT');
  assert.equal(code({ point: [5, BOARD_HEIGHT + 1] }), 'BAD_POINT');
  assert.equal(code({ point: ['a', 'b'] }), 'BAD_POINT');
  assert.equal(board.begin('u1', null).code, 'BAD_ID');
  const first = stroke();
  board.begin('u1', first);
  assert.equal(board.begin('u1', first).code, 'DUPLICATE_ID');
});

test('pencil strokes grow; lines and rectangles keep exactly two points', () => {
  const board = new Board();
  const pencil = stroke();
  const line = stroke({ type: 'line' });
  board.begin('u1', pencil);
  board.begin('u1', line);

  assert.deepEqual(board.extend('u1', pencil.id, [[1, 1], [2, 2]]).points, [[1, 1], [2, 2]]);
  assert.equal(board.elements[0].points.length, 3);

  board.extend('u1', line.id, [[5, 5]]);
  board.extend('u1', line.id, [[6, 6], [7, 7]]);
  assert.deepEqual(board.elements[1].points, [[10, 20], [7, 7]]);
});

test('only the owner can extend a stroke', () => {
  const board = new Board();
  const s = stroke();
  board.begin('u1', s);
  assert.equal(board.extend('u2', s.id, [[1, 1]]).code, 'NOT_OWNER');
  assert.equal(board.extend('u1', 'nope-nope-nope', [[1, 1]]).code, 'NOT_FOUND');
  assert.equal(board.elements[0].points.length, 1);
});

test('extend rejects bad batches and over-long strokes', () => {
  const board = new Board({ maxPointsPerElement: 4 });
  const s = stroke();
  board.begin('u1', s);
  assert.equal(board.extend('u1', s.id, []).code, 'BAD_POINTS');
  assert.equal(board.extend('u1', s.id, 'x').code, 'BAD_POINTS');
  assert.equal(board.extend('u1', s.id, Array(201).fill([1, 1])).code, 'BAD_POINTS');
  assert.equal(board.extend('u1', s.id, [[1, 1], [-5, 1]]).code, 'BAD_POINT');
  assert.equal(board.elements[0].points.length, 1, 'a bad batch must not be partly applied');
  assert.equal(board.extend('u1', s.id, [[1, 1], [2, 2], [3, 3]]).ok, true);
  assert.equal(board.extend('u1', s.id, [[4, 4]]).code, 'TOO_LONG');
});

test('the board has a maximum number of elements', () => {
  const board = new Board({ maxElements: 2 });
  board.begin('u1', stroke());
  board.begin('u1', stroke());
  assert.equal(board.begin('u1', stroke()).code, 'BOARD_FULL');
});

test('undo removes only your own latest stroke, redo brings it back', () => {
  const board = new Board();
  const a1 = stroke();
  const b1 = stroke();
  const a2 = stroke();
  board.begin('alice', a1);
  board.begin('bob', b1);
  board.begin('alice', a2);

  assert.equal(board.undo('alice').id, a2.id);
  assert.deepEqual(board.elements.map((e) => e.id), [a1.id, b1.id]);
  assert.equal(board.undo('alice').id, a1.id);
  assert.equal(board.undo('alice').code, 'NOTHING_TO_UNDO');
  assert.deepEqual(board.elements.map((e) => e.id), [b1.id], "Bob's stroke is untouched");

  assert.equal(board.redo('alice').element.id, a1.id);
  assert.equal(board.redo('alice').element.id, a2.id);
  assert.equal(board.redo('alice').code, 'NOTHING_TO_REDO');
  assert.equal(board.redo('bob').code, 'NOTHING_TO_REDO');
});

test('drawing something new clears your redo history', () => {
  const board = new Board();
  board.begin('alice', stroke());
  board.undo('alice');
  board.begin('alice', stroke());
  assert.equal(board.redo('alice').code, 'NOTHING_TO_REDO');
});

test('clear wipes elements and redo history', () => {
  const board = new Board();
  board.begin('alice', stroke());
  board.undo('alice');
  board.begin('bob', stroke());
  board.clear();
  assert.equal(board.elements.length, 0);
  assert.equal(board.redo('alice').code, 'NOTHING_TO_REDO');
  assert.equal(board.redo('bob').code, 'NOTHING_TO_REDO');
  assert.deepEqual(board.snapshot(), { width: BOARD_WIDTH, height: BOARD_HEIGHT, elements: [] });
});