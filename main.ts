// sokoban-push-optimal: a push-optimal Sokoban solver, written from scratch for
// make.fun's sokoban-solver-01-run-20261121.
//
// Idea: the generated levels decompose. A one-square hallway runs across the board
// and every room hangs off it through a single door; a box pushed out of a door
// into the hallway can never come back, so every box stays in its room and the
// level's optimum is the sum of its rooms' optima. The solver therefore splits
// each level into rooms and solves every room push-optimally on its own, then
// stitches the rooms together with the player's walks along the hallway.
//
// Each room is solved with A* over pushes. A search node is the boxes' squares
// plus the region the player can reach (named by its lowest square); a move is a
// single push, so the first solved node A* pops is push-optimal for the room.
// The estimate is the cheapest assignment of boxes to goals (every permutation
// tried, distances by breadth-first search over open floor), which never
// overestimates: one push moves one box one square. Dead states are pruned two
// ways: a box on a square from which no goal is reachable by pushing, and a box
// frozen in a 2x2 block of walls and boxes. (A box merely hemmed in by other
// boxes that can still move is not dead: it frees up once they move, so it is
// never pruned.) Everything is budgeted by work counted in states, never by the
// clock, so two runs write the same bytes.
//
// Local run: mkdir -p out && MAKEFUN_INPUT_DIR=practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The four steps: [dx, dy, the walk letter, the push letter]. */
const STEPS = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
] as const;

/** Work budgets, counted in states, so the program is deterministic. */
const ROOM_ASTAR_EXPANSIONS = 300_000;
const ROOM_BFS_STATES = 400_000;
const WHOLE_ASTAR_EXPANSIONS = 500_000;
const WHOLE_BFS_STATES = 600_000;

/** A parsed level. */
interface Board {
  w: number;
  h: number;
  /** 1 is a wall, 0 is open floor. */
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
}

/** Parse XSB text (# wall, space floor, . goal, $ box, * box on a goal, @ player). */
function parseLevel(text: string): Board {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  // The outermost frame is wall whatever it shows: nothing leaves the board.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  boxes.sort((a, b) => a - b);
  goals.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}

/**
 * The squares from which a box can be pushed onto some goal, by pulling back
 * from the goals over open floor: a box on square y reaches a goal when the
 * player can stand behind it (y - d) and push it toward the goal.
 */
function liveSquares(board: Board): Uint8Array {
  const { w, wall, goals } = board;
  const live = new Uint8Array(wall.length);
  const queue = [...goals];
  for (const g of goals) live[g] = 1;
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi];
    for (const [dx, dy] of STEPS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * Breadth-first distances from every goal over open floor (boxes ignored).
 * dist[g][s] is the steps from square s to goal g, or -1 when unreachable.
 */
function goalDistances(board: Board): Int32Array[] {
  const { w, wall, goals } = board;
  const out: Int32Array[] = [];
  for (const g of goals) {
    const dist = new Int32Array(wall.length).fill(-1);
    const queue = [g];
    dist[g] = 0;
    for (let qi = 0; qi < queue.length; qi++) {
      const p = queue[qi];
      for (const [dx, dy] of STEPS) {
        const q = p + dy * w + dx;
        if (!wall[q] && dist[q] < 0) {
          dist[q] = dist[p] + 1;
          queue.push(q);
        }
      }
    }
    out.push(dist);
  }
  return out;
}

/** All orderings of n goal indices, for the assignment estimate. */
function permutations(n: number): number[][] {
  const base = Array.from({ length: n }, (_, i) => i);
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      walk([...prefix, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)]);
    }
  };
  walk([], base);
  return out;
}

/** A room: its floor squares, boxes and goals. */
interface Room {
  squares: number[];
  boxes: number[];
  goals: number[];
  done?: boolean;
}

/**
 * Split a level into rooms: cut the dead squares of the player's row (the
 * hallway: a box there reaches no goal) out of the floor, and each connected
 * part left that holds boxes is a room. Null when the level is no set of rooms
 * (a box starts in the cut hallway, a goal lands in it, or a part's boxes and
 * goals do not match), in which case the caller solves the whole level.
 */
