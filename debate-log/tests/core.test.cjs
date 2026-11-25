const {test}=require('node:test');
const assert=require('node:assert/strict');
const D=require('../core.js');
const START=1700000000000;
function started(){return D.apply(D.fresh(),{type:'start'},START);}
function speak(s,index,ms){return D.apply(s,{type:'speak',speakerId:s.students[index].id},START+ms);}
test('student taps immediately create distinct turns, including rapid and repeated taps',()=>{
  let s=started();
  for(const [index,ms] of [[0,1000],[1,1100],[2,1100],[2,1200],[3,1300]])s=speak(s,index,ms);
  assert.equal(s.turns.length,5);assert.deepEqual(s.turns.map(t=>t.atMs),[1000,1100,1100,1200,1300]);
  assert.equal(new Set(s.turns.map(t=>t.id)).size,5);assert.equal(D.current(s).speakerId,s.students[3].id);
  const rows=D.rows(s,START+2000).filter(r=>r.type==='발언');
  assert.deepEqual(rows.map(r=>r.durationMs),[100,0,100,100,700]);
});
test('late observations preserve turn start, and memo can target prior speaker',()=>{
  let s=speak(started(),0,1200),a=s.turns[0];
  s=D.apply(s,{type:'tag',value:'수학적 근거'},START+9500);
  assert.equal(s.turns[0].atMs,1200);assert.equal(s.observations[0].atMs,9500);
  s=speak(s,1,10000);s=D.apply(s,{type:'memo',turnId:a.id,value:'근거를 비교함'},START+12000);
  assert.equal(s.observations[1].turnId,a.id);assert.equal(s.turns[1].atMs,10000);
  s=D.apply(s,{type:'tag',value:'핵심 질문'},START+13000);
  assert.equal(s.observations[2].turnId,s.turns[1].id);
});
test('tag toggles are undoable and undo removes observations with their associated turn',()=>{
  let s=speak(started(),0,1000);
  s=D.apply(s,{type:'tag',value:'개념 구분'},START+2000);
  s=D.apply(s,{type:'tag',value:'개념 구분'},START+3000);assert.equal(s.observations.length,0);
  s=D.apply(s,{type:'undo'});assert.equal(s.observations.length,1);
  s=D.apply(s,{type:'undo'});assert.equal(s.observations.length,0);
  s=D.apply(s,{type:'undo'});assert.equal(s.turns.length,0);
});
test('wall clock survives serialization, sleep and reload, freezes after end, undo end resumes original clock',()=>{
  let s=speak(started(),0,1000);
  s=D.validate(JSON.parse(JSON.stringify(s)));
  assert.equal(D.elapsed(s,START+2*3600000),7200000);
  s=D.apply(s,{type:'end'},START+7200123);
  assert.equal(D.elapsed(s,START+9000000),7200123);
  s=D.validate(JSON.parse(JSON.stringify(s)));assert.equal(D.elapsed(s,START+9900000),7200123);
  s=D.apply(s,{type:'undo'},START+9900000);assert.equal(D.elapsed(s,START+9900000),9900000);
});
test('silence and unknown turns keep the continuous recording timeline',()=>{
  let s=speak(started(),0,1000);
  s=D.apply(s,{type:'speak',kind:'silence'},START+10000);
  s=D.apply(s,{type:'speak',kind:'unknown'},START+30000);
  s=speak(s,3,60000);assert.equal(D.elapsed(s,START+65000),65000);
  assert.deepEqual(D.ordered(s).map(t=>D.speaker(s,t)),['A','발언 없음','화자 불명','D']);
});
test('editing time, speaker, phase and observations works without resetting observation timestamps',()=>{
  let s=speak(started(),0,1500);s=D.apply(s,{type:'tag',value:'개념 구분'},START+2000);
  s=D.apply(s,{type:'memo',turnId:s.turns[0].id,value:'기존 메모'},START+2500);s=speak(s,1,5000);
  const t=s.turns[0],m=s.observations.find(o=>o.type==='memo');
  const action={type:'edit',turnId:t.id,atMs:6000,speakerId:s.students[4].id,kind:'student',phase:'자유토론',tags:['개념 구분','반례 제시'],memos:[{id:m.id,value:'수정 메모'}],newMemo:'추가 메모'};
  s=D.apply(s,action,START+7000);
  assert.equal(D.current(s).id,t.id);assert.equal(s.turns[0].atMs,6000);assert.equal(s.turns[0].speakerId,s.students[4].id);
  assert.equal(s.observations.find(o=>o.id===m.id).atMs,2500);assert.equal(s.observations.find(o=>o.value==='개념 구분').atMs,2000);
  assert.equal(s.observations.find(o=>o.value==='추가 메모').atMs,7000);
  assert.throws(()=>D.apply(s,{...action,atMs:9000},START+8000),/현재 경과/);
  assert.throws(()=>D.apply(s,{...action,atMs:-1},START+8000),/현재 경과/);
});
test('offset changes exports only and does not alter source timing',()=>{
  let s=speak(started(),0,1500);s=D.apply(s,{type:'offset',offsetMs:8250},START+2000);
  const row=D.rows(s,START+5000)[0];assert.equal(s.turns[0].atMs,1500);assert.equal(row.turnStart,'00:00:01.500');assert.equal(row.recordingStart,'00:00:09.750');assert.equal(row.recordingEnd,'00:00:13.250');
  s=D.apply(s,{type:'offset',offsetMs:-3000});assert.equal(D.rows(s,START+5000)[0].recordingStart,'-00:00:01.500');
});
test('exports retain Korean, quotes and newlines, distinguish observations, prevent spreadsheet formulas',()=>{
  let s=speak(started(),0,1000);s=D.apply(s,{type:'memo',turnId:s.turns[0].id,value:'=HYPERLINK("test")\n한글, 관찰'},START+2000);
  const csv=D.csv(s,START+3000);assert.equal(csv.charCodeAt(0),0xFEFF);assert.ok(csv.includes('"발언"'));assert.ok(csv.includes('"관찰"'));assert.ok(csv.includes("'="));assert.ok(csv.includes('""test""'));assert.ok(csv.includes('한글, 관찰'));
  const json=JSON.parse(D.json(s,START+3000));assert.equal(json.history,undefined);assert.equal(json.elapsedMs,3000);assert.equal(json.observations[0].atMs,2000);assert.equal(json.turns[0].atMs,1000);
  assert.ok(D.plain(s,START+3000).includes('관찰 추가 00:00:02.000'));
});
test('phase changes are explicit time events, exportable even without speech',()=>{
  let s=started();s=D.apply(s,{type:'phase',phase:'자유토론'},START+20000);s=speak(s,0,21000);
  assert.equal(s.turns[0].phase,'자유토론');assert.equal(s.phaseEvents[1].atMs,20000);
  assert.ok(D.rows(s,START+22000).some(r=>r.type==='단계 변경'&&r.turnStart==='00:00:20.000'));
});
test('invalid or corrupt data and unsupported operations are rejected',()=>{
  assert.throws(()=>D.validate({}));let s=started();
  assert.throws(()=>D.apply(s,{type:'speak',speakerId:'does-not-exist'},START+1000));
  assert.throws(()=>D.apply(s,{type:'configure',topic:'x',students:s.students,tags:[]}));
  assert.throws(()=>D.apply(s,{type:'memo',turnId:'missing',value:'hello'},START+2000));
  assert.throws(()=>D.apply(s,{type:'start'},START+1000));
  assert.throws(()=>D.parseTime('00:65:00'));assert.throws(()=>D.parseTime('abc'));
  assert.equal(D.parseTime('01:02:03.5'),3723500);assert.equal(D.format(3723500,true),'01:02:03.500');
});
test('silent clap marker survives export, refresh and undo without affecting speaker timing',()=>{
  let s=D.apply(D.fresh(),{type:'start',clap:true},START);assert.equal(s.syncEvents[0].atMs,0);
  s=speak(s,0,1000);s=D.apply(s,{type:'sync'},START+15000);
  assert.equal(s.syncEvents[1].atMs,15000);assert.equal(s.turns[0].atMs,1000);
  assert.equal(JSON.parse(D.json(s,START+20000)).syncEvents.length,2);
  s=D.apply(s,{type:'undo'});assert.equal(s.syncEvents.length,1);assert.equal(s.turns.length,1);
});
test('long sessions keep undo storage proportional to changes rather than full snapshots',()=>{
  let s=started();for(let i=0;i<1000;i++)s=speak(s,i%6,(i+1)*1000);
  assert.equal(s.turns.length,1000);assert.equal(s.history.length,40);
  assert.ok(JSON.stringify(s.history).length<20000);assert.ok(JSON.stringify(s).length<300000);
  s=D.apply(s,{type:'undo'});assert.equal(s.turns.length,999);assert.equal(D.current(s).speakerId,s.students[998%6].id);
});
test('moderator speech has its own continuous interval, observations, editing and exports',()=>{
  let s=speak(started(),0,1000);s=D.apply(s,{type:'speak',kind:'moderator'},START+5000);
  const moderator=D.current(s);assert.equal(moderator.speakerId,null);assert.equal(D.speaker(s,moderator),'사회자');
  s=D.apply(s,{type:'tag',value:'핵심 질문'},START+7000);s=D.apply(s,{type:'memo',turnId:moderator.id,value:'질문을 정리함'},START+8000);
  s=D.apply(s,{type:'speak',kind:'silence'},START+10000);s=speak(s,3,13000);
  assert.equal(s.observations[0].turnId,moderator.id);assert.equal(moderator.atMs,5000);
  const row=D.rows(s,START+16000).find(r=>r.type==='발언'&&r.speaker==='사회자');assert.equal(row.durationMs,5000);assert.equal(row.side,'');
  assert.ok(D.csv(s).includes('사회자'));assert.ok(D.plain(s).includes('사회자'));D.validate({...JSON.parse(D.json(s)),history:[]});
  const edit={type:'edit',turnId:s.turns[3].id,speakerId:null,kind:'moderator',atMs:13000,phase:'입론',tags:[],memos:[],newMemo:''};
  s=D.apply(s,edit,START+16000);assert.equal(D.current(s).kind,'moderator');s=D.apply(s,{type:'undo'});assert.equal(D.current(s).kind,'student');
});
