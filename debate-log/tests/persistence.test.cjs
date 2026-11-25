// Run the real application handlers with deterministic browser storage failures.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const D=require('../core.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const KEY='debate-log.v1';
function harness(raw,entries=[]){
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
  const library=new Map(entries.map(e=>[e.sessionId,e]));
  const vault={failRemove:false,put:async(s,d)=>{const entry={sessionId:s.sessionId,state:D.clone(s),draft:D.clone(d),savedAt:Date.now()};archived.push(entry);library.set(s.sessionId,entry);},list:async()=>Array.from(library.values()),get:async id=>library.get(id),remove:async id=>{if(vault.failRemove)throw new Error('IndexedDB failure');library.delete(id);}};
  const window={Debate:D,DebateVault:vault,addEventListener:(name,fn)=>listeners['window:'+name]=fn,scrollTo(){}};
  const URL={createObjectURL:blob=>{const key='blob:'+blobs.size;blobs.set(key,blob);return key;},revokeObjectURL(){}};
  vm.runInNewContext(source,{window,document,localStorage:storage,Blob,URL,Date,setTimeout:()=>1,clearTimeout(){},setInterval(){},console});
  function click(dataset){return listeners.click({target:{closest:()=>({dataset,disabled:false})}});}
  return {element,storage,values,listeners,click,downloads,archived,library,vault,state:()=>JSON.parse(values.get(KEY)).state,draft:()=>JSON.parse(values.get(KEY)).draft};
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
const entry=s=>({sessionId:s.sessionId,state:s,draft:{text:'',turnId:null},savedAt:Date.now()});
async function confirmDelete(h,id,accept=true){const pending=h.click({deleteSession:id});await new Promise(setImmediate);h.element(accept?'confirm-ok':'confirm-cancel').onclick();await pending;}
test('moderator button records immediately and restores the current speaker on refresh',()=>{
  const h=harness(wrapped(fixture()));h.element('moderator-button').onclick();const s=h.state();
  assert.equal(D.current(s).kind,'moderator');assert.equal(h.element('current-speaker').textContent,'사회자');
  const restored=harness(h.values.get(KEY));assert.equal(restored.element('current-speaker').textContent,'사회자');
});
test('deleting a past session respects cancel and leaves the running session unchanged',async()=>{
  const current=fixture(),old=D.apply(fixture(),{type:'end'}),h=harness(wrapped(current),[entry(old)]);
  await confirmDelete(h,old.sessionId,false);assert.equal(h.library.size,1);assert.equal(h.state().sessionId,current.sessionId);
  await confirmDelete(h,old.sessionId);assert.equal(h.library.size,0);assert.equal(h.state().sessionId,current.sessionId);assert.equal(h.state().status,'running');
});
test('deleting the currently open ended session clears autosave and cannot resurrect on refresh',async()=>{
  const s=D.apply(fixture(),{type:'end'}),h=harness(wrapped(s),[entry(s)]);
  await confirmDelete(h,s.sessionId);assert.equal(h.library.size,0);assert.equal(h.state().status,'ready');assert.equal(h.state().turns.length,0);assert.equal(h.state().history.length,0);assert.notEqual(h.state().sessionId,s.sessionId);
  assert.deepEqual(h.state().students,s.students);const restored=harness(h.values.get(KEY));assert.equal(restored.element('record-count').textContent,0);
});
test('failed current-session reset or archive delete retains the archive and reports the error',async()=>{
  for(const failure of ['storage','indexedDB']){
    const s=D.apply(fixture(),{type:'end'}),current=failure==='storage'?s:fixture(),h=harness(wrapped(current),[entry(s)]);
    if(failure==='storage')h.storage.fail=true;else h.vault.failRemove=true;
    await confirmDelete(h,s.sessionId);assert.equal(h.library.size,1);assert.match(h.element('library-error').textContent,/삭제하지 못했습니다/);
    assert.equal(h.state().sessionId,current.sessionId);assert.equal(h.state().turns.length,current.turns.length);
  }
});
test('running current session cannot be deleted even when invoked directly',async()=>{
  const s=fixture(),h=harness(wrapped(s),[entry(s)]);await h.click({deleteSession:s.sessionId});
  assert.equal(h.library.size,1);assert.match(h.element('library-error').textContent,/진행 중/);assert.equal(h.state().status,'running');
});
