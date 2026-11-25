// Run the real application handlers with deterministic browser storage failures.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../core.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const KEY='debate-log.v1';
function harness(raw){
  const elements=new Map(),listeners={},blobs=new Map(),downloads=[];
  class Element{
    constructor(){this.textContent='';this.innerHTML='';this.hidden=false;this.disabled=false;this.value='';this.open=false;this.dataset={};this.handlers={};this.classList={add(){},remove(){},toggle(){}};}
    querySelectorAll(){return [];}
    setAttribute(){}
    addEventListener(type,fn){this.handlers[type]=fn;}
    showModal(){this.open=true;}
    close(){this.open=false;}
    focus(){}
    remove(){}
    click(){downloads.push({name:this.download,blob:blobs.get(this.href)});}
  }
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const values=new Map(raw===undefined?[]:[[KEY,raw]]);
  const storage={fail:false,writes:0,getItem:key=>values.get(key)??null,setItem(key,value){this.writes++;if(this.fail)throw new Error('QuotaExceededError');values.set(key,value);}};
  const document={getElementById:element,querySelectorAll:()=>[],addEventListener:(name,fn)=>listeners[name]=fn,visibilityState:'visible',createElement:()=>new Element(),body:{appendChild(){}}};
  const archived=[];
  const window={Debate:D,DebateVault:{put:async(s,d)=>{archived.push({state:D.clone(s),draft:D.clone(d)});},list:async()=>[]},addEventListener:(name,fn)=>listeners['window:'+name]=fn,scrollTo(){}};
  const URL={createObjectURL:blob=>{const key='blob:'+blobs.size;blobs.set(key,blob);return key;},revokeObjectURL(){}};
  vm.runInNewContext(source,{window,document,localStorage:storage,Blob,URL,Date,setTimeout:()=>1,clearTimeout(){},setInterval(){},console});
  function click(dataset){listeners.click({target:{closest:()=>({dataset,disabled:false})}});}
  return {element,storage,values,listeners,click,downloads,archived,state:()=>JSON.parse(values.get(KEY)).state,draft:()=>JSON.parse(values.get(KEY)).draft};
}
function fixture(){const now=Date.now();let s=D.apply(D.fresh(),{type:'start',clap:true},now-60000);return D.apply(s,{type:'speak',speakerId:s.students[0].id},now-55000);}
const wrapped=s=>JSON.stringify({state:s,draft:{text:'',turnId:null}});
test('refresh recovers the real persisted turns, observations, speaker and wall clock',()=>{
  const s=fixture(),h=harness(wrapped(s));
  assert.equal(h.element('current-speaker').textContent,'A');assert.equal(h.element('record-count').textContent,1);
  assert.equal(h.element('save-status').textContent,'저장 자료 복구됨');
  assert.match(h.element('clock').textContent,/00:01:0\d/);
  h.click({tag:'핵심 질문'});const after=h.state();assert.equal(after.turns[0].atMs,5000);assert.equal(after.observations[0].value,'핵심 질문');
  const restored=harness(h.values.get(KEY));assert.equal(restored.element('observation-count').textContent,'관찰 1개');
});
test('failed autosave exposes persistent alert, retains memory and retries all unsaved turns',()=>{
  const s=fixture(),h=harness(wrapped(s));h.storage.fail=true;
  h.click({speak:s.students[1].id});
  assert.equal(h.state().turns.length,1);assert.equal(h.element('record-count').textContent,2);
  assert.equal(h.element('storage-alert').hidden,false);assert.match(h.element('storage-message').textContent,/自動|자동 저장에 실패/);
  h.click({speak:s.students[2].id});assert.equal(h.element('record-count').textContent,3);
  h.storage.fail=false;h.element('retry-save').onclick();assert.equal(h.state().turns.length,3);assert.equal(h.element('storage-alert').hidden,true);
});
test('corrupt stored JSON remains byte-for-byte intact and cannot be overwritten by taps',()=>{
  const raw='{ broken',h=harness(raw);assert.equal(h.storage.writes,0);
  assert.equal(h.element('storage-alert').hidden,false);assert.equal(h.element('raw-export').hidden,false);
  h.click({speak:'anything'});assert.equal(h.values.get(KEY),raw);assert.equal(h.storage.writes,0);
  h.element('raw-export').onclick();assert.equal(h.downloads.length,1);
});
test('another tab changing storage blocks a stale tab from overwriting it',()=>{
  const s=fixture(),h=harness(wrapped(s));
  const other=D.apply(s,{type:'speak',speakerId:s.students[4].id});const raw=wrapped(other);h.values.set(KEY,raw);
  h.click({speak:s.students[1].id});assert.equal(h.values.get(KEY),raw);
  assert.match(h.element('storage-message').textContent,/다른 탭/);assert.equal(h.element('retry-save').hidden,true);
});
test('unsent memo survives refresh and remains attached to original speaker after switching',()=>{
  const s=fixture(),h=harness(wrapped(s));
  h.element('memo').value='표본을 비교함';h.element('memo').oninput();
  assert.equal(h.draft().turnId,s.turns[0].id);
  const restored=harness(h.values.get(KEY));assert.equal(restored.element('memo').value,'표본을 비교함');
  restored.click({speak:s.students[1].id});restored.element('add-memo').onclick();
  const state=restored.state();assert.equal(state.turns.length,2);assert.equal(state.observations[0].turnId,s.turns[0].id);assert.equal(restored.draft().text,'');
});
test('CSV, JSON and text buttons create real downloadable Blobs containing Korean and timing data',async()=>{
  const s=fixture(),h=harness(wrapped(s));
  h.element('tools-button').onclick();
  for(const type of ['csv','json','txt'])h.click({export:type});
  assert.equal(h.downloads.length,3);
  const [csv,json,txt]=await Promise.all(h.downloads.map(d=>d.blob.text()));
  const bytes=new Uint8Array(await h.downloads[0].blob.arrayBuffer());assert.deepEqual(Array.from(bytes.slice(0,3)),[0xEF,0xBB,0xBF]);
  assert.ok(csv.includes('발언 시작(녹음 보정)'));assert.ok(csv.includes('시간 맞춤 신호'));
  assert.equal(JSON.parse(json).turns[0].atMs,5000);assert.ok(txt.includes('박수 기준 표시'));
  assert.equal(h.element('download-link').hidden,false);assert.ok(h.element('download-link').download.endsWith('.txt'));
});
test('JSON restore archives current session, recovers data and draft, and excludes derived export rows',async()=>{
  const original=fixture(),h=harness(wrapped(original));let imported=fixture();
  imported=D.apply(imported,{type:'end'});const parsed=JSON.parse(D.json(imported));parsed.draft={text:'복원 메모',turnId:imported.turns[0].id};
  const pending=h.element('import-file').onchange({target:{files:[{size:1000,text:async()=>JSON.stringify(parsed)}],value:'file.json'}});
  await new Promise(setImmediate);h.element('confirm-ok').onclick();await pending;
  const s=h.state();assert.equal(s.status,'ended');assert.equal(s.turns[0].id,imported.turns[0].id);assert.notEqual(s.sessionId,imported.sessionId);
  assert.equal(s.records,undefined);assert.equal(s.exportedAt,undefined);assert.equal(h.draft().turnId,imported.turns[0].id);
  assert.equal(h.archived[0].state.sessionId,original.sessionId);assert.equal(h.archived[0].state.status,'ended');
});
