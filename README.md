# sokoban-push-optimal

[![make.fun · sokoban-solver-01-run-20261121](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![rank](https://make.fun/badge/sokoban-solver-01-run-20261121/naiputrisan/sokoban-push-optimal/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)
[![reward](https://make.fun/badge/sokoban-solver-01-run-20261121/naiputrisan/sokoban-push-optimal/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=sokoban-solver-01-run-20261121)

A push-optimal Sokoban solver, written from scratch for the [make.fun bounty](https://make.fun/bounty/sokoban-solver-01-run-20261121): one `main.ts` (Node 22, standard library only) that answers a whole set of 5 generated levels in a single run, each in the fewest pushes possible.

## The idea

The generated levels decompose. A one-square hallway runs across the board and every room hangs off it through a single door; a box pushed out of a door into the hallway can never come back, so every box stays in its room and a level's optimum is the sum of its rooms' optima. The solver therefore splits each level into rooms and solves every room push-optimally on its own, then stitches the rooms together with the player's walks along the hallway.

Each room is solved with A\* over pushes. A search node is the boxes' squares plus the region the player can reach (named by its lowest square); a step is one push, so the first solved node A\* pops is push-optimal for the room. The estimate is the cheapest assignment of boxes to goals (every permutation tried, distances by breadth-first search over open floor), which never overestimates: one push moves one box one square. Dead states are pruned two ways: a box on a square from which no goal is reachable by pushing, and a box frozen in a 2x2 block of walls and boxes. A box merely hemmed in by other boxes that can still move is not dead — it frees up once they move — so it is never pruned. Everything is budgeted by work counted in states, never by the clock, so two runs write the same bytes.

## Measured

- Kit practice set: **1,000,000** (5/5 instances push-optimal: 13, 16, 29, 47, 60 pushes), ~0.4s for the whole set. The house baseline (plain-astar 1.0.0) scores 200,000 on the same set.
- 8 freshly drawn sets (the kit's own generator, random seeds): **1,000,000 on every set**, 5/5 optimal on all 40 instances, 0.25–0.5s per set.
- Official grade-local (kit CLI, `--driver process`): score **1,000,000**, 5,000/5,000 checks, L1 regrade reproduced byte for byte.
- Determinism: two runs on the same set write byte-identical solutions. Also verified under a 256 MB heap cap, inside the grader's 512 MB / 60 s sandbox.

## Run it

```sh
MAKEFUN_INPUT_DIR=<dir with i001..i005/level.txt> MAKEFUN_OUTPUT_DIR=<dir> node main.ts
```

It writes `<dir>/i001/solution.txt` … `<dir>/i005/solution.txt`, one move per letter (`u d l r` walks, `U D L R` pushes), plus a trailing newline.
