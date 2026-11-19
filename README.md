# HDL Portal – Verilog Sequential Logic Checker

A browser page for practising sequential-logic Verilog. Each question gives the module header and declarations; you write only the logic. **Run & check** compiles your code and simulates it against hidden tests, then shows a score and every clock edge where your outputs differ from the correct circuit.

16 questions: D flip-flops (async/sync reset, enable, parameterized), JK and T flip-flops, up / up-down / BCD / mod-M counters, clock divider, SIPO / PISO / Johnson shift registers, rising-edge detector, a "101" FSM and a D latch.

## Use it

Open `index.html` in a browser. Nothing to install, no server needed. Code and scores are saved in that browser's local storage.

To host it, enable GitHub Pages for this repo (Settings → Pages → deploy from the `main` branch, root folder).

## How it works

- `src/engine.js` – a small Verilog parser and simulator for the synthesizable subset used here (modules, parameters, `reg`/`wire`, `assign`, `always @(posedge …/negedge …)`, `always @(*)`, level-sensitive lists, `if`/`case`, `=` and `<=`, bit/part selects, concatenation, replication and the usual operators, with x values). It reports common mistakes as compile errors, such as mixed edge/level sensitivity lists, `assign` to a `reg`, or assigning a `wire` inside `always`.
- `src/questions.js` – each question's header, reference solution and test stimulus. Your outputs are compared with the reference solution's outputs at every step.
- `src/template.html` – the page layout and UI.

Not supported: `for` loops, module instantiation, memories, tasks/functions and delays.

## Edit questions

Change files in `src/`, then rebuild the page:

```
python build.py
```

## Tests (Node.js)

```
node tests/test_self.js    # every reference solution must score 100%
node tests/test_wrong.js   # wrong answers must lose marks or give a compile error
node tests/xcheck.js       # compares the engine with Icarus Verilog (needs iverilog and vvp on PATH)
```
