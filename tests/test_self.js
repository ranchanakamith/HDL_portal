const VE=require('../src/engine.js'), Q=require('../src/questions.js');
const full=(q,body)=>q.head+'\n'+body+'\nendmodule\n';
let bad=0;
for(const q of Q){
  const ref=full(q,q.solution);
  const r=VE.grade(ref,ref,q.tests(),{fmt:q.fmt});
  const st = r.error? 'ERR '+r.error.msg : `${r.passed}/${r.total}` + (r.tests.some(t=>t.runtimeError)?' RT:'+r.tests.map(t=>t.runtimeError).join(','):'');
  if(r.error||r.passed!==r.total) bad++;
  console.log(q.id.padEnd(12), st, r.warnings.map(w=>w.msg).join('; '));
}
console.log('bad',bad);
