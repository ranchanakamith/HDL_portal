// Questions: fixed skeleton (head) + student logic + "endmodule". Hidden tests compare
// the student's outputs against the reference solution at every step.
"use strict";
const QUESTIONS = (function () {
  function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  const bit = (r, p = 0.5) => (r() < p ? 1 : 0);
  const int = (r, n) => Math.floor(r() * n);
  const tick = (set, label) => ({ tick: true, set: set || {}, label: label || '' });
  const set = (s, label) => ({ set: s, label: label || '' });

  const Q = [];

  // ------------------------------------------------------------ 1
  Q.push({
    id: 'dff-async', title: 'D flip-flop, async reset', tag: 'Flip-flops',
    desc: `<p>Positive-edge D flip-flop. <code>rst_n</code> is <b>active-low</b> and <b>asynchronous</b>: when it goes to 0, <code>q</code> clears to 0 immediately, without waiting for a clock edge. Otherwise <code>q</code> takes <code>d</code> on each rising edge of <code>clk</code>.</p>`,
    head: `module dff_async (
    input  wire clk,
    input  wire rst_n,   // active-low, asynchronous
    input  wire d,
    output reg  q
);`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) q <= 1'b0;
        else        q <= d;
    end`,
    tests() {
      const r = rng(11), s = [];
      s.push(set({ rst_n: 0 }, 'reset low, no clock edge'));
      s.push(tick({ d: 1 }, 'reset held'));
      s.push(set({ rst_n: 1 }, 'release reset'));
      for (let i = 0; i < 10; i++) s.push(tick({ d: bit(r) }));
      s.push(tick({ d: 1 }));
      s.push(set({ rst_n: 0 }, 'reset mid-cycle'));
      s.push(set({ rst_n: 1 }, 'release'));
      for (let i = 0; i < 4; i++) s.push(tick({ d: bit(r) }));
      return [{ name: 'Reset and random data', init: { clk: 0, rst_n: 1, d: 0 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 2
  Q.push({
    id: 'dff-sync-en', title: 'D flip-flop, sync reset + enable', tag: 'Flip-flops',
    desc: `<p>Positive-edge D flip-flop with a <b>synchronous, active-high</b> reset <code>rst</code> and an enable <code>en</code>.</p>
<ul><li>On a rising edge: if <code>rst = 1</code>, <code>q</code> becomes 0 (reset wins over enable).</li>
<li>Else if <code>en = 1</code>, <code>q</code> takes <code>d</code>.</li>
<li>Otherwise <code>q</code> holds its value. Nothing changes between clock edges.</li></ul>`,
    head: `module dff_sync_en (
    input  wire clk,
    input  wire rst,     // active-high, synchronous
    input  wire en,
    input  wire d,
    output reg  q
);`,
    solution: `    always @(posedge clk) begin
        if (rst)     q <= 1'b0;
        else if (en) q <= d;
    end`,
    tests() {
      const r = rng(22), s = [];
      s.push(tick({ rst: 1 }, 'sync reset'));
      s.push(set({ rst: 0, en: 1, d: 1 }));
      for (let i = 0; i < 14; i++) s.push(tick({ rst: bit(r, 0.12), en: bit(r, 0.6), d: bit(r) }));
      s.push(tick({ rst: 0, en: 1, d: 1 }, 'load 1'));
      s.push(set({ rst: 1 }, 'rst=1 between edges: q must NOT change yet'));
      s.push(tick({ rst: 1 }, 'now it resets'));
      s.push(tick({ rst: 0, en: 0, d: 1 }, 'en=0: hold'));
      return [{ name: 'Sync reset, enable, data', init: { clk: 0, rst: 0, en: 0, d: 0 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 3
  function nbitTests(seed, N) {
    const r = rng(seed), s = [], m = 1 << N;
    s.push(set({ rst_n: 0 }, 'async reset'));
    s.push(set({ rst_n: 1 }));
    for (let i = 0; i < 10; i++) s.push(tick({ d: int(r, m) }));
    s.push(set({ rst_n: 0 }, 'reset mid-cycle'));
    s.push(tick({ rst_n: 1, d: int(r, m) }));
    s.push(tick({ d: m - 1 }, 'all ones'));
    return s;
  }
  Q.push({
    id: 'dff-n', title: 'Parameterized N-bit register', tag: 'Flip-flops',
    desc: `<p>N-bit D flip-flop (register). Asynchronous active-low reset clears <b>all N bits</b>, for any value of <code>N</code>. On each rising edge, <code>q</code> takes <code>d</code>.</p>
<p class="note">The tests also run your module with <code>N = 5</code>, so do not hard-code the width (hint: <code>{N{1'b0}}</code>).</p>`,
    head: `module dff_n #(parameter N = 8) (
    input  wire         clk,
    input  wire         rst_n,
    input  wire [N-1:0] d,
    output reg  [N-1:0] q
);`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) q <= {N{1'b0}};
        else        q <= d;
    end`,
    fmt: { d: 'b', q: 'b' },
    tests() {
      return [
        { name: 'N = 8 (default)', init: { clk: 0, rst_n: 1, d: 0 }, steps: nbitTests(33, 8) },
        { name: 'N = 5', params: { N: 5 }, init: { clk: 0, rst_n: 1, d: 0 }, steps: nbitTests(34, 5) }
      ];
    }
  });

  // ------------------------------------------------------------ 4
  Q.push({
    id: 'counter4', title: '4-bit up counter with enable', tag: 'Counters',
    desc: `<p>4-bit binary up counter. Asynchronous active-low reset sets <code>count</code> to 0. On each rising edge, if <code>en = 1</code> the counter adds 1 (15 wraps to 0); if <code>en = 0</code> it holds.</p>`,
    head: `module counter4 (
    input  wire       clk,
    input  wire       rst_n,
    input  wire       en,
    output reg  [3:0] count
);`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)  count <= 4'd0;
        else if (en) count <= count + 1'b1;
    end`,
    tests() {
      const r = rng(44), s = [];
      s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1, en: 1 }));
      for (let i = 0; i < 18; i++) s.push(tick({}, i === 15 ? 'wrap 15 -> 0' : ''));
      for (let i = 0; i < 8; i++) s.push(tick({ en: bit(r, 0.6) }));
      s.push(set({ rst_n: 0 }, 'reset mid-cycle'));
      s.push(tick({ rst_n: 1, en: 1 })); s.push(tick()); s.push(tick());
      return [{ name: 'Count, hold, wrap, reset', init: { clk: 0, rst_n: 1, en: 0 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 5
  function udTests(seed, N) {
    const r = rng(seed), s = [], m = 1 << N;
    s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1 }));
    s.push(tick({ up: 1 })); s.push(tick({ up: 0 }, 'down from 1'));
    s.push(tick({ up: 0 }, 'down: 0 -> max'));
    s.push(tick({ load: 1, din: m - 3 }, 'load'));
    s.push(tick({ load: 0, up: 1 })); s.push(tick()); s.push(tick({}, 'up past max'));
    for (let i = 0; i < 12; i++) s.push(tick({ load: bit(r, 0.15), up: bit(r, 0.5), din: int(r, m) }));
    s.push(tick({ load: 1, up: 1, din: 5 }, 'load beats up'));
    return s;
  }
  Q.push({
    id: 'updown', title: 'Up/down counter with load', tag: 'Counters',
    desc: `<p>N-bit counter. Priority on each rising edge:</p>
<ol><li>Asynchronous active-low reset: <code>q = 0</code> (immediately).</li>
<li><code>load = 1</code>: <code>q = din</code>.</li>
<li><code>up = 1</code>: count up, else count down (both wrap around).</li></ol>
<p class="note">Also tested with <code>N = 3</code>.</p>`,
    head: `module updown_counter #(parameter N = 4) (
    input  wire         clk,
    input  wire         rst_n,
    input  wire         load,
    input  wire         up,     // 1 = up, 0 = down
    input  wire [N-1:0] din,
    output reg  [N-1:0] q
);`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)    q <= {N{1'b0}};
        else if (load) q <= din;
        else if (up)   q <= q + 1'b1;
        else           q <= q - 1'b1;
    end`,
    tests() {
      const base = { clk: 0, rst_n: 1, load: 0, up: 1, din: 0 };
      return [
        { name: 'N = 4 (default)', init: base, steps: udTests(55, 4) },
        { name: 'N = 3', params: { N: 3 }, init: base, steps: udTests(56, 3) }
      ];
    }
  });

  // ------------------------------------------------------------ 6
  function sipoTests(seed) {
    const r = rng(seed), s = [];
    s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1 }));
    const pat = [1, 0, 1, 1];
    for (const b of pat) s.push(tick({ sin: b }, 'shift in ' + b));
    for (let i = 0; i < 10; i++) s.push(tick({ sin: bit(r) }));
    s.push(set({ rst_n: 0 }, 'reset mid-cycle')); s.push(tick({ rst_n: 1, sin: 1 }));
    return s;
  }
  Q.push({
    id: 'sipo', title: 'Shift register (serial in, parallel out)', tag: 'Shift registers',
    desc: `<p>N-bit shift register. On each rising edge, shift <b>left</b> by one: <code>sin</code> enters at bit 0 and every bit moves up one place. <code>sout</code> is the MSB, <code>q[N-1]</code>. Asynchronous active-low reset clears <code>q</code>.</p>
<p class="note">Example (N = 4) after shifting in 1, 0, 1, 1: q = 0001, 0010, 0101, 1011. Also tested with N = 6.</p>`,
    head: `module shift_sipo #(parameter N = 4) (
    input  wire         clk,
    input  wire         rst_n,
    input  wire         sin,
    output wire         sout,
    output reg  [N-1:0] q
);`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) q <= {N{1'b0}};
        else        q <= {q[N-2:0], sin};
    end

    assign sout = q[N-1];`,
    fmt: { q: 'b' },
    tests() {
      return [
        { name: 'N = 4 (default)', init: { clk: 0, rst_n: 1, sin: 0 }, steps: sipoTests(66) },
        { name: 'N = 6', params: { N: 6 }, init: { clk: 0, rst_n: 1, sin: 0 }, steps: sipoTests(67) }
      ];
    }
  });

  // ------------------------------------------------------------ 7
  Q.push({
    id: 'piso', title: 'Shift register (parallel in, serial out)', tag: 'Shift registers',
    desc: `<p>4-bit parallel-in serial-out shift register using the internal register <code>sr</code>.</p>
<ul><li>Asynchronous active-low reset: <code>sr = 0</code>.</li>
<li>On a rising edge with <code>load = 1</code>: <code>sr = din</code>.</li>
<li>On a rising edge with <code>load = 0</code>: shift <code>sr</code> left by one, filling bit 0 with 0.</li>
<li><code>sout</code> is always the MSB of <code>sr</code> (so the data comes out MSB first).</li></ul>`,
    head: `module piso4 (
    input  wire       clk,
    input  wire       rst_n,
    input  wire       load,
    input  wire [3:0] din,
    output wire       sout
);
    reg [3:0] sr;`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)    sr <= 4'b0000;
        else if (load) sr <= din;
        else           sr <= {sr[2:0], 1'b0};
    end

    assign sout = sr[3];`,
    fmt: { din: 'b' },
    tests() {
      const r = rng(77), s = [];
      s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1 }));
      s.push(tick({ load: 1, din: 0b1011 }, 'load 1011'));
      for (let i = 0; i < 5; i++) s.push(tick({ load: 0 }, 'shift out'));
      s.push(tick({ load: 1, din: 0b0110 }, 'load 0110'));
      for (let i = 0; i < 4; i++) s.push(tick({ load: 0 }));
      for (let i = 0; i < 8; i++) s.push(tick({ load: bit(r, 0.25), din: int(r, 16) }));
      return [{ name: 'Load and shift out', init: { clk: 0, rst_n: 1, load: 0, din: 0 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 8
  Q.push({
    id: 'bcd', title: 'BCD (mod-10) counter', tag: 'Counters',
    desc: `<p>Counts 0, 1, … 9, 0, 1, … on each rising edge. Asynchronous active-low reset sets <code>q = 0</code>. <code>tc</code> (terminal count) is 1 only while <code>q</code> is 9.</p>`,
    head: `module bcd_counter (
    input  wire       clk,
    input  wire       rst_n,
    output reg  [3:0] q,
    output wire       tc
);`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)         q <= 4'd0;
        else if (q == 4'd9) q <= 4'd0;
        else                q <= q + 1'b1;
    end

    assign tc = (q == 4'd9);`,
    tests() {
      const s = [];
      s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1 }));
      for (let i = 0; i < 23; i++) s.push(tick({}, i === 9 ? '9 -> 0' : ''));
      s.push(set({ rst_n: 0 }, 'reset mid-cycle')); s.push(tick({ rst_n: 1 })); s.push(tick());
      return [{ name: 'Count 0-9 twice', init: { clk: 0, rst_n: 1 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 9
  Q.push({
    id: 'jk', title: 'JK flip-flop', tag: 'Flip-flops',
    desc: `<p>JK flip-flop with asynchronous active-low reset (<code>q = 0</code>). On each rising edge use a <code>case</code> on <code>{j, k}</code>:</p>
<table class="mini"><tr><th>j k</th><th>action</th></tr><tr><td>00</td><td>hold</td></tr><tr><td>01</td><td>reset (q = 0)</td></tr><tr><td>10</td><td>set (q = 1)</td></tr><tr><td>11</td><td>toggle</td></tr></table>`,
    head: `module jk_ff (
    input  wire clk,
    input  wire rst_n,
    input  wire j,
    input  wire k,
    output reg  q
);`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) q <= 1'b0;
        else
            case ({j, k})
                2'b00: q <= q;
                2'b01: q <= 1'b0;
                2'b10: q <= 1'b1;
                2'b11: q <= ~q;
            endcase
    end`,
    tests() {
      const r = rng(99), s = [];
      s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1 }));
      const seq = [[1, 0], [0, 0], [1, 1], [1, 1], [0, 1], [0, 0], [1, 1]];
      for (const [j, k] of seq) s.push(tick({ j, k }, `jk=${j}${k}`));
      for (let i = 0; i < 12; i++) s.push(tick({ j: bit(r), k: bit(r) }));
      return [{ name: 'All four jk cases', init: { clk: 0, rst_n: 1, j: 0, k: 0 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 10
  Q.push({
    id: 'tff', title: 'T flip-flop', tag: 'Flip-flops',
    desc: `<p>T flip-flop with asynchronous active-low reset (<code>q = 0</code>). On each rising edge, <code>q</code> toggles if <code>t = 1</code> and holds if <code>t = 0</code>.</p>`,
    head: `module t_ff (
    input  wire clk,
    input  wire rst_n,
    input  wire t,
    output reg  q
);`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) q <= 1'b0;
        else if (t) q <= ~q;
    end`,
    tests() {
      const r = rng(1010), s = [];
      s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1 }));
      for (let i = 0; i < 4; i++) s.push(tick({ t: 1 }, 'toggle'));
      for (let i = 0; i < 12; i++) s.push(tick({ t: bit(r) }));
      return [{ name: 'Toggle and hold', init: { clk: 0, rst_n: 1, t: 0 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 11
  Q.push({
    id: 'clkdiv', title: 'Clock divider (÷2 and ÷4)', tag: 'Counters',
    desc: `<p>Generate <code>clk_div2</code> (input clock ÷ 2) and <code>clk_div4</code> (÷ 4). Asynchronous active-low reset sets both to 0.</p>
<ul><li><code>clk_div2</code>: a register that toggles on every rising edge of <code>clk</code>.</li>
<li><code>clk_div4</code>: the MSB of the 2-bit counter <code>cnt</code>, which adds 1 on every rising edge.</li></ul>`,
    head: `module clk_div4 (
    input  wire clk,
    input  wire rst_n,
    output reg  clk_div2,
    output wire clk_div4
);
    reg [1:0] cnt;`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) cnt <= 2'b00;
        else        cnt <= cnt + 1'b1;
    end

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) clk_div2 <= 1'b0;
        else        clk_div2 <= ~clk_div2;
    end

    assign clk_div4 = cnt[1];`,
    tests() {
      const s = [];
      s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1 }));
      for (let i = 0; i < 12; i++) s.push(tick());
      s.push(set({ rst_n: 0 }, 'reset mid-cycle')); s.push(tick({ rst_n: 1 })); s.push(tick()); s.push(tick());
      return [{ name: '12 clock cycles', init: { clk: 0, rst_n: 1 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 12
  Q.push({
    id: 'edge', title: 'Rising-edge detector', tag: 'Small circuits',
    desc: `<p>Make <code>pulse</code> go to 1 for <b>exactly one clock cycle</b> after <code>sig</code> changes from 0 to 1. Both <code>sig_d</code> (the value of <code>sig</code> on the previous edge) and <code>pulse</code> are registers updated on the rising edge, so <code>pulse</code> is 1 right after the edge where <code>sig = 1</code> and <code>sig_d = 0</code>. Asynchronous active-low reset clears both.</p>`,
    head: `module rise_detect (
    input  wire clk,
    input  wire rst_n,
    input  wire sig,
    output reg  pulse
);
    reg sig_d;   // sig, one clock ago`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            sig_d <= 1'b0;
            pulse <= 1'b0;
        end else begin
            sig_d <= sig;
            pulse <= sig & ~sig_d;
        end
    end`,
    tests() {
      const r = rng(1212), s = [];
      s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1 }));
      const pat = [0, 1, 1, 1, 0, 1, 0, 0, 1, 1];
      for (const b of pat) s.push(tick({ sig: b }));
      for (let i = 0; i < 10; i++) s.push(tick({ sig: bit(r) }));
      return [{ name: 'Edges in sig', init: { clk: 0, rst_n: 1, sig: 0 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 13
  Q.push({
    id: 'johnson', title: 'Johnson (twisted-ring) counter', tag: 'Shift registers',
    desc: `<p>4-bit Johnson counter. Asynchronous active-low reset sets <code>q = 0000</code>. On each rising edge, shift left and feed the <b>inverted MSB</b> back into bit 0.</p>
<p class="note">Sequence: 0000, 0001, 0011, 0111, 1111, 1110, 1100, 1000, 0000 …</p>`,
    head: `module johnson4 (
    input  wire       clk,
    input  wire       rst_n,
    output reg  [3:0] q
);`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) q <= 4'b0000;
        else        q <= {q[2:0], ~q[3]};
    end`,
    fmt: { q: 'b' },
    tests() {
      const s = [];
      s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1 }));
      for (let i = 0; i < 11; i++) s.push(tick());
      s.push(set({ rst_n: 0 }, 'reset mid-cycle')); s.push(tick({ rst_n: 1 })); s.push(tick());
      return [{ name: 'Full cycle', init: { clk: 0, rst_n: 1 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 14
  Q.push({
    id: 'modm', title: 'Parameterized mod-M counter', tag: 'Counters',
    desc: `<p>Counts 0, 1, … M−1, then back to 0. <code>W</code> is the width of <code>q</code>. Asynchronous active-low reset sets <code>q = 0</code>. <code>tc</code> is 1 only while <code>q = M−1</code>.</p>
<p class="note">Tested with M = 6 (default) and M = 5. Use the parameter, do not hard-code 5.</p>`,
    head: `module mod_m_counter #(parameter M = 6, parameter W = 3) (
    input  wire         clk,
    input  wire         rst_n,
    output reg  [W-1:0] q,
    output wire         tc
);`,
    solution: `    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)        q <= 0;
        else if (q == M-1) q <= 0;
        else               q <= q + 1'b1;
    end

    assign tc = (q == M-1);`,
    tests() {
      const mk = () => { const s = [set({ rst_n: 0 }, 'reset'), set({ rst_n: 1 })]; for (let i = 0; i < 14; i++) s.push(tick()); return s; };
      return [
        { name: 'M = 6 (default)', init: { clk: 0, rst_n: 1 }, steps: mk() },
        { name: 'M = 5', params: { M: 5 }, init: { clk: 0, rst_n: 1 }, steps: mk() }
      ];
    }
  });

  // ------------------------------------------------------------ 15
  Q.push({
    id: 'fsm101', title: 'FSM: "101" sequence detector', tag: 'FSM',
    desc: `<p>Moore FSM that sets <code>y = 1</code> for one cycle after the bits 1, 0, 1 arrive on <code>x</code> (one bit per clock). Overlapping is allowed: 10101 gives two detections.</p>
<ul><li>States: <code>S0</code> nothing, <code>S1</code> seen "1", <code>S2</code> seen "10", <code>S3</code> seen "101".</li>
<li>Write 3 parts: the state register (async active-low reset to <code>S0</code>), the next-state logic in <code>always @(*)</code>, and <code>assign y</code>.</li></ul>`,
    head: `module seq101 (
    input  wire clk,
    input  wire rst_n,
    input  wire x,
    output wire y
);
    localparam S0 = 2'd0, S1 = 2'd1, S2 = 2'd2, S3 = 2'd3;
    reg [1:0] state, next;`,
    solution: `    // state register
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) state <= S0;
        else        state <= next;
    end

    // next-state logic
    always @(*) begin
        next = S0;
        case (state)
            S0: next = x ? S1 : S0;
            S1: next = x ? S1 : S2;
            S2: next = x ? S3 : S0;
            S3: next = x ? S1 : S2;
            default: next = S0;
        endcase
    end

    // output logic (Moore)
    assign y = (state == S3);`,
    tests() {
      const r = rng(1515), s = [];
      s.push(set({ rst_n: 0 }, 'reset')); s.push(set({ rst_n: 1 }));
      const pat = [1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1];
      for (const b of pat) s.push(tick({ x: b }, 'x=' + b));
      for (let i = 0; i < 16; i++) s.push(tick({ x: bit(r) }));
      return [{ name: 'Bit stream', init: { clk: 0, rst_n: 1, x: 0 }, steps: s }];
    }
  });

  // ------------------------------------------------------------ 16
  Q.push({
    id: 'latch', title: 'D latch (level-sensitive)', tag: 'Latches',
    desc: `<p>D latch: while <code>en = 1</code>, <code>q</code> follows <code>d</code>; while <code>en = 0</code>, <code>q</code> holds its last value. There is <b>no clock</b>.</p>
<p class="note">Think: which signals go in the sensitivity list, and which branch do you leave out on purpose?</p>`,
    head: `module d_latch (
    input  wire en,
    input  wire d,
    output reg  q
);`,
    solution: `    always @(en or d) begin
        if (en) q = d;
    end`,
    tests() {
      const r = rng(1616), s = [];
      const seq = [[1, 1], [1, 0], [1, 1], [0, 1], [0, 0], [0, 1], [1, 0], [0, 0], [0, 1]];
      for (const [en, d] of seq) s.push(set({ en, d }, en ? 'transparent' : 'hold'));
      for (let i = 0; i < 12; i++) {
        if (r() < 0.5) s.push(set({ en: bit(r) })); else s.push(set({ d: bit(r) }));
      }
      return [{ name: 'Transparent and hold', clock: '__none', init: { en: 0, d: 0 }, steps: s }];
    }
  });

  const ORDER = ['Flip-flops', 'Counters', 'Shift registers', 'Small circuits', 'FSM', 'Latches'];
  Q.sort((a, b) => ORDER.indexOf(a.tag) - ORDER.indexOf(b.tag));
  return Q;
})();
if (typeof module !== 'undefined') module.exports = QUESTIONS;