function roomsOf(board: Board): Room[] | null {
  const { w, wall, goals, boxes, player } = board;
  const live = liveSquares(board);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) {
    if (!wall[i] && !live[i]) cut[i] = 1;
  }
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of STEPS) {
        const q = squares[i] + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ squares, boxes: [], goals: [] });
  }
  for (const b of boxes) rooms[part[b]].boxes.push(b);
  for (const g of goals) if (part[g] >= 0) rooms[part[g]].goals.push(g);
  if (goals.some((g) => part[g] < 0)) return null;
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** A binary heap ordered by [f, h, insertion order]: smallest first. */
class Heap {
  private items: [number, number, number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  private static less(a: [number, number, number, number], b: [number, number, number, number]): boolean {
    return a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  }
  push(entry: [number, number, number, number]): void {
    const items = this.items;
    items.push(entry);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!Heap.less(items[i], items[p])) break;
      [items[i], items[p]] = [items[p], items[i]];
      i = p;
    }
  }
  pop(): [number, number, number, number] {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= items.length) break;
        if (c + 1 < items.length && Heap.less(items[c + 1], items[c])) c++;
        if (!Heap.less(items[c], items[i])) break;
        [items[i], items[c]] = [items[c], items[i]];
        i = c;
      }
    }
    return top;
  }
}

/**
 * The squares the player reaches from `from` with `occupied` in the way,
 * stamped into `seen` with `stamp`; returns the region's lowest square.
 */
function reachRegion(
  board: Board,
  occupied: Uint8Array,
  from: number,
  seen: Int32Array,
  stamp: number,
): number {
  const { w, wall } = board;
  const stack = [from];
  seen[from] = stamp;
  let low = from;
  while (stack.length > 0) {
    const p = stack.pop()!;
    if (p < low) low = p;
    for (const [dx, dy] of STEPS) {
      const q = p + dy * w + dx;
      if (!wall[q] && !occupied[q] && seen[q] !== stamp) {
        seen[q] = stamp;
        stack.push(q);
      }
    }
  }
  return low;
}

/**
 * Whether the box just pushed to `t` is stuck in a frozen 2x2 block: four
 * squares of walls and boxes, one of them a box off its goal. No box in such a
 * block can ever move again.
 */
function inFrozenBlock(
  board: Board,
  occupied: Uint8Array,
  goalSet: Uint8Array,
  t: number,
): boolean {
  const { w, wall } = board;
  for (const a of [t, t - 1, t - w, t - w - 1]) {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a]) || !(wall[b] || occupied[b])) continue;
    if (!(wall[c] || occupied[c]) || !(wall[d] || occupied[d])) continue;
    if (
      (occupied[a] && !goalSet[a]) ||
      (occupied[b] && !goalSet[b]) ||
      (occupied[c] && !goalSet[c]) ||
      (occupied[d] && !goalSet[d])
    ) {
      return true;
    }
  }
  return false;
}

