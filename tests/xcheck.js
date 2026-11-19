// Cross-check engine traces against Icarus Verilog for given (question, source) pairs.
const VE=require('../src/engine.js'), Q=require('../src/questions.js');
const {execSync}=require('child_process'); const fs=require('fs');
const full=(q,body)=>q.head+'\n'+body+'\nendmodule\n';
function engineTrace(src, test){
  const el=VE.compile(src,test.params||{}); const s=new VE.Sim(el); const clk=test.clock||'clk';
  const out=[]; const fm=v=>VE.fmtVal(v,'b');
  s.apply(test.init);
  for(const st of test.steps){ s.apply(st.set||{}); if(st.tick) s.apply({[clk]:1});
    out.push(el.outputs.map(o=>fm(s.get(o))).join(' ')); if(st.tick) s.apply({[clk]:0}); }
  return {out, el};
}
function ivTrace(src, test, el){
  const clk=test.clock||'clk';
  const ins=el.inputs, outs=el.outputs;
  const decl=n=>{const w=el.sig[n].w; return w>1?`[${w-1}:0] `:'';};
  let tb='`timescale 1ns/1ps\nmodule tb;\n';
  for(const i of ins) tb+=`reg ${decl(i)}${i};\n`;
  for(const o of outs) tb+=`wire ${decl(o)}${o};\n`;
  const ps=Object.entries(test.params||{}).map(([k,v])=>`.${k}(${v})`).join(',');
  tb+=`${el.mod.name} ${ps?'#('+ps+') ':''}uut(${[...ins,...outs].map(n=>`.${n}(${n})`).join(',')});\n`;
  tb+='initial begin\n';
  for(const [k,v] of Object.entries(test.init)) if(el.sig[k]) tb+=`${k}=${v};\n`;
  tb+='#10;\n';
  for(const st of test.steps){
    for(const [k,v] of Object.entries(st.set||{})) tb+=`${k}=${v};\n`;
    tb+='#10;\n';
    const disp=`$display("${outs.map(()=> '%b').join(' ')}", ${outs.join(',')});\n`;
    if(st.tick){ tb+=`${clk}=1; #10; ${disp} ${clk}=0; #10;\n`; } else tb+=disp;
  }
  tb+='$finish;\nend\nendmodule\n';
  fs.writeFileSync('/tmp/x_dut.v',src); fs.writeFileSync('/tmp/x_tb.v',tb);
  execSync('iverilog -o /tmp/x_sim /tmp/x_dut.v /tmp/x_tb.v 2>/tmp/x_err');
  return execSync('vvp -n /tmp/x_sim').toString().trim().split('\n').filter(l=>!l.includes('$finish'));
}
function check(q, body, label){
  const src=full(q,body); let mism=0, total=0;
  for(const t of q.tests()){
    const {out, el}=engineTrace(src,t); const iv=ivTrace(src,t,el);
    for(let i=0;i<out.length;i++){ total++; if(out[i]!==iv[i]){ mism++; if(mism<4) console.log(`   ${label} ${t.name} step ${i}: engine=${out[i]} iverilog=${iv[i]}`);} }
  }
  return {mism,total};
}
module.exports={check};
if(require.main===module){
  for(const q of Q){ const r=check(q,q.solution,q.id); console.log(q.id.padEnd(12), r.mism?`MISMATCH ${r.mism}/${r.total}`:`ok ${r.total}`); }
}
