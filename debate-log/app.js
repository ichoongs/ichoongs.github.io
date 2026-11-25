/* All student data stays in this origin's localStorage. No network calls. */
(function () {
  'use strict';
  const D = window.Debate, vault=window.DebateVault, KEY = 'debate-log.v1';
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let state = D.fresh(), draft = {text:'',turnId:null}, lastSavedRaw = null, corrupt = false, conflict = false, dirty = false, savedAt = null, toastTimer, bootError = '';
  let setupStudents = [];
  let cancelCountdown=null;
  let libraryBusy=false;
  try {
    lastSavedRaw = localStorage.getItem(KEY);
    if (lastSavedRaw !== null) {
      const stored = JSON.parse(lastSavedRaw);
      state = D.validate(stored.state);
      if (stored.draft && typeof stored.draft.text === 'string') draft = {text:stored.draft.text,turnId:stored.draft.turnId};
    }
  } catch (error) {
    if (lastSavedRaw !== null) corrupt = true;
    bootError = corrupt ? '저장 자료를 읽지 못했습니다. 원본 자료를 내려받아 보관한 뒤 JSON 백업을 복원하거나 새 토론을 만들어 주세요. 기존 자료는 덮어쓰지 않았습니다.' : '브라우저 저장소를 사용할 수 없습니다. 현재 기록은 화면에만 유지됩니다. 파일을 내보내 보관해 주세요.';
  }
  const dateStamp = () => new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').hidden=true,3500); }
  function showStorageError(message) { $('storage-alert').hidden=false; $('storage-message').textContent=message; $('save-status').textContent='저장 확인 필요'; $('save-status').classList.add('error'); $('raw-export').hidden=!corrupt; $('retry-save').hidden=corrupt||conflict; }
  function setConflict() { conflict=true; showStorageError('다른 탭에서 자료가 변경되었습니다. 이 탭의 편집을 멈췄습니다. 필요하면 이 탭의 파일을 내보낸 뒤 새로고침해 주세요.'); renderDisabled(); }
  function ensureWritable() {
    if(corrupt) throw new Error('손상된 자료의 원본을 보관한 뒤 백업 복원 또는 새 토론을 선택해 주세요.');
    if(conflict) throw new Error('다른 탭의 기록을 보호하기 위해 새로고침이 필요합니다.');
    try { if (localStorage.getItem(KEY)!==lastSavedRaw) {setConflict(); throw new Error('다른 탭에서 기록이 변경되었습니다. 새로고침해 주세요.');} }
    catch(e) { if(conflict) throw e; /* Storage unavailable: preserve in-memory recording and show failed-save banner. */ }
  }
  function save() {
    if(corrupt||conflict) return false;
    dirty=true;
    try {
      if (localStorage.getItem(KEY)!==lastSavedRaw) {setConflict(); return false;}
      const raw=JSON.stringify({state,draft});
      localStorage.setItem(KEY,raw);
      // A write may fail silently in unusual browser configurations.
      if(localStorage.getItem(KEY)!==raw) throw new Error('저장 검증 실패');
      lastSavedRaw=raw; dirty=false; savedAt=dateStamp(); $('storage-alert').hidden=true; $('save-status').classList.remove('error'); $('save-status').textContent='자동 저장됨 · '+savedAt; return true;
    } catch(e) { showStorageError('자동 저장에 실패했습니다. 저장 공간 또는 Safari 설정을 확인하고 재시도하세요. 새로고침하면 저장하지 못한 기록이 사라질 수 있으니 지금 파일을 내보내 주세요.'); return false; }
  }
  function commit(action, options={}) {
    try { ensureWritable(); state=D.apply(state,action); save(); if(options.render!==false) renderSession(); if(state.status==='ended')vault.put(state,draft).catch(()=>toast('현재 기록은 유지됩니다. 지난 토론 보관함 저장에 실패해 JSON 백업이 필요합니다.')); return true; }
    catch(error) {toast(error.message); return false;}
  }
  function renderDisabled() {
    const locked=corrupt||conflict;
    document.querySelectorAll('.student-button,.tag-button,#moderator-button,#unknown-button,#silence-button,#add-memo,#end-button,#undo-button,#phases button').forEach(b=>b.disabled=locked||state.status!=='running');
    $('undo-button').disabled=locked||!state.history.length;
    $('setup-form').querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=locked);
    $('offset-form').querySelectorAll('button,input').forEach(el=>el.disabled=locked);
    $('swap-seats').disabled=locked;$('tools-swap-seats').disabled=locked;
    const noTurn=!D.current(state);
    document.querySelectorAll('.tag-button').forEach(b=>b.disabled=b.disabled||noTurn);
    $('memo').disabled=locked||state.status!=='running'||noTurn;
    $('add-memo').disabled=locked||state.status!=='running'||!draft.text.trim()||!draft.turnId;
  }
  function renderSetup() {
    setupStudents=D.clone(state.students); $('topic').value=state.topic; $('setup-tags').value=state.tags.join('\n'); renderRoster();
  }
  function renderRoster() {
    D.seatSides(state).forEach((side,i)=> {
      const people=setupStudents.filter(p=>p.side===side);
      const position=i===0?'left':'right';
      $(position+'-roster-title').textContent=side+' · '+(i===0?'왼쪽':'오른쪽')+' 좌석';
      $(position+'-roster-title').className=side==='찬성'?'pro-text':'con-text';
      $(position+'-add-student').dataset.addSide=side;$(position+'-add-student').textContent='+ '+side+' 학생 추가';
      $(position+'-roster').innerHTML=people.map((p,n)=>`<div class="roster-row" data-person="${escape(p.id)}"><input aria-label="${side} ${n+1} 학생 이름" value="${escape(p.name)}" maxlength="40" required><select aria-label="${escape(p.name)} 입장"><option${side==='찬성'?' selected':''}>찬성</option><option${side==='반대'?' selected':''}>반대</option></select><div class="roster-actions"><button type="button" data-roster="up" aria-label="${escape(p.name)} 좌석 위로" ${n===0?'disabled':''}>위</button><button type="button" data-roster="down" aria-label="${escape(p.name)} 좌석 아래로" ${n===people.length-1?'disabled':''}>아래</button><button type="button" data-roster="remove" aria-label="${escape(p.name)} 삭제">삭제</button></div></div>`).join('');
    });
  }
  function configure(render=false) {
    const ok=commit({type:'configure',topic:$('topic').value,students:setupStudents,tags:$('setup-tags').value.split('\n')},{render:false});
    if(ok&&render) renderRoster(); return ok;
  }
  function tick() {
    $('clock').textContent=D.format(D.elapsed(state));
    $('recording-clock').textContent=state.offsetMs?'녹음 '+D.format(D.elapsed(state)+state.offsetMs):'녹음과 같은 시간축';
    const t=D.current(state);
    if(t) $('current-time').textContent='시작 '+D.format(t.atMs)+' · '+(state.status==='ended'?'종료된 구간':(['student','moderator'].includes(t.kind)?'발언 중 ':'구간 경과 ')+D.format(D.elapsed(state)-t.atMs));
  }
  function recordMarkup(t) {
    const p=state.students.find(p=>p.id===t.speakerId), obs=state.observations.filter(o=>o.turnId===t.id);
    const tags=obs.filter(o=>o.type==='tag').map(o=>'<span class="record-tag">'+escape(o.value)+'</span>').join('');
    const memo=obs.filter(o=>o.type==='memo').map(o=>escape(o.value)).join(' · ');
    return `<div class="record-row"><span class="record-time">${D.format(t.atMs)}</span><span class="record-speaker">${escape(D.speaker(state,t))}<span class="record-side">${escape(p?.side||'화자 구간')}</span></span><span class="record-phase">${escape(t.phase)}</span><div class="record-observations">${tags}${memo?'<span>'+memo+'</span>':''}${!obs.length?'관찰 없음':''}</div><button data-edit="${escape(t.id)}" aria-label="${D.format(t.atMs)} ${escape(D.speaker(state,t))} 기록 수정" ${corrupt||conflict?'disabled':''}>수정</button></div>`;
  }
  function renderSession() {
    const started=state.status!=='ready', current=D.current(state);
    $('setup-screen').hidden=started; $('debate-screen').hidden=!started;
    $('live-topic').textContent=state.topic;
    $('student-count').textContent=state.students.length+'명';
    $('session-status').textContent=state.status==='ended'?'토론 종료':'진행 중';
    $('clock-label').textContent=state.status==='ended'?'최종 경과 시간':'경과 시간';
    $('current-caption').textContent=state.status==='ended'?'마지막 발언 구간':'현재 발언자';
    $('current-speaker').textContent=current?D.speaker(state,current):'발언자를 선택하세요';
    if(!current) $('current-time').textContent='첫 발언부터 시각이 기록됩니다.';
    $('live-help').textContent=state.status==='ended'?'기록을 확인하고 파일로 보관해 주세요.':'학생을 누르면 바로 기록됩니다.';
    $('end-button').hidden=state.status==='ended';
    $('phases').innerHTML=D.PHASES.map(p=>`<button class="${D.phase(state)===p?'active':''}" data-phase="${p}" aria-pressed="${D.phase(state)===p}">${p}</button>`).join('');
    const sides=D.seatSides(state);
    $('seating-summary').textContent='교사가 보는 기준 · 왼쪽 '+sides[0]+' / 오른쪽 '+sides[1];
    D.seatSides(state).forEach((side,i)=> {
      const position=i===0?'left':'right';
      $(position+'-seat-panel').className='seat-column '+(side==='찬성'?'pro':'con');
      $(position+'-side-label').textContent=side;
      $(position+'-seats').innerHTML=state.students.filter(p=>p.side===side).map(p=>`<button class="student-button ${current?.speakerId===p.id?'active':''}" data-speak="${escape(p.id)}" aria-pressed="${current?.speakerId===p.id}"><span class="student-name">${escape(p.name)}</span><span class="student-mark">${current?.speakerId===p.id?(state.status==='ended'?'마지막 화자':'발언 중'):'발언 기록'}</span></button>`).join('');
    });
    $('live-tags').innerHTML=state.tags.map(tag=> {
      const on=!!current&&state.observations.some(o=>o.turnId===current.id&&o.type==='tag'&&o.value===tag);
      return `<button class="tag-button ${on?'active':''}" data-tag="${escape(tag)}" aria-pressed="${on}">${escape(tag)}</button>`;
    }).join('');
    $('moderator-button').classList.toggle('active',current?.kind==='moderator');$('moderator-button').setAttribute('aria-pressed',current?.kind==='moderator');
    $('unknown-button').classList.toggle('active',current?.kind==='unknown'); $('silence-button').classList.toggle('active',current?.kind==='silence');
    $('unknown-button').setAttribute('aria-pressed',current?.kind==='unknown'); $('silence-button').setAttribute('aria-pressed',current?.kind==='silence');
    const list=D.ordered(state).reverse();
    $('record-count').textContent=state.turns.length;
    $('observation-count').textContent='관찰 '+state.observations.length+'개';
    $('recent-list').innerHTML=list.length?list.slice(0,20).map(recordMarkup).join(''):'<div class="empty-state"><strong>아직 발언 기록이 없어요.</strong><span>왼쪽 또는 오른쪽의 학생을 누르면 기록이 시작됩니다.</span></div>';
    if($('records-dialog').open) renderAllRecords();
    renderMemoTarget(); renderDisabled(); tick();
  }
  function renderMemoTarget() {
    $('memo-target').hidden=!draft.text;
    if(draft.text) { const target=state.turns.find(t=>t.id===draft.turnId); $('memo-target').textContent=target?'메모 대상: '+D.speaker(state,target)+' · '+D.format(target.atMs)+' (입력 내용도 임시 저장됨)':'메모 대상 발언이 취소되었습니다. 내용을 복사한 뒤 입력란을 비우고 새로 입력하세요.'; }
  }
  function renderAllRecords() { $('all-records').innerHTML=D.ordered(state).map(recordMarkup).join('')||'<p class="hint">아직 발언 기록이 없습니다.</p>'; }
  function confirmAction(title,message,ok='확인') {
    return new Promise(resolve=>{
      $('confirm-title').textContent=title; $('confirm-message').textContent=message; $('confirm-ok').textContent=ok;
      const dialog=$('confirm-dialog');
      const finish=value=>{dialog.close();dialog.oncancel=null;resolve(value);};
      $('confirm-ok').onclick=()=>finish(true); $('confirm-cancel').onclick=()=>finish(false); dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.showModal(); $('confirm-cancel').focus();
    });
  }
  function openTools() {
    $('offset').value=state.offsetMs/1000; renderOffsetExample(); $('repeat-signal').disabled=state.status!=='running'||corrupt||conflict; $('tools-dialog').showModal();
  }
  function renderOffsetExample() {
    $('sync-reference').textContent=state.syncEvents.length?state.syncEvents.map((e,i)=>'박수 기준 '+(i+1)+' · 앱 '+D.format(e.atMs,true)).join(' / '):'아직 박수 기준 표시가 없습니다. 시작 직후 박수를 쳤다면 앱 00:00:00을 기준으로 사용하세요.';
    $('offset-example').textContent='예: 앱 표시 00:00:00, 녹음 박수 00:00:08이면 +8초. 현재 적용값: '+(state.offsetMs/1000)+'초.';
  }
  function startCountdown(onGo) {
    if(cancelCountdown)return;
    const dialog=$('countdown-dialog'),deadline=Date.now()+3000;let timer;
    const stop=()=>{clearTimeout(timer);cancelCountdown=null;dialog.oncancel=null;dialog.close();};
    cancelCountdown=()=>{stop();toast('카운트다운을 취소했습니다.');};
    $('countdown-cancel').onclick=()=>cancelCountdown?.();dialog.oncancel=e=>{e.preventDefault();cancelCountdown?.();};
    $('countdown-number').textContent='3';$('countdown-caption').textContent='숫자가 끝나면 다 같이 박수!';$('countdown-cancel').hidden=false;dialog.showModal();
    function step(){
      if(document.visibilityState!=='visible'){cancelCountdown?.();return;}
      const remaining=deadline-Date.now();
      if(remaining>0){$('countdown-number').textContent=String(Math.ceil(remaining/1000));timer=setTimeout(step,50);return;}
      if(remaining < -1000){cancelCountdown?.();toast('화면이 지연되어 취소했습니다. 다시 시작해 주세요.');return;}
      if(!onGo()){stop();return;}
      $('countdown-number').textContent='지금';$('countdown-caption').textContent='다 같이 박수 한 번!';$('countdown-cancel').hidden=true;
      cancelCountdown=null;dialog.oncancel=e=>e.preventDefault();timer=setTimeout(stop,1100);
    }
    timer=setTimeout(step,50);
  }
  async function archiveBeforeSwitch() {
    if(corrupt)return;
    ensureWritable();
    if(state.status==='ready'&&!state.turns.length)return;
    if(state.status==='running'){state=D.apply(state,{type:'end'});save();renderSession();}
    await vault.put(state,draft);
    ensureWritable();
  }
  async function openLibrary(){
    if($('tools-dialog').open)$('tools-dialog').close();
    $('library-list').innerHTML='<p class="hint">보관함을 불러오는 중입니다.</p>';$('library-error').textContent='';if(!$('library-dialog').open)$('library-dialog').showModal();
    try {
      const sessions=await vault.list();
      $('library-list').innerHTML=sessions.length?sessions.map(entry=>`<article class="library-row"><div><strong>${escape(entry.state.topic)}</strong><p class="hint">${new Date(entry.state.startedAt??entry.savedAt).toLocaleString('ko-KR')} · ${entry.state.students.length}명 · 발언 ${entry.state.turns.length}개 · ${entry.state.status==='ended'?'종료':'보관됨'}</p></div><div class="library-actions"><button class="button small" data-open-session="${escape(entry.sessionId)}" ${entry.sessionId===state.sessionId||corrupt||conflict?'disabled':''}>${entry.sessionId===state.sessionId?'현재 토론':'열기'}</button><button class="button small danger" data-delete-session="${escape(entry.sessionId)}" aria-label="${escape(entry.state.topic)} 삭제" ${corrupt||conflict||(entry.sessionId===state.sessionId&&state.status==='running')?'disabled':''}>삭제</button></div></article>`).join(''):'<div class="empty-state">아직 보관한 토론이 없어요. 종료하거나 새 토론을 준비하면 보관됩니다.</div>';
    }catch(error){$('library-list').innerHTML='';$('library-error').textContent='보관함을 열 수 없습니다. 현재 자료를 JSON으로 내보내 주세요. '+error.message;}
  }
  async function loadSession(sessionId){
    if(libraryBusy)return;
    if(corrupt||conflict){toast('현재 저장 상태를 먼저 확인해 주세요.');return;}
    try{
      const entry=await vault.get(sessionId);if(!entry)throw new Error('보관한 토론을 찾을 수 없습니다.');D.validate(entry.state);
      if(!await confirmAction('보관한 토론을 열까요?',state.status==='running'?'진행 중인 토론을 종료하여 보관한 뒤 선택한 토론으로 전환합니다.':'현재 토론을 보관한 뒤 선택한 토론으로 전환합니다.','보관 후 열기'))return;
      await archiveBeforeSwitch();state={...entry.state,history:[]};draft=entry.draft||{text:'',turnId:null};$('memo').value=draft.text;
      save();renderSetup();renderSession();$('library-dialog').close();window.scrollTo(0,0);toast('보관한 토론을 열었습니다.');
    }catch(error){$('library-error').textContent='전환하지 못했습니다. '+error.message;}
  }
  async function removeSession(sessionId){
    if(libraryBusy)return;
    libraryBusy=true;
    try{
      ensureWritable();
      if(sessionId===state.sessionId&&state.status==='running')throw new Error('진행 중인 토론은 종료한 뒤 삭제해 주세요.');
      const entry=await vault.get(sessionId);if(!entry)throw new Error('이미 삭제되었거나 보관한 토론을 찾을 수 없습니다.');
      const isCurrent=sessionId===state.sessionId;
      const message='“'+entry.state.topic+'”\n'+new Date(entry.state.startedAt??entry.savedAt).toLocaleString('ko-KR')+'\n\n이 토론의 발언·관찰 기록을 기기에서 삭제합니다. 삭제는 되돌릴 수 없으니 필요하면 JSON으로 먼저 내보내 주세요.'+(isCurrent?'\n현재 열린 종료 토론입니다. 학생·주제·태그 설정을 유지한 새 토론 준비 화면으로 돌아갑니다.':'');
      if(!await confirmAction('지난 토론을 삭제할까요?',message,'토론 삭제'))return;
      ensureWritable();
      if(sessionId===state.sessionId){
        if(state.status==='running')throw new Error('진행 중인 토론은 삭제할 수 없습니다.');
        const previous=state,previousDraft=draft,next=D.fresh();
        next.topic=state.topic;next.students=D.clone(state.students);next.tags=state.tags.slice();next.leftSide=state.leftSide;state=next;draft={text:'',turnId:null};
        // Clear the active autosave first so a refresh cannot resurrect the deleted session.
        // If writing fails, leave the archive intact and retain the in-memory records.
        if(!save()){state=previous;draft=previousDraft;renderSession();throw new Error('현재 자료 저장 상태를 확인해 주세요. 보관함 기록은 삭제하지 않았습니다.');}
        $('memo').value='';renderSetup();renderSession();
      }
      await vault.remove(sessionId);
      await openLibrary();toast('지난 토론을 삭제했습니다.');
    }catch(error){$('library-error').textContent='삭제하지 못했습니다. '+error.message;}
    finally{libraryBusy=false;}
  }
  function openEdit(turnId) {
    const t=state.turns.find(t=>t.id===turnId); if(!t) return;
    $('edit-id').value=t.id;
    $('edit-speaker').innerHTML=state.students.map(p=>`<option value="${escape(p.id)}">${escape(p.name)} · ${p.side}</option>`).join('')+'<option value="moderator">사회자</option><option value="unknown">화자 불명</option><option value="silence">발언 없음</option>';
    $('edit-speaker').value=t.kind==='student'?t.speakerId:t.kind;
    $('edit-time').value=D.format(t.atMs,true);
    $('edit-phase').innerHTML=D.PHASES.map(p=>`<option>${p}</option>`).join(''); $('edit-phase').value=t.phase;
    const observations=state.observations.filter(o=>o.turnId===t.id);
    const tags=[...new Set(state.tags.concat(observations.filter(o=>o.type==='tag').map(o=>o.value)))];
    $('edit-tags').innerHTML=tags.map(tag=>`<label><input type="checkbox" value="${escape(tag)}" ${observations.some(o=>o.type==='tag'&&o.value===tag)?'checked':''}>${escape(tag)}</label>`).join('');
    $('edit-memos').innerHTML=observations.filter(o=>o.type==='memo').map(o=>`<label>메모 · 관찰 추가 ${D.format(o.atMs)}<textarea data-memo-id="${escape(o.id)}" rows="2" maxlength="4000">${escape(o.value)}</textarea></label>`).join('');
    $('edit-new-memo').value=''; $('edit-error').textContent=''; $('edit-dialog').showModal();
  }
  function download(content,extension,mime) {
    const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=$('tools-dialog').open?$('download-link'):document.createElement('a');
    a.href=url; a.download='동아리토론_'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+extension;
    if($('tools-dialog').open){a.hidden=false;a.textContent='다운로드가 시작되지 않으면 누르세요 · '+extension.toUpperCase();}
    else document.body.appendChild(a);
    a.click();if(a!==$('download-link'))a.remove();
    // Keep a direct, user-tappable fallback link alive until the next export.
    if(a!==$('download-link'))setTimeout(()=>URL.revokeObjectURL(url),60000);
    if(a===$('download-link')){if(a.dataset.previousUrl)URL.revokeObjectURL(a.dataset.previousUrl);a.dataset.previousUrl=url;}
    toast('파일 내려받기를 요청했습니다. 브라우저 다운로드 목록을 확인하세요.');
  }
  function exportFile(type) {
    // Keep unfinished memo in JSON without assigning it to another speaker.
    const now=Date.now();
    if(type==='csv') download(D.csv(state,now),'csv','text/csv;charset=utf-8');
    if(type==='txt') download(D.plain(state,now)+(draft.text?'\n\n[미추가 메모 초안] 대상 발언 ID: '+draft.turnId+'\n'+draft.text:''),'txt','text/plain;charset=utf-8');
    if(type==='json') {const data=JSON.parse(D.json(state,now));data.draft=draft;download(JSON.stringify(data,null,2),'json','application/json;charset=utf-8');}
    if(type==='csv'&&draft.text) toast('CSV에는 추가된 관찰만 포함됩니다. 작성 중 메모는 추가하거나 JSON으로 보관하세요.');
  }
  $('setup-form').addEventListener('submit',e=>{e.preventDefault(); if(!configure()) return;startCountdown(()=>{if(commit({type:'start',clap:true})){window.scrollTo(0,0);return true;}return false;});});
  $('setup-form').addEventListener('input',e=> {
    const row=e.target.closest('[data-person]');
    if(row&&e.target.matches('input')) {const p=setupStudents.find(p=>p.id===row.dataset.person);p.name=e.target.value;if(p.name.trim())configure();}
    if(e.target.id==='topic'&&e.target.value.trim())configure();
    if(e.target.id==='setup-tags')configure();
  });
  $('setup-form').addEventListener('change',e=> {
    const row=e.target.closest('[data-person]');
    if(row&&e.target.matches('select')) {setupStudents.find(p=>p.id===row.dataset.person).side=e.target.value;configure(true);}
  });
  document.addEventListener('click',e=> {
    const b=e.target.closest('button'); if(!b||b.disabled)return;
    if(b.dataset.close) $(b.dataset.close).close();
    if(b.dataset.speak)commit({type:'speak',speakerId:b.dataset.speak});
    if(b.dataset.tag)commit({type:'tag',value:b.dataset.tag});
    if(b.dataset.phase)commit({type:'phase',phase:b.dataset.phase});
    if(b.dataset.edit)openEdit(b.dataset.edit);
    if(b.dataset.export)exportFile(b.dataset.export);
    if(b.dataset.openSession)loadSession(b.dataset.openSession);
    if(b.dataset.deleteSession)return removeSession(b.dataset.deleteSession);
    if(b.dataset.addSide) {if(setupStudents.length>=30){toast('학생은 최대 30명까지 배치할 수 있습니다.');return;}setupStudents.push({id:D.id(),name:'새 학생',side:b.dataset.addSide});configure(true);}
    if(b.dataset.roster) {
      const row=b.closest('[data-person]'), index=setupStudents.findIndex(p=>p.id===row.dataset.person),p=setupStudents[index];
      if(b.dataset.roster==='remove'){if(setupStudents.length===1){toast('학생은 한 명 이상 필요합니다.');return;}setupStudents.splice(index,1);}
      else {const same=setupStudents.filter(x=>x.side===p.side), n=same.findIndex(x=>x.id===p.id),other=same[n+(b.dataset.roster==='up'?-1:1)];if(other){const j=setupStudents.findIndex(x=>x.id===other.id);[setupStudents[index],setupStudents[j]]=[setupStudents[j],setupStudents[index]];}}
      configure(true);
    }
  });
  $('unknown-button').onclick=()=>commit({type:'speak',kind:'unknown'});
  $('moderator-button').onclick=()=>commit({type:'speak',kind:'moderator'});
  $('silence-button').onclick=()=>commit({type:'speak',kind:'silence'});
  $('memo').value=draft.text;
  $('memo').oninput=()=>{
    try {ensureWritable();if(!draft.text)draft.turnId=D.current(state)?.id||null;draft.text=$('memo').value;if(!draft.text)draft.turnId=null;save();renderMemoTarget();renderDisabled();}catch(e){toast(e.message);}
  };
  function addMemo() {
    if(!draft.text.trim())return true;
    const retained=draft;draft={text:'',turnId:null};
    if(commit({type:'memo',turnId:retained.turnId,value:retained.text})){$('memo').value='';renderMemoTarget();return true;}
    draft=retained;renderMemoTarget();return false;
  }
  $('add-memo').onclick=addMemo;
  $('undo-button').onclick=()=>{if(commit({type:'undo'})) {if(state.status==='ready')renderSetup();toast('직전 작업을 취소했습니다.');}};
  $('end-button').onclick=async()=>{
    if(await confirmAction('토론을 종료할까요?','종료하면 최종 경과 시간이 고정됩니다. 종료 후에도 기록을 수정하고 내보낼 수 있어요.','토론 종료')) {
      if(!addMemo())return;
      if(commit({type:'end'}))toast('토론을 종료했습니다. 파일을 내보내 보관해 주세요.');
    }
  };
  $('edit-form').onsubmit=e=>{
    e.preventDefault();
    try {
      const speaker=$('edit-speaker').value,kind=['moderator','unknown','silence'].includes(speaker)?speaker:'student';
      const action={type:'edit',turnId:$('edit-id').value,speakerId:kind==='student'?speaker:null,kind,atMs:D.parseTime($('edit-time').value),phase:$('edit-phase').value,tags:Array.from($('edit-tags').querySelectorAll('input:checked')).map(x=>x.value),memos:Array.from($('edit-memos').querySelectorAll('textarea')).map(x=>({id:x.dataset.memoId,value:x.value})),newMemo:$('edit-new-memo').value};
      ensureWritable();const next=D.apply(state,action);state=next;save();renderSession();if(state.status==='ended')vault.put(state,draft).catch(()=>toast('보관함 갱신에 실패했습니다. 현재 자료를 JSON으로 보관해 주세요.'));$('edit-dialog').close();toast('기록을 수정했습니다.');
    }catch(error){$('edit-error').textContent=error.message;}
  };
  $('tools-button').onclick=openTools; $('export-button').onclick=openTools;
  function swapSeats(){if(commit({type:'swapSeats'})){renderRoster();renderDisabled();toast('찬반 좌석의 좌우 위치를 바꿨습니다.');}}
  $('swap-seats').onclick=swapSeats;$('tools-swap-seats').onclick=swapSeats;
  $('library-button').onclick=openLibrary;$('open-library').onclick=openLibrary;
  $('repeat-signal').onclick=()=>{if(state.status!=='running')return;$('tools-dialog').close();startCountdown(()=>commit({type:'sync'}));};
  $('all-records-button').onclick=()=>{renderAllRecords();$('records-dialog').showModal();};
  $('offset-form').onsubmit=e=>{e.preventDefault();const value=Number($('offset').value);if(Number.isFinite(value)&&Math.abs(value)<=86400&&commit({type:'offset',offsetMs:Math.round(value*1000)})){renderOffsetExample();toast('녹음 시간 보정값을 적용했습니다.');}};
  $('retry-save').onclick=()=>{if(save())toast('기기 저장소에 저장했습니다.');};
  $('raw-export').onclick=()=>download(lastSavedRaw||'','recovery.json','application/json;charset=utf-8');
  $('new-session').onclick=async()=>{
    if(conflict){toast('다른 탭의 변경을 불러오려면 새로고침해 주세요.');return;}
    if(!await confirmAction('새 토론을 준비할까요?',corrupt?'손상된 현재 자료를 새 토론으로 대체합니다. 원본 자료를 먼저 내려받아 주세요.':'현재 토론을 종료하여 기기 보관함에 저장합니다. 학생·주제·태그는 다음 토론에 이어집니다.','보관하고 새 토론'))return;
    try {
      await archiveBeforeSwitch();
      const next=D.fresh();if(!corrupt){next.students=D.clone(state.students);next.tags=state.tags.slice();next.topic=state.topic;next.leftSide=state.leftSide;}
      state=next;draft={text:'',turnId:null};corrupt=false;$('memo').value='';save();renderSetup();renderSession();$('tools-dialog').close();window.scrollTo(0,0);toast('새 토론을 준비했습니다. 지난 기록은 보관함에서 열 수 있어요.');
    }catch(e){toast('보관에 실패해 현재 자료를 유지했습니다. JSON으로 내보내 주세요. '+e.message);}
  };
  $('import-file').onchange=async e=>{
    const file=e.target.files[0];e.target.value='';if(!file)return;
    if(file.size>20*1024*1024){toast('20MB 이하의 JSON 백업을 선택해 주세요.');return;}
    try {
      const parsed=JSON.parse(await file.text());
      const fields=D.fresh();
      const candidate=D.validate(Object.fromEntries(Object.entries({...parsed,history:[],revision:0}).filter(([key])=>Object.prototype.hasOwnProperty.call(fields,key))));
      if(candidate.students.length>30)throw new Error('30명 이하의 학생 자료만 복원할 수 있습니다.');
      if(candidate.startedAt>Date.now())throw new Error('시작 시각이 현재보다 미래입니다. 기기 시각을 확인해 주세요.');
      if(!await confirmAction('JSON 백업을 복원할까요?','현재 토론을 종료하여 보관한 뒤 전환합니다. 진행 중인 백업은 원래 시작 시각부터 경과 시간이 이어집니다.','백업 복원'))return;
      if(conflict)throw new Error('다른 탭에서 자료가 바뀌었습니다. 새로고침 후 복원해 주세요.');
      await archiveBeforeSwitch();
      state={...candidate,sessionId:D.id()};draft=parsed.draft&&typeof parsed.draft.text==='string'?{text:parsed.draft.text,turnId:parsed.draft.turnId}:{text:'',turnId:null};corrupt=false;
      $('memo').value=draft.text;save();renderSetup();renderSession();$('tools-dialog').close();toast('백업을 복원했습니다.');
    }catch(error){toast('백업 복원 실패: '+error.message);}
  };
  window.addEventListener('storage',e=>{if(e.key===KEY||e.key===null) {if(e.newValue!==lastSavedRaw)setConflict();}});
  window.addEventListener('beforeunload',e=>{if(dirty||conflict){e.preventDefault();e.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){cancelCountdown?.();if(dirty)save();}else if(document.visibilityState==='visible')tick();});
  window.addEventListener('pageshow',()=>{try{if(localStorage.getItem(KEY)!==lastSavedRaw)setConflict();}catch(e){}tick();});
  renderSetup();renderSession();
  if(bootError)showStorageError(bootError);else if(lastSavedRaw===null)save();else{$('save-status').textContent='저장 자료 복구됨';}
  setInterval(tick,250);
}());
