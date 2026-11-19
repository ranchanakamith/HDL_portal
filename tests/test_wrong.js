const VE=require('../src/engine.js'), Q=require('../src/questions.js'), {check}=require('./xcheck.js');
const byId=Object.fromEntries(Q.map(q=>[q.id,q]));
const full=(q,b)=>q.head+'\n'+b+'\nendmodule\n';
const cases=[
 ['dff-async','sync reset',`always @(posedge clk) if(!rst_n) q<=0; else q<=d;`],
 ['dff-async','blocking (works, warns)',`always @(posedge clk or negedge rst_n) if(!rst_n) q=0; else q=d;`],
 ['dff-async','mixed sens',`always @(rst_n or posedge clk) if(!rst_n) q<=0; else q<=d;`],
 ['dff-async','assign to reg',`assign q = d;`],
 ['dff-async','missing semicolon',`always @(posedge clk or negedge rst_n)\n if(!rst_n) q<=0\n else q<=d;`],
 ['dff-async','undeclared',`always @(posedge clk or negedge reset) if(!reset) q<=0; else q<=d;`],
 ['dff-sync-en','async reset',`always @(posedge clk or posedge rst) if(rst) q<=0; else if(en) q<=d;`],
 ['dff-sync-en','en ignored',`always @(posedge clk) if(rst) q<=0; else q<=d;`],
 ['dff-n','hard 8 bits',`always @(posedge clk or negedge rst_n) if(!rst_n) q<=8'b0; else q<=d;`],
 ['counter4','no enable',`always @(posedge clk or negedge rst_n) if(!rst_n) count<=0; else count<=count+1;`],
 ['updown','load after up',`always @(posedge clk or negedge rst_n) if(!rst_n) q<=0; else if(up) q<=q+1; else if(load) q<=din; else q<=q-1;`],
 ['sipo','shift right',`always @(posedge clk or negedge rst_n) if(!rst_n) q<=0; else q<={sin,q[N-1:1]};\n assign sout=q[N-1];`],
 ['sipo','hard-coded 4',`always @(posedge clk or negedge rst_n) if(!rst_n) q<=0; else q<={q[2:0],sin};\n assign sout=q[3];`],
 ['bcd','counts to 10',`always @(posedge clk or negedge rst_n) if(!rst_n) q<=0; else if(q==10) q<=0; else q<=q+1;\n assign tc=(q==9);`],
 ['jk','no toggle',`always @(posedge clk or negedge rst_n) if(!rst_n) q<=0; else case({j,k}) 2'b01:q<=0; 2'b10:q<=1; endcase`],
 ['edge','blocking order bug',`always @(posedge clk or negedge rst_n) if(!rst_n) begin sig_d=0; pulse=0; end else begin sig_d=sig; pulse=sig&~sig_d; end`],
 ['edge','combinational pulse',`always @(posedge clk or negedge rst_n) if(!rst_n) sig_d<=0; else sig_d<=sig;\n always @(*) pulse = sig & ~sig_d;`],
 ['johnson','ring instead',`always @(posedge clk or negedge rst_n) if(!rst_n) q<=0; else q<={q[2:0],q[3]};`],
 ['modm','hard 6',`always @(posedge clk or negedge rst_n) if(!rst_n) q<=0; else if(q==5) q<=0; else q<=q+1;\n assign tc=(q==5);`],
 ['fsm101','non-overlap',`always @(posedge clk or negedge rst_n) if(!rst_n) state<=S0; else state<=next;\n always @(*) begin next=S0; case(state) S0: next = x?S1:S0; S1: next=x?S1:S2; S2: next=x?S3:S0; S3: next=x?S1:S0; endcase end\n assign y=(state==S3);`],
 ['latch','missing d in list',`always @(en) if(en) q=d;`],
 ['latch','star version',`always @(*) if(en) q=d;`],
 ['clkdiv','unsized in concat',`always @(posedge clk) cnt <= {1, cnt[0]};\n assign clk_div4=cnt[1]; always @(posedge clk) clk_div2<=~clk_div2;`],
 ['clkdiv','no reset',`always @(posedge clk) cnt<=cnt+1;\n always @(posedge clk) clk_div2<=~clk_div2;\n assign clk_div4=cnt[1];`],
 ['piso','wire assigned in always',`always @(posedge clk) sout <= sr[3];`],
 ['fsm101','initial block',`initial state = S0;`],
 ['counter4','extra end',`always @(posedge clk or negedge rst_n) begin if(!rst_n) count<=0; else if(en) count<=count+1; end end`],
];
for(const [id,label,body] of cases){
  const q=byId[id]; const r=VE.grade(full(q,body), full(q,q.solution), q.tests(), {fmt:q.fmt});
  let s = r.error? `COMPILE ERROR line ${r.error.line}: ${r.error.msg}` : `${r.passed}/${r.total}`;
  if(!r.error && r.warnings.length) s+='  [warn: '+r.warnings.map(w=>w.msg).join('; ')+']';
  let xc='';
  if(!r.error){ try{ const c=check(q,body,id); xc = c.mism?` XCHECK MISMATCH ${c.mism}/${c.total}`:' (iverilog agrees)'; }catch(e){ xc=' (iverilog compile failed)'; } }
  console.log(`${id} | ${label}: ${s}${xc}`);
}
