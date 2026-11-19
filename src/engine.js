// Mini Verilog engine: parser + 4-state-ish cycle simulator for a synthesizable subset.
// Supports: ANSI/non-ANSI module headers, parameters, reg/wire/integer, localparam,
// assign, always @(posedge/negedge ...), always @(*), always @(a or b), begin/end,
// if/else, case/casez/casex, = and <=, bit/part selects, concat, replication,
// arithmetic, bitwise, logical, reduction, relational, shift, ternary operators.
"use strict";
const VE = (function () {

  class VError extends Error {
    constructor(msg, line) { super(msg); this.line = line; }
  }

  const KEYWORDS = new Set(['module', 'endmodule', 'input', 'output', 'inout', 'wire', 'reg', 'integer',
    'parameter', 'localparam', 'assign', 'always', 'initial', 'begin', 'end', 'if', 'else', 'case', 'casez',
    'casex', 'endcase', 'default', 'posedge', 'negedge', 'or', 'for', 'while', 'repeat', 'forever',
    'function', 'endfunction', 'task', 'endtask', 'signed', 'logic', 'generate', 'endgenerate', 'genvar',
    'always_ff', 'always_comb']);

  // ---------------------------------------------------------------- lexer
  function lex(src) {
    const toks = []; let i = 0, line = 1; const n = src.length;
    const ops3 = ['===', '!==', '<<<', '>>>'];
    const ops2 = ['<=', '>=', '==', '!=', '&&', '||', '<<', '>>', '~&', '~|', '~^', '^~', '**'];
    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        const startLine = line; i += 2;
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
        if (i >= n) throw new VError('Unclosed /* comment', startLine);
        i += 2; continue;
      }
      if (c === '`') { while (i < n && src[i] !== '\n') i++; continue; }
      if (/[A-Za-z_]/.test(c)) {
        let j = i; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
        const w = src.slice(i, j);
        toks.push({ t: KEYWORDS.has(w) ? 'kw' : 'id', v: w, line }); i = j; continue;
      }
      if (c === '$') {
        let j = i + 1; while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
        toks.push({ t: 'sys', v: src.slice(i, j), line }); i = j; continue;
      }
      if (/[0-9]/.test(c) || (c === "'" && /[sSbBoOdDhH]/.test(src[i + 1] || ''))) {
        let j = i, size = '';
        while (j < n && /[0-9_]/.test(src[j])) { size += src[j]; j++; }
        let k = j; while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
        if (src[k] === "'" && /[sSbBoOdDhH]/.test(src[k + 1] || '')) {
          k++; if (/[sS]/.test(src[k])) k++;
          const base = src[k].toLowerCase(); k++;
          while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
          let digits = '';
          while (k < n && /[0-9a-fA-FxXzZ_?]/.test(src[k])) { digits += src[k]; k++; }
          digits = digits.replace(/_/g, '');
          if (!digits) throw new VError('Bad number literal (no digits after the base)', line);
          const text = src.slice(i, k);
          toks.push({ t: 'num', size: size ? parseInt(size.replace(/_/g, ''), 10) : null, base, digits, text, line });
          i = k; continue;
        }
        if (src[j] === '.') throw new VError('Real numbers (with a decimal point) are not allowed in synthesizable logic', line);
        toks.push({ t: 'num', size: null, base: 'd', digits: size.replace(/_/g, ''), text: size, line });
        i = j; continue;
      }
      const s3 = src.substr(i, 3), s2 = src.substr(i, 2);
      if (ops3.includes(s3)) { toks.push({ t: 'op', v: s3, line }); i += 3; continue; }
      if (ops2.includes(s2)) { toks.push({ t: 'op', v: s2, line }); i += 2; continue; }
      if ('()[]{};:,.#@=+-*/%&|^~!<>?'.includes(c)) { toks.push({ t: 'op', v: c, line }); i++; continue; }
      if (c === '"') throw new VError('Strings are only used in testbenches ($display), not in the design', line);
      throw new VError(`Unexpected character '${c}'`, line);
    }
    toks.push({ t: 'eof', v: 'end of file', line });
    return toks;
  }

  const tokStr = t => t.t === 'num' ? t.text : t.v;

  // ---------------------------------------------------------------- parser
  function parse(src) {
    const toks = lex(src); let p = 0;
    const peek = (o = 0) => toks[Math.min(p + o, toks.length - 1)];
    const next = () => toks[p++];
    const is = (v, o = 0) => { const t = peek(o); return (t.t === 'op' || t.t === 'kw') && t.v === v; };
    const expect = (v, hint) => {
      const t = next();
      if (!((t.t === 'op' || t.t === 'kw') && t.v === v)) {
        let m = `Expected '${v}' but found '${tokStr(t)}'`;
        if (v === ';' ) m += ' (missing semicolon on the previous statement?)';
        if (hint) m += ` ${hint}`;
        throw new VError(m, v === ';' && t.line > toks[p - 2].line ? toks[p - 2].line : t.line);
      }
      return t;
    };
    const ident = (what) => {
      const t = next();
      if (t.t !== 'id') {
        if (t.t === 'kw') throw new VError(`'${t.v}' is a Verilog keyword and cannot be used as ${what || 'a name'} here`, t.line);
        throw new VError(`Expected ${what || 'a name'} but found '${tokStr(t)}'`, t.line);
      }
      return t;
    };

    // ---- expressions
    const LEVELS = [['||'], ['&&'], ['|'], ['^', '~^', '^~'], ['&'], ['==', '!=', '===', '!=='],
      ['<', '<=', '>', '>='], ['<<', '>>', '<<<', '>>>'], ['+', '-'], ['*', '/', '%']];
    const UNARY = ['!', '~', '-', '+', '&', '|', '^', '~&', '~|', '~^', '^~'];

    function parseExpr() { return parseTernary(); }
    function parseTernary() {
      const c = parseBin(0);
      if (is('?')) {
        const line = next().line;
        const a = parseTernary(); expect(':', "in the ?: operator");
        const b = parseTernary();
        return { t: 'tern', c, a, b, line };
      }
      return c;
    }
    function parseBin(lvl) {
      if (lvl >= LEVELS.length) return parseUnary();
      let l = parseBin(lvl + 1);
      while (peek().t === 'op' && LEVELS[lvl].includes(peek().v)) {
        const t = next();
        const r = parseBin(lvl + 1);
        l = { t: 'bin', op: t.v, l, r, line: t.line };
      }
      return l;
    }
    function parseUnary() {
      const t = peek();
      if (t.t === 'op' && UNARY.includes(t.v)) { next(); return { t: 'un', op: t.v, e: parseUnary(), line: t.line }; }
      return parsePrimary();
    }
    function parsePrimary() {
      const t = next();
      if (t.t === 'num') return { t: 'num', tok: t, line: t.line };
      if (t.t === 'id') {
        if (is('[')) {
          next();
          const a = parseExpr();
          if (is(':')) { next(); const b = parseExpr(); expect(']'); return { t: 'part', name: t.v, msb: a, lsb: b, line: t.line }; }
          expect(']');
          return { t: 'bit', name: t.v, idx: a, line: t.line };
        }
        if (is('(')) throw new VError(`Function calls like '${t.v}(...)' are not supported here`, t.line);
        return { t: 'id', name: t.v, line: t.line };
      }
      if (t.t === 'op' && t.v === '(') { const e = parseExpr(); expect(')'); return e; }
      if (t.t === 'op' && t.v === '{') {
        const first = parseExpr();
        if (is('{')) {
          next();
          const parts = [parseExpr()];
          while (is(',')) { next(); parts.push(parseExpr()); }
          expect('}'); expect('}');
          return { t: 'rep', count: first, parts, line: t.line };
        }
        const parts = [first];
        while (is(',')) { next(); parts.push(parseExpr()); }
        expect('}');
        return { t: 'concat', parts, line: t.line };
      }
      if (t.t === 'sys') throw new VError(`${t.v} is a simulation (testbench) task and cannot be used in the design`, t.line);
      if (t.t === 'eof') throw new VError('Unexpected end of code inside an expression', t.line);
      throw new VError(`Unexpected '${tokStr(t)}' in an expression`, t.line);
    }

    // ---- statements
    function parseLhs() {
      const t = peek();
      if (is('{')) {
        next();
        const parts = [parseLhs()];
        while (is(',')) { next(); parts.push(parseLhs()); }
        expect('}');
        return { t: 'concat', parts, line: t.line };
      }
      const id = ident('a signal name to assign to');
      if (is('[')) {
        next();
        const a = parseExpr();
        if (is(':')) { next(); const b = parseExpr(); expect(']'); return { t: 'part', name: id.v, msb: a, lsb: b, line: id.line }; }
        expect(']');
        return { t: 'bit', name: id.v, idx: a, line: id.line };
      }
      return { t: 'id', name: id.v, line: id.line };
    }

    function parseStmt() {
      const t = peek();
      if (is('begin')) {
        next();
        if (is(':')) { next(); ident('a block label'); }
        const stmts = [];
        while (!is('end')) {
          if (peek().t === 'eof' || is('endmodule')) throw new VError("'begin' without a matching 'end'", t.line);
          stmts.push(parseStmt());
        }
        next();
        return { t: 'block', stmts, line: t.line };
      }
      if (is('if')) {
        next(); expect('(', "after 'if'");
        const c = parseExpr(); expect(')', 'to close the if condition');
        const th = parseStmt();
        let el = null;
        if (is('else')) { next(); el = parseStmt(); }
        return { t: 'if', c, th, el, line: t.line };
      }
      if (is('case') || is('casez') || is('casex')) {
        next(); expect('(', "after 'case'");
        const e = parseExpr(); expect(')');
        const items = []; let def = null;
        while (!is('endcase')) {
          if (peek().t === 'eof' || is('endmodule') || is('end')) throw new VError("'case' without a matching 'endcase'", t.line);
          if (is('default')) {
            const dl = next().line; if (is(':')) next();
            if (def) throw new VError('A case can only have one default', dl);
            def = parseStmt();
          } else {
            const vals = [parseExpr()];
            while (is(',')) { next(); vals.push(parseExpr()); }
            expect(':', 'after the case item value');
            items.push({ vals, s: parseStmt() });
          }
        }
        next();
        return { t: 'case', e, items, def, line: t.line };
      }
      if (is(';')) { next(); return { t: 'empty', line: t.line }; }
      if (is('#')) throw new VError("Delays like '#10' are only for testbenches; they are ignored by synthesis. Remove them from the design", t.line);
      if (t.t === 'sys') throw new VError(`${t.v} is a testbench task and cannot be used in the design`, t.line);
      if (is('for') || is('while') || is('repeat') || is('forever')) throw new VError(`'${t.v}' loops are not needed for these questions (and not supported by this checker)`, t.line);
      if (is('else')) throw new VError("'else' without a matching 'if' (check for an extra ';' or a missing begin/end)", t.line);
      if (is('end')) throw new VError("Unexpected 'end' (more 'end' than 'begin'?)", t.line);
      if (is('endmodule')) throw new VError("Unexpected 'endmodule': a begin, case or statement is not finished", t.line);
      if (peek().t === 'kw' && ['always', 'assign', 'reg', 'wire', 'initial'].includes(peek().v))
        throw new VError(`Unexpected '${peek().v}' inside an always block (missing 'end'?)`, t.line);
      const lhs = parseLhs();
      const op = next();
      if (!(op.t === 'op' && (op.v === '=' || op.v === '<='))) throw new VError(`Expected '=' or '<=' after '${lhsText(lhs)}' but found '${tokStr(op)}'`, op.line);
      const rhs = parseExpr();
      expect(';');
      return { t: 'asg', op: op.v, lhs, rhs, line: lhs.line };
    }

    function parseRange() {
      if (!is('[')) return null;
      next(); const msb = parseExpr(); expect(':', 'in the bus range, like [3:0]'); const lsb = parseExpr(); expect(']');
      return { msb, lsb };
    }

    // ---- module
    const mod = { name: '', params: [], ports: [], decls: [], assigns: [], always: [] };
    while (!is('module')) {
      if (peek().t === 'eof') throw new VError("No 'module' found", 1);
      next();
    }
    next();
    mod.name = ident('the module name').v;
    if (is('#')) {
      next(); expect('(');
      while (!is(')')) {
        if (is('parameter')) next();
        if (is('integer')) next();
        parseRange();
        const nm = ident('a parameter name'); expect('=');
        mod.params.push({ name: nm.v, expr: parseExpr(), local: false, line: nm.line });
        if (is(',')) next(); else break;
      }
      expect(')');
    }
    let cur = null;
    if (is('(')) {
      next();
      while (!is(')')) {
        if (is('input') || is('output') || is('inout')) {
          const d = next();
          cur = { dir: d.v, kind: 'wire', range: null, line: d.line };
          if (is('wire')) next(); else if (is('reg')) { next(); cur.kind = 'reg'; }
          if (is('signed')) next();
          cur.range = parseRange();
          const nm = ident('a port name');
          mod.ports.push({ name: nm.v, dir: cur.dir, kind: cur.kind, range: cur.range, line: nm.line, ansi: true });
        } else {
          const nm = ident('a port name');
          if (cur) mod.ports.push({ name: nm.v, dir: cur.dir, kind: cur.kind, range: cur.range, line: nm.line, ansi: true });
          else mod.ports.push({ name: nm.v, dir: null, kind: 'wire', range: null, line: nm.line, ansi: false });
        }
        if (is(',')) next(); else break;
      }
      expect(')', 'to close the port list');
    }
    expect(';', 'after the module header');

    while (!is('endmodule')) {
      const t = peek();
      if (t.t === 'eof') throw new VError("Missing 'endmodule'", t.line);
      if (is('input') || is('output') || is('inout')) {
        const d = next(); let kind = null;
        if (is('wire')) { next(); kind = 'wire'; } else if (is('reg')) { next(); kind = 'reg'; }
        if (is('signed')) next();
        const range = parseRange();
        do { const nm = ident('a port name'); mod.decls.push({ name: nm.v, dir: d.v, kind, range, line: nm.line }); }
        while (is(',') && next());
        expect(';');
        continue;
      }
      if (is('reg') || is('wire') || is('integer') || is('logic')) {
        const k = next(); let kind = k.v === 'wire' ? 'wire' : 'reg';
        if (is('signed')) next();
        let range = parseRange();
        if (k.v === 'integer') range = 'int';
        do {
          const nm = ident('a signal name');
          if (is('[')) throw new VError('Memory arrays are not needed for these questions (and not supported by this checker)', nm.line);
          mod.decls.push({ name: nm.v, dir: null, kind, range, line: nm.line });
          if (is('=')) {
            next();
            const rhs = parseExpr();
            if (kind === 'wire') mod.assigns.push({ lhs: { t: 'id', name: nm.v, line: nm.line }, rhs, line: nm.line });
            else throw new VError(`Initial values on reg declarations ('reg ${nm.v} = ...') are not synthesizable here; use a reset instead`, nm.line);
          }
        } while (is(',') && next());
        expect(';');
        continue;
      }
      if (is('parameter') || is('localparam')) {
        const k = next(); parseRange();
        do {
          const nm = ident('a parameter name'); expect('=');
          mod.params.push({ name: nm.v, expr: parseExpr(), local: k.v === 'localparam', line: nm.line });
        } while (is(',') && next());
        expect(';');
        continue;
      }
      if (is('assign')) {
        next();
        do {
          const lhs = parseLhs(); expect('=', "in the assign statement (assign uses '=', never '<=')");
          mod.assigns.push({ lhs, rhs: parseExpr(), line: lhs.line });
        } while (is(',') && next());
        expect(';');
        continue;
      }
      if (is('always') || is('always_ff') || is('always_comb')) {
        const a = next();
        let sens;
        if (a.v === 'always_comb') sens = { star: true };
        else {
          expect('@', "after 'always' (e.g. always @(posedge clk))");
          if (is('*')) { next(); sens = { star: true }; }
          else {
            expect('(');
            if (is('*')) { next(); expect(')'); sens = { star: true }; }
            else {
              const items = [];
              for (;;) {
                let edge = null;
                if (is('posedge') || is('negedge')) edge = next().v;
                const nm = ident('a signal name in the sensitivity list');
                if (is('[')) throw new VError('Use the whole signal name in the sensitivity list', nm.line);
                items.push({ edge, name: nm.v, line: nm.line });
                if (is('or') || is(',')) { next(); continue; }
                break;
              }
              expect(')', 'to close the sensitivity list');
              sens = { star: false, items };
            }
          }
        }
        mod.always.push({ sens, body: parseStmt(), line: a.line });
        continue;
      }
      if (is('initial')) throw new VError("'initial' blocks are for testbenches only. In the design, use a reset to set starting values", t.line);
      if (is('end')) throw new VError("Unexpected 'end' (more 'end' than 'begin'?)", t.line);
      if (is('begin')) throw new VError("'begin' must come after an always/if/else/case item", t.line);
      if (is('if') || is('case')) throw new VError(`'${t.v}' must be inside an always block`, t.line);
      if (t.t === 'id' && peek(1).t === 'op' && (peek(1).v === '<=' || peek(1).v === '=' || peek(1).v === '['))
        throw new VError(`A statement like '${t.v} ${peek(1).v} ...' must be inside an always block (or use 'assign ${t.v} = ...;')`, t.line);
      if (t.t === 'id' && (peek(1).t === 'id' || is('#', 1))) throw new VError('Instantiating other modules is not needed for these questions (and not supported by this checker)', t.line);
      throw new VError(`Unexpected '${tokStr(t)}'`, t.line);
    }
    next();
    return mod;
  }

  function lhsText(l) {
    if (l.t === 'id') return l.name;
    if (l.t === 'bit') return l.name + '[..]';
    if (l.t === 'part') return l.name + '[..:..]';
    return '{...}';
  }

  // ---------------------------------------------------------------- values
  // value = { v: BigInt, xm: BigInt (x-bit mask), w: Number }
  const mask = w => (1n << BigInt(w)) - 1n;
  const mk = (v, w, xm = 0n) => ({ v: BigInt.asUintN(w, v) & ~xm & mask(w), xm: xm & mask(w), w });
  const X = w => ({ v: 0n, xm: mask(w), w });
  const isX = a => a.xm !== 0n;
  const ext = (a, w) => w <= a.w ? { v: a.v & mask(w), xm: a.xm & mask(w), w } : { v: a.v, xm: a.xm, w };

  function parseNum(tok) {
    let w = tok.size == null ? 32 : tok.size;
    if (w === 0) throw new VError('A number cannot have size 0', tok.line);
    const radix = { b: 2, o: 8, d: 10, h: 16 }[tok.base];
    const bitsPer = { b: 1, o: 3, h: 4 }[tok.base];
    let digits = tok.digits.toLowerCase();
    if (/[xz?]/.test(digits)) {
      if (tok.base === 'd') return X(w);
      let v = 0n, xm = 0n;
      for (const ch of digits) {
        v <<= BigInt(bitsPer); xm <<= BigInt(bitsPer);
        if ('xz?'.includes(ch)) xm |= mask(bitsPer); else v |= BigInt(parseInt(ch, radix));
      }
      // an unsized/ short value with leading x extends x
      return mk(v, w, xm);
    }
    for (const ch of digits) if (isNaN(parseInt(ch, radix)) || parseInt(ch, radix) >= radix) throw new VError(`'${ch}' is not a valid digit in ${tok.text}`, tok.line);
    let v = 0n;
    for (const ch of digits) v = v * BigInt(radix) + BigInt(parseInt(ch, radix));
    return mk(v, w);
  }

  // ---------------------------------------------------------------- elaboration
  function elaborate(mod, overrides = {}) {
    const params = {};
    const warnings = [];
    const sig = {};
    const constEval = (e, what) => {
      const val = evalExpr(e, 0, { params, sig: {}, vals: null, constOnly: true, what, sigNames: sig });
      if (isX(val)) throw new VError(`${what || 'This value'} must be a known constant`, e.line);
      return val;
    };
    for (const pr of mod.params) {
      if (params[pr.name]) throw new VError(`Parameter '${pr.name}' is declared twice`, pr.line);
      if (!pr.local && pr.name in overrides) params[pr.name] = mk(BigInt(overrides[pr.name]), 32);
      else params[pr.name] = constEval(pr.expr, `Parameter '${pr.name}'`);
    }
    const rangeW = (r, line, nm) => {
      if (!r) return { w: 1, lsb: 0 };
      if (r === 'int') return { w: 32, lsb: 0 };
      const msb = Number(constEval(r.msb, 'A bus range').v), lsb = Number(constEval(r.lsb, 'A bus range').v);
      if (msb < lsb) throw new VError(`Use [msb:lsb] with msb >= lsb for '${nm}' (e.g. [3:0])`, line);
      if (msb - lsb + 1 > 64) throw new VError(`'${nm}' is wider than 64 bits`, line);
      return { w: msb - lsb + 1, lsb };
    };
    for (const pt of mod.ports) {
      if (sig[pt.name]) throw new VError(`Port '${pt.name}' is listed twice`, pt.line);
      sig[pt.name] = { name: pt.name, dir: pt.dir, kind: pt.kind, ...rangeW(pt.range, pt.line, pt.name), line: pt.line, port: true, ansi: pt.ansi };
    }
    for (const d of mod.decls) {
      const s = sig[d.name];
      if (params[d.name]) throw new VError(`'${d.name}' is already a parameter`, d.line);
      if (d.dir) {
        if (!s || s.ansi) throw new VError(s ? `'${d.name}' is already declared in the module header` : `'${d.name}' is declared as ${d.dir} but is not in the port list`, d.line);
        s.dir = d.dir; if (d.kind) s.kind = d.kind; Object.assign(s, rangeW(d.range, d.line, d.name)); s.ansi = true;
        continue;
      }
      if (s) {
        if (s.port && !s.ansi) throw new VError(`Port '${d.name}' needs an input/output declaration first`, d.line);
        if (s.port && d.kind === 'reg' && s.dir === 'output' && s.kind !== 'reg' && !s.regDecl) {
          const r = rangeW(d.range, d.line, d.name);
          if (r.w !== s.w) throw new VError(`'reg ${d.name}' width does not match its output declaration`, d.line);
          s.kind = 'reg'; s.regDecl = true; continue;
        }
        if (s.port && s.kind === 'reg' && d.kind === 'reg') throw new VError(`'${d.name}' is already declared as 'output reg' in the header; do not declare it again`, d.line);
        if (s.port && d.kind === 'wire') { warnings.push({ line: d.line, msg: `'${d.name}' is a port; 'wire ${d.name}' is redundant` }); continue; }
        throw new VError(`'${d.name}' is declared twice (first on line ${s.line})`, d.line);
      }
      sig[d.name] = { name: d.name, dir: null, kind: d.kind, ...rangeW(d.range, d.line, d.name), line: d.line, port: false };
    }
    for (const s of Object.values(sig)) if (s.port && !s.dir) throw new VError(`Port '${s.name}' has no input/output declaration`, s.line);
    for (const s of Object.values(sig)) if (s.dir === 'input' && s.kind === 'reg') throw new VError(`Input '${s.name}' cannot be declared as reg`, s.line);

    const env = { params, sig };
    // walk helpers
    const checkExpr = (e) => {
      if (!e) return;
      switch (e.t) {
        case 'id': case 'bit': case 'part':
          if (!sig[e.name] && !params[e.name]) throw new VError(`'${e.name}' is not declared`, e.line);
          if (e.t === 'bit') checkExpr(e.idx);
          if (e.t === 'part') { constEval(e.msb, 'A part-select index'); constEval(e.lsb, 'A part-select index'); }
          break;
        case 'num': parseNum(e.tok); break;
        case 'un': checkExpr(e.e); break;
        case 'bin': checkExpr(e.l); checkExpr(e.r); break;
        case 'tern': checkExpr(e.c); checkExpr(e.a); checkExpr(e.b); break;
        case 'concat': case 'rep':
          if (e.t === 'rep') constEval(e.count, 'A replication count');
          for (const pp of e.parts) {
            if (pp.t === 'num' && pp.tok.size == null) throw new VError(`Unsized number '${pp.tok.text}' inside { }. Give it a size, e.g. 1'b0`, pp.line);
            checkExpr(pp);
          }
          break;
      }
    };
    const lhsNames = (l, out) => {
      if (l.t === 'concat') l.parts.forEach(p => lhsNames(p, out));
      else {
        if (params[l.name]) throw new VError(`'${l.name}' is a parameter (a constant) and cannot be assigned`, l.line);
        if (!sig[l.name]) throw new VError(`'${l.name}' is not declared`, l.line);
        if (l.t === 'bit') checkExpr(l.idx);
        if (l.t === 'part') { constEval(l.msb, 'A part-select index'); constEval(l.lsb, 'A part-select index'); }
        out.push(l);
      }
      return out;
    };
    const drivers = {};
    const addDriver = (name, who, line) => {
      if (drivers[name] && drivers[name].who !== who) throw new VError(`'${name}' is driven from two different places (also on line ${drivers[name].line}). Each signal must be assigned in only one always block or assign`, line);
      drivers[name] = { who, line };
    };
    const procs = [];
    mod.assigns.forEach((a, i) => {
      for (const l of lhsNames(a.lhs, [])) {
        const s = sig[l.name];
        if (s.dir === 'input') throw new VError(`'${l.name}' is an input; a module cannot assign its own inputs`, a.line);
        if (s.kind === 'reg') throw new VError(`'${l.name}' is declared as reg, so it cannot be driven by 'assign'. Either assign it inside an always block, or declare it as wire`, a.line);
        addDriver(l.name, 'assign' + i, a.line);
      }
      checkExpr(a.rhs);
      procs.push({ kind: 'assign', lhs: a.lhs, rhs: a.rhs, line: a.line });
    });
    mod.always.forEach((al, i) => {
      const s = al.sens;
      let kind;
      if (s.star) kind = 'comb';
      else {
        const edges = s.items.filter(x => x.edge).length;
        if (edges && edges !== s.items.length) {
          const bad = s.items.find(x => !x.edge);
          throw new VError(`Sensitivity list mixes edge and level signals: '${bad.name}' has no posedge/negedge. If one signal uses posedge/negedge, all must (e.g. always @(posedge clk or negedge ${bad.name}))`, bad.line);
        }
        for (const it of s.items) if (!sig[it.name]) throw new VError(`'${it.name}' in the sensitivity list is not declared`, it.line);
        kind = edges ? 'seq' : 'level';
      }
      let usedBA = null, usedNBA = null;
      const walk = (st) => {
        if (!st) return;
        switch (st.t) {
          case 'block': st.stmts.forEach(walk); break;
          case 'if': checkExpr(st.c); walk(st.th); walk(st.el); break;
          case 'case': checkExpr(st.e); st.items.forEach(it => { it.vals.forEach(checkExpr); walk(it.s); }); walk(st.def); break;
          case 'asg':
            for (const l of lhsNames(st.lhs, [])) {
              const sg = sig[l.name];
              if (sg.dir === 'input') throw new VError(`'${l.name}' is an input; a module cannot assign its own inputs`, st.line);
              if (sg.kind !== 'reg') throw new VError(`'${l.name}' is a wire, so it cannot be assigned inside an always block. Declare it as reg${sg.dir === 'output' ? ` (output reg ${l.name})` : ''}, or use assign`, st.line);
              addDriver(l.name, 'always' + i, st.line);
            }
            checkExpr(st.rhs);
            if (st.op === '=') usedBA = usedBA || st.line; else usedNBA = usedNBA || st.line;
            break;
        }
      };
      walk(al.body);
      if (kind === 'seq' && usedBA) warnings.push({ line: usedBA, msg: "Blocking '=' inside a clocked always block. Use non-blocking '<=' for flip-flops" });
      if (kind !== 'seq' && usedNBA) warnings.push({ line: usedNBA, msg: "Non-blocking '<=' inside a combinational/level always block. Use '=' there" });
      if (kind === 'seq') for (const it of s.items) {
        const sg = sig[it.name];
        if (sg.w > 1) warnings.push({ line: it.line, msg: `'${it.name}' is ${sg.w} bits; edge detection uses only its bit 0` });
      }
      procs.push({ kind, sens: s, body: al.body, line: al.line, idx: i });
    });
    const outputs = Object.values(sig).filter(s => s.dir === 'output').map(s => s.name);
    for (const o of outputs) if (!drivers[o]) warnings.push({ line: sig[o].line, msg: `Output '${o}' is never assigned` });
    return { mod, params, sig, procs, warnings, outputs, inputs: Object.values(sig).filter(s => s.dir === 'input').map(s => s.name) };
  }

  // ---------------------------------------------------------------- evaluation
  function evalExpr(e, cw, ctx) {
    const { params, sig, vals } = ctx;
    const ref = (name, line) => {
      if (params[name]) return params[name];
      if (ctx.constOnly) {
        if (ctx.sigNames && ctx.sigNames[name]) throw new VError(`${ctx.what || 'This'} must be a constant, but '${name}' is a signal`, line);
        throw new VError(`'${name}' is not declared (or not a constant here)`, line);
      }
      if (!sig[name]) throw new VError(`'${name}' is not declared`, line);
      return vals[name];
    };
    const self = (x) => evalExpr(x, 0, ctx);
    switch (e.t) {
      case 'num': { const v = parseNum(e.tok); return cw > v.w ? ext(v, cw) : v; }
      case 'id': { const v = ref(e.name, e.line); return cw > v.w ? ext(v, cw) : v; }
      case 'bit': {
        const base = ref(e.name, e.line);
        const idx = self(e.idx);
        if (isX(idx)) return ext(X(1), Math.max(1, cw));
        const lsb = sig[e.name] ? sig[e.name].lsb : 0;
        const pos = Number(idx.v) - lsb;
        if (pos < 0 || pos >= base.w) return ext(X(1), Math.max(1, cw));
        const r = { v: (base.v >> BigInt(pos)) & 1n, xm: (base.xm >> BigInt(pos)) & 1n, w: 1 };
        return cw > 1 ? ext(r, cw) : r;
      }
      case 'part': {
        const base = ref(e.name, e.line);
        const msb = Number(evalExpr(e.msb, 0, { ...ctx, constOnly: true, sigNames: sig, what: 'A part-select index' }).v);
        const lsbI = Number(evalExpr(e.lsb, 0, { ...ctx, constOnly: true, sigNames: sig, what: 'A part-select index' }).v);
        const lsb = sig[e.name] ? sig[e.name].lsb : 0;
        if (msb < lsbI) throw new VError(`Part select ${e.name}[${msb}:${lsbI}] is reversed; write it as [msb:lsb]`, e.line);
        const w = msb - lsbI + 1, off = lsbI - lsb;
        if (off < 0 || msb - lsb >= base.w) throw new VError(`Part select ${e.name}[${msb}:${lsbI}] is outside the declared range of '${e.name}'`, e.line);
        const r = { v: (base.v >> BigInt(off)) & mask(w), xm: (base.xm >> BigInt(off)) & mask(w), w };
        return cw > w ? ext(r, cw) : r;
      }
      case 'concat': case 'rep': {
        let parts = e.parts.map(self);
        let count = 1;
        if (e.t === 'rep') {
          count = Number(evalExpr(e.count, 0, { ...ctx, constOnly: true, sigNames: sig, what: 'A replication count' }).v);
          if (count < 1 || count > 64) throw new VError('Replication count must be between 1 and 64', e.line);
        }
        let v = 0n, xm = 0n, w = 0;
        for (let c = 0; c < count; c++) for (const pv of parts) {
          v = (v << BigInt(pv.w)) | pv.v; xm = (xm << BigInt(pv.w)) | pv.xm; w += pv.w;
        }
        const r = { v, xm, w };
        return cw > w ? ext(r, cw) : r;
      }
      case 'un': {
        const op = e.op;
        if (op === '!') { const a = self(e.e); if (isX(a)) return ext(X(1), Math.max(cw, 1)); return ext(mk(a.v === 0n ? 1n : 0n, 1), Math.max(cw, 1)); }
        if (['&', '|', '^', '~&', '~|', '~^', '^~'].includes(op)) {
          const a = self(e.e);
          if (isX(a)) return ext(X(1), Math.max(cw, 1));
          let r;
          if (op === '&' || op === '~&') r = a.v === mask(a.w) ? 1n : 0n;
          else if (op === '|' || op === '~|') r = a.v !== 0n ? 1n : 0n;
          else { let c = 0n, t = a.v; while (t) { c ^= t & 1n; t >>= 1n; } r = c; }
          if (op[0] === '~') r ^= 1n;
          return ext(mk(r, 1), Math.max(cw, 1));
        }
        const a = evalExpr(e.e, cw, ctx); const w = Math.max(a.w, cw);
        if (isX(a)) return X(w);
        if (op === '~') return mk(~a.v, w);
        if (op === '-') return mk(-a.v, w);
        return mk(a.v, w);
      }
      case 'bin': {
        const op = e.op;
        if (op === '&&' || op === '||') {
          const a = self(e.l), b = self(e.r);
          const ta = isX(a) ? null : a.v !== 0n, tb = isX(b) ? null : b.v !== 0n;
          let r;
          if (op === '&&') r = (ta === false || tb === false) ? false : (ta === null || tb === null ? null : true);
          else r = (ta === true || tb === true) ? true : (ta === null || tb === null ? null : false);
          const w = Math.max(cw, 1);
          return r === null ? X(w) : ext(mk(r ? 1n : 0n, 1), w);
        }
        if (['==', '!=', '===', '!==', '<', '<=', '>', '>='].includes(op)) {
          const sa = self(e.l), sb = self(e.r); const w = Math.max(sa.w, sb.w);
          const a = evalExpr(e.l, w, ctx), b = evalExpr(e.r, w, ctx);
          const W = Math.max(cw, 1);
          let r;
          if (op === '===' || op === '!==') { r = a.v === b.v && a.xm === b.xm; if (op === '!==') r = !r; }
          else {
            if (isX(a) || isX(b)) return X(W);
            switch (op) {
              case '==': r = a.v === b.v; break; case '!=': r = a.v !== b.v; break;
              case '<': r = a.v < b.v; break; case '<=': r = a.v <= b.v; break;
              case '>': r = a.v > b.v; break; case '>=': r = a.v >= b.v; break;
            }
          }
          return ext(mk(r ? 1n : 0n, 1), W);
        }
        if (['<<', '>>', '<<<', '>>>'].includes(op)) {
          const a = evalExpr(e.l, cw, ctx), b = self(e.r); const w = Math.max(a.w, cw);
          if (isX(a) || isX(b)) return X(w);
          const s = b.v > 128n ? 128n : b.v;
          return (op[0] === '<') ? mk(a.v << s, w) : mk(a.v >> s, w);
        }
        const a = evalExpr(e.l, cw, ctx), b = evalExpr(e.r, cw, ctx);
        const w = Math.max(a.w, b.w, cw);
        if (['&', '|', '^', '~^', '^~'].includes(op)) {
          const A = ext(a, w), B = ext(b, w);
          let v, xm;
          if (op === '&') { // 0 & x = 0
            const known0 = (~A.v & ~A.xm) | (~B.v & ~B.xm);
            xm = (A.xm | B.xm) & ~known0; v = A.v & B.v;
          } else if (op === '|') {
            const known1 = (A.v & ~A.xm) | (B.v & ~B.xm);
            xm = (A.xm | B.xm) & ~known1; v = A.v | B.v;
          } else { xm = A.xm | B.xm; v = A.v ^ B.v; if (op !== '^') v = ~v; }
          return mk(v, w, xm & mask(w));
        }
        if (isX(a) || isX(b)) return X(w);
        switch (op) {
          case '+': return mk(a.v + b.v, w);
          case '-': return mk(a.v - b.v, w);
          case '*': return mk(a.v * b.v, w);
          case '/': return b.v === 0n ? X(w) : mk(a.v / b.v, w);
          case '%': return b.v === 0n ? X(w) : mk(a.v % b.v, w);
          case '**': return mk(a.v ** b.v, w);
        }
        throw new VError(`Operator '${op}' not supported`, e.line);
      }
      case 'tern': {
        const c = self(e.c);
        const a = evalExpr(e.a, cw, ctx), b = evalExpr(e.b, cw, ctx);
        const w = Math.max(a.w, b.w, cw);
        if (isX(c)) {
          const A = ext(a, w), B = ext(b, w);
          const xm = A.xm | B.xm | (A.v ^ B.v);
          return mk(A.v, w, xm);
        }
        return ext((c.v !== 0n) ? a : b, w);
      }
    }
    throw new VError('Unknown expression', e.line);
  }

  // ---------------------------------------------------------------- simulator
  class RuntimeErr extends Error { }

  class Sim {
    constructor(el) {
      this.el = el;
      this.vals = {};
      for (const s of Object.values(el.sig)) this.vals[s.name] = X(s.w);
      this.comb = el.procs.filter(p => p.kind !== 'seq');
      this.seq = el.procs.filter(p => p.kind === 'seq');
      this.ctx = { params: el.params, sig: el.sig, vals: this.vals };
    }
    snap() { const o = {}; for (const k in this.vals) o[k] = this.vals[k]; return o; }
    key(names) { return names.map(n => { const v = this.vals[n]; return v.v + ':' + v.xm; }).join('|'); }
    // resolve an lhs into concrete targets [{name, off, w}]
    targets(l) {
      if (l.t === 'concat') return l.parts.flatMap(p => this.targets(p));
      const s = this.el.sig[l.name];
      if (l.t === 'id') return [{ name: l.name, off: 0, w: s.w }];
      if (l.t === 'bit') {
        const idx = evalExpr(l.idx, 0, this.ctx);
        if (isX(idx)) return [{ name: l.name, off: -1, w: 1 }];
        const off = Number(idx.v) - s.lsb;
        return [{ name: l.name, off: (off < 0 || off >= s.w) ? -1 : off, w: 1 }];
      }
      const msb = Number(evalExpr(l.msb, 0, { ...this.ctx, constOnly: true, sigNames: this.el.sig }).v);
      const lsb = Number(evalExpr(l.lsb, 0, { ...this.ctx, constOnly: true, sigNames: this.el.sig }).v);
      if (msb < lsb || lsb - s.lsb < 0 || msb - s.lsb >= s.w) throw new VError(`Part select ${l.name}[${msb}:${lsb}] is outside the declared range`, l.line);
      return [{ name: l.name, off: lsb - s.lsb, w: msb - lsb + 1 }];
    }
    write(tgts, val) {
      let total = tgts.reduce((a, t) => a + t.w, 0);
      let v = ext(val, Math.max(total, val.w));
      v = { v: v.v & mask(total), xm: v.xm & mask(total), w: total };
      let shift = 0;
      for (let i = tgts.length - 1; i >= 0; i--) {
        const t = tgts[i];
        const piece = (v.v >> BigInt(shift)) & mask(t.w), pxm = (v.xm >> BigInt(shift)) & mask(t.w);
        shift += t.w;
        if (t.off < 0) continue;
        const cur = this.vals[t.name], m = mask(t.w) << BigInt(t.off);
        this.vals[t.name] = { v: (cur.v & ~m) | (piece << BigInt(t.off)), xm: (cur.xm & ~m) | (pxm << BigInt(t.off)), w: cur.w };
      }
    }
    exec(st, nba) {
      if (!st) return;
      if (++this.steps > 200000) throw new RuntimeErr('Simulation took too many steps');
      switch (st.t) {
        case 'block': for (const s of st.stmts) this.exec(s, nba); return;
        case 'empty': return;
        case 'if': {
          const c = evalExpr(st.c, 0, this.ctx);
          if ((c.v & ~c.xm) !== 0n) this.exec(st.th, nba); else this.exec(st.el, nba);
          return;
        }
        case 'case': {
          const sv = evalExpr(st.e, 0, this.ctx);
          for (const it of st.items) for (const ve of it.vals) {
            const iv = evalExpr(ve, 0, this.ctx);
            const w = Math.max(sv.w, iv.w);
            const A = ext(sv, w), B = ext(iv, w);
            if (A.v === B.v && A.xm === B.xm) { this.exec(it.s, nba); return; }
          }
          this.exec(st.def, nba);
          return;
        }
        case 'asg': {
          const tg = this.targets(st.lhs);
          const w = tg.reduce((a, t) => a + t.w, 0);
          const val = evalExpr(st.rhs, w, this.ctx);
          if (st.op === '<=') nba.push([tg, val]); else this.write(tg, val);
          return;
        }
      }
    }
    runProc(p) {
      const nba = [];
      this.exec(p.body, nba);
      return nba;
    }
    settle() {
      for (let it = 0; it < 300; it++) {
        const before = this.key(Object.keys(this.vals));
        for (const p of this.comb) {
          if (p.kind === 'assign') {
            const tg = this.targets(p.lhs);
            const w = tg.reduce((a, t) => a + t.w, 0);
            this.write(tg, evalExpr(p.rhs, w, this.ctx));
          } else if (p.kind === 'comb') {
            for (const [tg, v] of this.runProc(p)) this.write(tg, v);
          } else { // level-sensitive list
            const k = this.key(p.sens.items.map(i => i.name));
            if (k !== p.last) { p.last = k; for (const [tg, v] of this.runProc(p)) this.write(tg, v); }
          }
        }
        if (this.key(Object.keys(this.vals)) === before) return;
      }
      throw new RuntimeErr('The combinational logic never settles (a combinational loop, e.g. a signal that depends on itself without a clock)');
    }
    static edge(a, b, kind) {
      const pa = (a.xm & 1n) ? 'x' : String(a.v & 1n), pb = (b.xm & 1n) ? 'x' : String(b.v & 1n);
      if (kind === 'posedge') return (pa === '0' && pb !== '0') || (pa === 'x' && pb === '1');
      return (pa === '1' && pb !== '1') || (pa === 'x' && pb === '0');
    }
    apply(changes) {
      this.steps = 0;
      let prev = this.snap();
      for (const k in changes) {
        const s = this.el.sig[k];
        if (!s) continue;
        const raw = changes[k];
        this.vals[k] = raw === 'x' ? X(s.w) : mk(BigInt(raw), s.w);
      }
      for (let it = 0; it < 100; it++) {
        this.settle();
        const trig = this.seq.filter(p => p.sens.items.some(ev => Sim.edge(prev[ev.name], this.vals[ev.name], ev.edge)));
        if (!trig.length) return;
        const nba = [];
        for (const p of trig) nba.push(...this.runProc(p));
        prev = this.snap();
        for (const [tg, v] of nba) this.write(tg, v);
      }
      throw new RuntimeErr('Clocked logic keeps re-triggering itself (a register used as its own clock?)');
    }
    get(name) { return this.vals[name]; }
  }

  // ---------------------------------------------------------------- grading
  function fmtVal(v, base) {
    if (!v) return '?';
    if (isX(v)) {
      if (v.w === 1) return 'x';
      if (base === 'b') { let s = ''; for (let i = v.w - 1; i >= 0; i--) s += ((v.xm >> BigInt(i)) & 1n) ? 'x' : String((v.v >> BigInt(i)) & 1n); return s; }
      return 'x';
    }
    if (base === 'b' || v.w === 1) return v.v.toString(2).padStart(v.w, '0');
    if (base === 'h') return v.v.toString(16).toUpperCase();
    return v.v.toString(10);
  }
  const same = (a, b) => a.w === b.w ? (a.v === b.v && a.xm === b.xm) : false;

  function compile(src, overrides) {
    const mod = parse(src);
    return elaborate(mod, overrides);
  }

  // test = { name, params, init, steps:[{set, tick, label}] , clock:'clk'}
  function grade(userSrc, refSrc, tests, opts = {}) {
    const res = { ok: true, error: null, warnings: [], tests: [], passed: 0, total: 0 };
    let first = true;
    for (const test of tests) {
      let eu, er;
      try { eu = compile(userSrc, test.params || {}); }
      catch (e) { if (e instanceof VError) { res.ok = false; res.error = { msg: e.message, line: e.line }; return res; } throw e; }
      er = compile(refSrc, test.params || {});
      if (first) { res.warnings = eu.warnings; first = false; }
      for (const o of er.outputs) {
        if (!eu.sig[o] || eu.sig[o].dir !== 'output') { res.ok = false; res.error = { msg: `Output '${o}' is missing from your module`, line: 1 }; return res; }
        if (eu.sig[o].w !== er.sig[o].w) { res.ok = false; res.error = { msg: `Output '${o}' should be ${er.sig[o].w} bits wide but is ${eu.sig[o].w}`, line: eu.sig[o].line }; return res; }
      }
      const su = new Sim(eu), sr = new Sim(er);
      const clk = test.clock || 'clk';
      const rows = [];
      const T = { name: test.name, rows, passed: 0, total: 0, runtimeError: null };
      try {
        su.apply(test.init); sr.apply(test.init);
        let cyc = 0;
        for (const st of test.steps) {
          const set = st.set || {};
          su.apply(set); sr.apply(set);
          let label = st.label || '';
          if (st.tick) { cyc++; su.apply({ [clk]: 1 }); sr.apply({ [clk]: 1 }); }
          const inputs = {};
          for (const i of er.inputs) if (i !== clk) inputs[i] = fmtVal(sr.get(i), opts.fmt && opts.fmt[i]);
          const outs = er.outputs.map(o => {
            const exp = sr.get(o), got = su.get(o);
            return { name: o, exp: fmtVal(exp, opts.fmt && opts.fmt[o]), got: fmtVal(got, opts.fmt && opts.fmt[o]), ok: same(exp, got) };
          });
          const ok = outs.every(o => o.ok);
          rows.push({ kind: st.tick ? 'clk' : 'set', cyc, label, inputs, outs, ok });
          T.total++; if (ok) T.passed++;
          if (st.tick) { su.apply({ [clk]: 0 }); sr.apply({ [clk]: 0 }); }
        }
      } catch (e) {
        if (e instanceof RuntimeErr || e instanceof VError) { T.runtimeError = e.message; T.total = Math.max(T.total, test.steps.length); }
        else throw e;
      }
      res.tests.push(T);
      res.passed += T.passed; res.total += T.total;
    }
    return res;
  }

  return { lex, parse, elaborate, compile, Sim, grade, VError, fmtVal };
})();
if (typeof module !== 'undefined') module.exports = VE;