/** The shortest walk from `from` to `to` around walls and boxes, lower-case letters. */
function walkTo(board: Board, occupied: Uint8Array, from: number, to: number): string {
  const { w, wall } = board;
  if (from === to) return '';
  const prev = new Int32Array(wall.length).fill(-1);
  const how: string[] = new Array(wall.length);
  const queue = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    if (p === to) break;
    for (const [dx, dy, letter] of STEPS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: the push square is out of reach');
  let s = '';
  for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}

/** The square the player stands on after `moves` from `from` on a board `w` wide. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (const ch of moves.toLowerCase()) {
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

/** A solved search: its pushes and its moves (lower-case walks, upper-case pushes). */
interface Solved {
  pushes: number;
  moves: string;
}

/**
 * A* over pushes on `board`, at most `maxExpansions` expansions. A node is the
 * boxes' squares plus the player's reachable region (named by its lowest
 * square); a step is one push. The estimate is the cheapest assignment of
 * boxes to goals. Returns the push-optimal solution, or null when the search
 * gives up (budget spent) or the board has no solution.
 */
function solveAStar(board: Board, maxExpansions: number, work: { total: number }): Solved | null {
  const { w, wall, goals, boxes: startBoxes, player: startPlayer } = board;
  const size = wall.length;
  const n = goals.length;
  const goalSet = new Uint8Array(size);
  for (const g of goals) goalSet[g] = 1;
  const live = liveSquares(board);
  const dists = goalDistances(board);
  // The cheapest way to match every box to a different goal, over every
  // ordering of the goals. Past five boxes the orderings are infeasible, so
  // the estimate falls back to each box's nearest goal summed: still
  // admissible, since one push moves one box one square.
  const orderings = n <= 5 ? permutations(n) : null;
  const nearest: Int32Array = new Int32Array(size).fill(-1);
  for (let q = 0; q < size; q++) {
    let m = Infinity;
    for (let g = 0; g < n; g++) {
      const d = dists[g][q];
      if (d >= 0 && d < m) m = d;
    }
    nearest[q] = m === Infinity ? -1 : m;
  }
  const solved = (bs: number[]): boolean => bs.every((b) => goalSet[b]);
  if (startBoxes.some((b) => !live[b])) return null;

  // The estimate: the cheapest way to match every box to a different goal.
  const estimate = (bs: number[]): number => {
    if (orderings === null) {
      let sum = 0;
      for (const b of bs) {
        const d = nearest[b];
        if (d < 0) return Infinity;
        sum += d;
      }
      return sum;
    }
    let best = Infinity;
    for (const order of orderings) {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const d = dists[order[i]][bs[i]];
        if (d < 0) {
          sum = Infinity;
          break;
        }
        sum += d;
      }
      if (sum < best) best = sum;
    }
    return best;
  };

  // A node's key: the region's lowest square and the boxes' squares, as digits
  // in base `size` (exact while size ** (n + 1) stays under 2 ** 53: a room of
  // up to five boxes on any board this generator draws).
  const useNumericKey = size ** (n + 1) < 2 ** 53;
  const keyOf = (bs: number[], low: number): number | string => {
    if (!useNumericKey) return `${low}:${bs.join(',')}`;
    let k = low;
    for (const b of bs) k = k * size + b;
    return k;
  };

  const occupied = new Uint8Array(size);
  // `regionSeen` marks the region of the state being expanded (one stamp per
  // expansion); `keySeen` marks the region of a child state for its key (one
  // stamp per child). They must be separate arrays: computing a child's region
  // must not clobber the marks the expansion's push tests read.
  const regionSeen = new Int32Array(size);
  const keySeen = new Int32Array(size);
  let stamp = 0;
  let keyStamp = 0;

  // The nodes in the order found: their boxes, the player's square after the
  // push that made them, their parent, and the push (box, direction index).
  const nodeBoxes: number[][] = [startBoxes.slice()];
  const nodePlayer: number[] = [startPlayer];
  const nodeParent: number[] = [-1];
  const nodePushBox: number[] = [-1];
  const nodePushDir: number[] = [-1];
  const nodeG: number[] = [0];
  const best = new Map<number | string, number>();
  for (const b of startBoxes) occupied[b] = 1;
  const startLow = reachRegion(board, occupied, startPlayer, regionSeen, ++stamp);
  for (const b of startBoxes) occupied[b] = 0;
  best.set(keyOf(startBoxes, startLow), 0);
  const heap = new Heap();
  let seq = 0;
  const startH = estimate(startBoxes);
  if (startH === Infinity) return null;
  heap.push([startH, startH, seq++, 0]);

  let expanded = 0;
  const maxNodes = 800_000;
  while (heap.size > 0 && expanded < maxExpansions && work.total < 3_000_000 && nodeBoxes.length < maxNodes) {
    const [, , , s] = heap.pop();
    const bs = nodeBoxes[s];
    const g = nodeG[s];
    // Skip stale entries: a cheaper path to this node was already recorded.
    const lowNow = regionLowOf(board, bs, nodePlayer[s], occupied, regionSeen, ++stamp);
    const known = best.get(keyOf(bs, lowNow));
    if (known !== undefined && known < g) continue;
    if (solved(bs)) {
      return reconstruct(board, nodeBoxes, nodePlayer, nodeParent, nodePushBox, nodePushDir, s);
    }
    expanded++;
    work.total++;
    for (const b of bs) occupied[b] = 1;
    const here = ++stamp;
    reachRegion(board, occupied, nodePlayer[s], regionSeen, here);
    for (let bi = 0; bi < bs.length; bi++) {
      const b = bs[bi];
      for (let di = 0; di < 4; di++) {
        const [dx, dy] = STEPS[di];
        const d = dy * w + dx;
        const t = b + d;
        if (regionSeen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const dead = inFrozenBlock(board, occupied, goalSet, t);
        let key: number | string = -1;
        let next: number[] | null = null;
        let h = Infinity;
        if (!dead) {
          next = bs.slice();
          next[bi] = t;
          next.sort((a, b2) => a - b2);
          h = estimate(next);
          if (h < Infinity) {
            key = keyOf(next, reachRegion(board, occupied, b, keySeen, ++keyStamp));
          }
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (dead || h === Infinity) continue;
        const seenG = best.get(key);
        if (seenG !== undefined && seenG <= g + 1) continue;
        best.set(key, g + 1);
        const idx = nodeBoxes.length;
        nodeBoxes.push(next!);
        nodePlayer.push(b);
        nodeParent.push(s);
        nodePushBox.push(b);
        nodePushDir.push(di);
        nodeG.push(g + 1);
        heap.push([g + 1 + h, h, seq++, idx]);
      }
    }
    for (const x of bs) occupied[x] = 0;
  }
  return null;
}

/** The lowest square the player reaches from `player` with `bs` in the way. */
function regionLowOf(
  board: Board,
  bs: number[],
  player: number,
  occupied: Uint8Array,
  seen: Int32Array,
  stamp: number,
): number {
  for (const b of bs) occupied[b] = 1;
  const low = reachRegion(board, occupied, player, seen, stamp);
  for (const b of bs) occupied[b] = 0;
  return low;
}

/**
 * The moves for a solved search: walk to each push's square, then push, from
 * the start state down the parent chain.
 */
function reconstruct(
  board: Board,
  nodeBoxes: number[][],
  nodePlayer: number[],
  nodeParent: number[],
  nodePushBox: number[],
  nodePushDir: number[],
  found: number,
): Solved {
  const { w } = board;
  const path: number[] = [];
  for (let s = found; s > 0; s = nodeParent[s]) path.push(s);
  path.reverse();
  let moves = '';
  let player = nodePlayer[0];
  let boxes = nodeBoxes[0];
  const occupied = new Uint8Array(board.wall.length);
  for (const s of path) {
    const nextBoxes = nodeBoxes[s];
    const from = nodePushBox[s];
    const di = nodePushDir[s];
    const [dx, dy, , pushLetter] = STEPS[di];
    const d = dy * w + dx;
    for (const b of boxes) occupied[b] = 1;
    moves += walkTo(board, occupied, player, from - d);
    for (const b of boxes) occupied[b] = 0;
    moves += pushLetter;
    player = from;
    boxes = nextBoxes;
  }
  return { pushes: path.length, moves };
}

/**
 * Breadth-first search over pushes, the plain fallback when A* gives up: states
 * in the order found, so the first solved state met is push-optimal. Same
 * pruning, same state key, same reconstruction.
 */
function solveBfs(board: Board, maxStates: number, work: { total: number }): Solved | null {
  const { w, wall, goals, boxes: startBoxes, player: startPlayer } = board;
  const size = wall.length;
  const n = goals.length;
  const goalSet = new Uint8Array(size);
  for (const g of goals) goalSet[g] = 1;
  const live = liveSquares(board);
  const solved = (bs: number[]): boolean => bs.every((b) => goalSet[b]);
  if (startBoxes.some((b) => !live[b])) return null;

  const useNumericKey = size ** (n + 1) < 2 ** 53;
  const keyOf = (bs: number[], low: number): number | string => {
    if (!useNumericKey) return `${low}:${bs.join(',')}`;
    let k = low;
    for (const b of bs) k = k * size + b;
    return k;
  };

  const occupied = new Uint8Array(size);
  // `regionSeen` marks the region of the state being expanded; `keySeen` marks
  // the region of a child state for its key. Separate arrays, for the reason
  // noted in solveAStar: a child's region must not clobber the expansion's.
  const regionSeen = new Int32Array(size);
  const keySeen = new Int32Array(size);
  let stamp = 0;
  let keyStamp = 0;
  const nodeBoxes: number[][] = [startBoxes.slice()];
  const nodePlayer: number[] = [startPlayer];
  const nodeParent: number[] = [-1];
  const nodePushBox: number[] = [-1];
  const nodePushDir: number[] = [-1];
  const seenKeys = new Set<number | string>();
  for (const b of startBoxes) occupied[b] = 1;
  seenKeys.add(keyOf(startBoxes, reachRegion(board, occupied, startPlayer, regionSeen, ++stamp)));
  for (const b of startBoxes) occupied[b] = 0;
  let found = solved(startBoxes) ? 0 : -1;
  for (let head = 0; found < 0 && head < nodeBoxes.length; head++) {
    if (nodeBoxes.length >= maxStates) return null;
    const bs = nodeBoxes[head];
    if (nodeBoxes.length >= maxStates || work.total >= 3_000_000) return null;
    work.total++;
    for (const b of bs) occupied[b] = 1;
    const here = ++stamp;
    reachRegion(board, occupied, nodePlayer[head], regionSeen, here);
    for (let bi = 0; bi < bs.length && found < 0; bi++) {
      const b = bs[bi];
      for (let di = 0; di < 4; di++) {
        const [dx, dy] = STEPS[di];
        const d = dy * w + dx;
        const t = b + d;
        if (regionSeen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        const dead = inFrozenBlock(board, occupied, goalSet, t);
        let key: number | string = -1;
        let next: number[] | null = null;
        if (!dead) {
          next = bs.slice();
          next[bi] = t;
          next.sort((a, b2) => a - b2);
          key = keyOf(next, reachRegion(board, occupied, b, keySeen, ++keyStamp));
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (dead || seenKeys.has(key)) continue;
        if (nodeBoxes.length >= maxStates) {
          for (const x of bs) occupied[x] = 0;
          return null;
        }
        seenKeys.add(key);
        nodeBoxes.push(next!);
        nodePlayer.push(b);
        nodeParent.push(head);
        nodePushBox.push(b);
        nodePushDir.push(di);
        if (solved(next!)) {
          found = nodeBoxes.length - 1;
          break;
        }
      }
    }
    for (const x of bs) occupied[x] = 0;
  }
  if (found < 0) return null;
  return reconstruct(board, nodeBoxes, nodePlayer, nodeParent, nodePushBox, nodePushDir, found);
}

/**
 * Solve one room push-optimally: A* first, breadth-first search when it gives
 * up. Returns null only when neither finds a solution.
 */
function solveRoom(board: Board, work: { total: number }): Solved | null {
  return solveAStar(board, ROOM_ASTAR_EXPANSIONS, work) ?? solveBfs(board, ROOM_BFS_STATES, work);
}

/**
 * Solve a level room by room: each room's push-optimal solution in turn, the
 * other rooms' boxes standing as walls (on their goals once their room is
 * done), the player walking on from where the last room left it. Falls back to
 * solving the whole level when the level is no set of rooms, or when a room
 * gives up.
 */
function solveByRooms(board: Board, work: { total: number }): Solved | null {
  const rooms = roomsOf(board);
  if (rooms === null) {
    return solveAStar(board, WHOLE_ASTAR_EXPANSIONS, work) ?? solveBfs(board, WHOLE_BFS_STATES, work);
  }
  let player = board.player;
  let pushes = 0;
  let moves = '';
  for (const room of rooms) {
    const wall = board.wall.slice();
    for (const other of rooms) {
      if (other === room) continue;
      for (const b of other.done ? other.goals : other.boxes) wall[b] = 1;
    }
    const sub: Board = {
      w: board.w,
      h: board.h,
      wall,
      goals: room.goals.slice(),
      boxes: room.boxes.slice(),
      player,
    };
    const solved = solveRoom(sub, work);
    if (solved === null) {
      return solveAStar(board, WHOLE_ASTAR_EXPANSIONS, work) ?? solveBfs(board, WHOLE_BFS_STATES, work);
    }
    pushes += solved.pushes;
    moves += solved.moves;
    player = endOf(board.w, player, solved.moves);
    room.done = true;
  }
  return { pushes, moves };
}

/** The moves for one level's text; '' when nothing could be found (never throws). */
function solveLevel(text: string): string {
  try {
    const board = parseLevel(text);
    if (board.player < 0 || board.boxes.length === 0) return '';
    if (board.boxes.every((b) => board.goals.includes(b))) return '';
    const work = { total: 0 };
    const solved = solveByRooms(board, work);
    return solved === null ? '' : solved.moves;
  } catch {
    return '';
  }
}

for (const id of readdirSync(INPUT_DIR).sort()) {
  // One bad instance must never take the whole set down: answer it empty.
  let moves = '';
  try {
    moves = solveLevel(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8'));
  } catch {
    moves = '';
  }
  mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
  writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
}
