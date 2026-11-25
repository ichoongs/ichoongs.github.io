(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Debate = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PHASES = ['입론', '자유토론', '최종변론'];
  const DEFAULT_TAGS = ['개념 구분', '수학적 근거', '편향성 분석', '사례 제시', '반례 제시', '핵심 질문', '논리적 반론', '관점 변화', '대안 제시', '의견 종합'];
  let sequence = 0;
  const id = () => Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const clone = value => JSON.parse(JSON.stringify(value));
  function fresh() {
    return { schemaVersion: 1, sessionId: id(), revision: 0, topic: '빅데이터 알고리즘의 편향성 — 수학은 과연 거짓말을 하지 않을까?', students: ['A','B','C','D','E','F'].map((name, i) => ({ id: id(), name, side: i < 3 ? '찬성' : '반대' })), tags: DEFAULT_TAGS.slice(), leftSide:'찬성', status: 'ready', startedAt: null, endedAt: null, offsetMs: 0, turns: [], observations: [], phaseEvents: [], syncEvents:[], history: [] };
  }
  function elapsed(s, now = Date.now()) {
    return s.startedAt === null ? 0 : Math.max(0, (s.endedAt === null ? now : s.endedAt) - s.startedAt);
  }
  function ordered(s) { return s.turns.map((t,i) => ({...t, order:i})).sort((a,b) => a.atMs - b.atMs || a.order - b.order); }
  function current(s) { const list = ordered(s); return list[list.length - 1] || null; }
  function phase(s) { return s.phaseEvents.length ? s.phaseEvents[s.phaseEvents.length - 1].phase : PHASES[0]; }
  function seatSides(s) { const left=s.leftSide??'찬성';return [left,left==='찬성'?'반대':'찬성']; }
  function validate(s) {
    if (!s || s.schemaVersion !== 1 || !['ready','running','ended'].includes(s.status) || typeof s.topic !== 'string' || !s.topic.trim() || !Number.isInteger(s.revision) || s.revision < 0 || typeof s.sessionId !== 'string') throw new Error('지원하지 않거나 손상된 저장 자료입니다.');
    if (!Array.isArray(s.students) || !s.students.length || s.students.some(p => typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim() || !['찬성','반대'].includes(p.side))) throw new Error('학생 설정이 올바르지 않습니다.');
    if (new Set(s.students.map(p=>p.id)).size !== s.students.length || !Array.isArray(s.tags) || s.tags.some(t=>typeof t !== 'string' || !t.trim()) || !Number.isFinite(s.offsetMs)) throw new Error('설정 자료가 올바르지 않습니다.');
    if (s.status === 'ready' ? s.startedAt !== null || s.endedAt !== null : !Number.isFinite(s.startedAt) || (s.status === 'running' ? s.endedAt !== null : !Number.isFinite(s.endedAt) || s.endedAt < s.startedAt)) throw new Error('토론 시간 자료가 올바르지 않습니다.');
    if(s.syncEvents===undefined)s.syncEvents=[];
    if(s.leftSide===undefined)s.leftSide='찬성';
    if(!['찬성','반대'].includes(s.leftSide))throw new Error('좌석 배치 설정이 올바르지 않습니다.');
    if (!Array.isArray(s.turns) || !Array.isArray(s.observations) || !Array.isArray(s.phaseEvents) || !Array.isArray(s.history) || !Array.isArray(s.syncEvents)) throw new Error('기록 목록이 올바르지 않습니다.');
    const validTime = n => Number.isFinite(n) && n >= 0;
    if (s.turns.some(t=>typeof t.id !== 'string' || !validTime(t.atMs) || !PHASES.includes(t.phase) || !['student','moderator','unknown','silence'].includes(t.kind) || (t.kind === 'student' ? !s.students.some(p=>p.id===t.speakerId) : t.speakerId !== null))) throw new Error('발언 자료가 올바르지 않습니다.');
    if (new Set(s.turns.map(t=>t.id)).size !== s.turns.length || s.observations.some(o=>typeof o.id !== 'string' || !s.turns.some(t=>t.id===o.turnId) || !validTime(o.atMs) || !['tag','memo'].includes(o.type) || typeof o.value !== 'string') || s.phaseEvents.some(p=>!validTime(p.atMs) || !PHASES.includes(p.phase))) throw new Error('관찰 자료가 올바르지 않습니다.');
    if(s.syncEvents.some(e=>typeof e.id!=='string'||!validTime(e.atMs)||typeof e.label!=='string'))throw new Error('시간 맞춤 신호 자료가 올바르지 않습니다.');
    if (s.status === 'ready' && (s.turns.length || s.observations.length || s.phaseEvents.length || s.syncEvents.length)) throw new Error('시작 전 기록이 올바르지 않습니다.');
    if (s.status === 'ended' && s.turns.some(t=>t.atMs > elapsed(s))) throw new Error('종료 이후 발언 시간이 있습니다.');
    return s;
  }
  function undoPatch(before, after) {
    const patch={fields:{},arrays:{}};
    for(const key of Object.keys(before)) {
      if(['history','revision'].includes(key)||JSON.stringify(before[key])===JSON.stringify(after[key]))continue;
      if(Array.isArray(before[key])) {
        const a=before[key],b=after[key];let start=0,end=0;
        while(start<Math.min(a.length,b.length)&&JSON.stringify(a[start])===JSON.stringify(b[start]))start++;
        while(end<Math.min(a.length,b.length)-start&&JSON.stringify(a[a.length-1-end])===JSON.stringify(b[b.length-1-end]))end++;
        patch.arrays[key]={index:start,removeCount:b.length-start-end,items:clone(a.slice(start,a.length-end))};
      }else patch.fields[key]=clone(before[key]);
    }
    return patch;
  }
  function apply(s, action, now = Date.now()) {
    const next = clone(s);
    if (action.type === 'undo') {
      if (!s.history.length) return next;
      const previous = clone(s.history[s.history.length-1]);
      if(previous.schemaVersion) return validate({...previous,revision:s.revision+1,history:s.history.slice(0,-1)});
      Object.assign(next,previous.fields);
      for(const [key,patch] of Object.entries(previous.arrays))next[key].splice(patch.index,patch.removeCount,...patch.items);
      next.revision=s.revision+1;next.history=s.history.slice(0,-1);return validate(next);
    }
    const live = () => { if (next.status !== 'running') throw new Error('진행 중인 토론에서만 기록할 수 있습니다.'); };
    switch (action.type) {
      case 'configure':
        if (s.status !== 'ready') throw new Error('학생과 주제는 시작 전에 수정할 수 있습니다.');
        next.topic = action.topic.trim(); next.students = clone(action.students); next.tags = [...new Set(action.tags.map(t=>t.trim()).filter(Boolean))]; break;
      case 'start':
        if (s.status !== 'ready') throw new Error('이미 시작한 토론입니다.');
        next.status = 'running'; next.startedAt = now; next.phaseEvents = [{id:id(), phase:PHASES[0], atMs:0}];
        if(action.clap)next.syncEvents=[{id:id(),atMs:0,label:'지금 박수! 화면 표시 (녹음에서 박수 확인 필요)'}];break;
      case 'speak':
        live(); next.turns.push({id:id(), speakerId:action.speakerId || null, kind:action.kind || 'student', atMs:elapsed(s,now), phase:phase(s)}); break;
      case 'tag': {
        live(); const turn = current(s); if (!turn) throw new Error('먼저 발언자를 선택해 주세요.');
        const existing = next.observations.find(o=>o.turnId===turn.id && o.type==='tag' && o.value===action.value);
        if (existing) next.observations = next.observations.filter(o=>o.id!==existing.id);
        else next.observations.push({id:id(), turnId:turn.id, atMs:elapsed(s,now), type:'tag', value:action.value}); break;
      }
      case 'memo': {
        live(); if (!action.value.trim()) throw new Error('메모를 입력해 주세요.');
        const turn = s.turns.find(t=>t.id===action.turnId); if (!turn) throw new Error('메모를 연결할 발언을 선택해 주세요.');
        next.observations.push({id:id(), turnId:turn.id, atMs:elapsed(s,now), type:'memo', value:action.value.trim()}); break;
      }
      case 'phase':
        live(); if (phase(s) === action.phase) return next;
        next.phaseEvents.push({id:id(), phase:action.phase, atMs:elapsed(s,now)}); break;
      case 'end':
        live(); next.status = 'ended'; next.endedAt = Math.max(s.startedAt, now); break;
      case 'offset': next.offsetMs = action.offsetMs; break;
      case 'swapSeats':next.leftSide=seatSides(s)[1];break;
      case 'sync':
        live();next.syncEvents.push({id:id(),atMs:elapsed(s,now),label:action.label||'지금 박수! 화면 표시 (녹음에서 박수 확인 필요)'});break;
      case 'edit': {
        const turn = next.turns.find(t=>t.id===action.turnId); if (!turn) throw new Error('발언 기록을 찾을 수 없습니다.');
        if (!Number.isFinite(action.atMs) || action.atMs < 0 || action.atMs > elapsed(s,now)) throw new Error('발언 시각은 0초부터 현재 경과 시간 사이여야 합니다.');
        Object.assign(turn, {speakerId:action.speakerId, kind:action.kind, atMs:action.atMs, phase:action.phase});
        const old = next.observations.filter(o=>o.turnId===turn.id), other = next.observations.filter(o=>o.turnId!==turn.id);
        const tags = [...new Set(action.tags)];
        const updated = tags.map(value=>old.find(o=>o.type==='tag' && o.value===value) || {id:id(),turnId:turn.id,atMs:elapsed(s,now),type:'tag',value});
        // Preserve memo IDs and their observation times when editing their text.
        const memos = action.memos.map(m=>({...old.find(o=>o.id===m.id && o.type==='memo'), value:m.value.trim()})).filter(m=>m.id && m.value);
        if (action.newMemo.trim()) memos.push({id:id(),turnId:turn.id,atMs:elapsed(s,now),type:'memo',value:action.newMemo.trim()});
        next.observations = other.concat(updated,memos); break;
      }
      default: throw new Error('알 수 없는 작업입니다.');
    }
    next.revision = s.revision + 1;
    next.history = s.history.concat(undoPatch(s,next)).slice(-40);
    return validate(next);
  }
  function format(ms, decimals = false) {
    const sign = ms < 0 ? '-' : '', abs = Math.abs(Math.round(ms));
    const sec = Math.floor(abs/1000), hh = Math.floor(sec/3600), mm = Math.floor(sec/60)%60, ss = sec%60;
    return sign + [hh,mm,ss].map(n=>String(n).padStart(2,'0')).join(':') + (decimals ? '.'+String(abs%1000).padStart(3,'0') : '');
  }
  function parseTime(text) {
    const value = text.trim();
    if (!/^\d+:\d{2}:\d{2}(\.\d{1,3})?$/.test(value)) throw new Error('시간은 00:00:12 또는 00:00:12.350 형식으로 입력해 주세요.');
    const [h,m,s] = value.split(':').map(Number);
    if (m>59 || s>=60) throw new Error('분과 초는 60 미만이어야 합니다.');
    return Math.round((h*3600+m*60+s)*1000);
  }
  function speaker(s,t) { if(t.kind==='moderator')return '사회자'; if (t.kind==='unknown') return '화자 불명'; if(t.kind==='silence') return '발언 없음'; return s.students.find(p=>p.id===t.speakerId)?.name || '미지정'; }
  function rows(s, now=Date.now()) {
    const list = ordered(s), result = [];
    for (let i=0;i<list.length;i++) {
      const t = list[i], end = list[i+1]?.atMs ?? elapsed(s,now), p=s.students.find(p=>p.id===t.speakerId);
      const base = {topic:s.topic,turnId:t.id,speaker:speaker(s,t),side:p?.side||'',phase:t.phase,turnStart:format(t.atMs,true),recordingStart:format(t.atMs+s.offsetMs,true),turnEnd:format(end,true),recordingEnd:format(end+s.offsetMs,true),durationMs:Math.max(0,end-t.atMs)};
      result.push({...base,type:'발언',observationTime:'',tag:'',memo:''});
      for (const o of s.observations.filter(o=>o.turnId===t.id)) result.push({...base,type:'관찰',observationTime:format(o.atMs,true),tag:o.type==='tag'?o.value:'',memo:o.type==='memo'?o.value:''});
    }
    for (const p of s.phaseEvents) result.push({topic:s.topic,type:'단계 변경',phase:p.phase,turnStart:format(p.atMs,true),recordingStart:format(p.atMs+s.offsetMs,true)});
    for (const e of s.syncEvents) result.push({topic:s.topic,type:'시간 맞춤 신호',memo:e.label,turnStart:format(e.atMs,true),recordingStart:format(e.atMs+s.offsetMs,true)});
    result.push({topic:s.topic,type:'토론 시작',turnStart:format(0,true),recordingStart:format(s.offsetMs,true)});
    if(s.status==='ended') result.push({topic:s.topic,type:'토론 종료',turnStart:format(elapsed(s),true),recordingStart:format(elapsed(s)+s.offsetMs,true)});
    return result;
  }
  const COLUMNS = [['type','기록 종류'],['topic','토론 주제'],['turnId','발언 ID'],['speaker','화자'],['side','입장'],['phase','단계'],['turnStart','발언 시작(앱)'],['recordingStart','발언 시작(녹음 보정)'],['turnEnd','발언 종료(앱)'],['recordingEnd','발언 종료(녹음 보정)'],['durationMs','발언 길이(ms)'],['observationTime','관찰 추가 시각(앱)'],['tag','태그'],['memo','메모']];
  function csv(s,now) {
    const cell = value => { let v = String(value??''); if (/^[\s]*[=+@-]/.test(v)) v="'"+v; return '"'+v.replace(/"/g,'""')+'"'; };
    return '\uFEFF'+[COLUMNS.map(c=>cell(c[1])).join(','), ...rows(s,now).map(r=>COLUMNS.map(c=>cell(r[c[0]])).join(','))].join('\r\n');
  }
  function json(s,now=Date.now()) {
    const data = clone(s); delete data.history;
    return JSON.stringify({...data,exportedAt:new Date(now).toISOString(),elapsedMs:elapsed(s,now),timingRule:'녹음 시각 = 앱 경과 시간 + offsetMs. observations.atMs는 관찰을 추가한 앱 시각.',records:rows(s,now)},null,2);
  }
  function plain(s,now=Date.now()) {
    const lines = ['동아리 토론 기록실',s.topic,'상태: '+({ready:'시작 전',running:'진행 중 (내보낸 시점 기준)',ended:'종료'})[s.status],'시작: '+(s.startedAt===null?'미시작':new Date(s.startedAt).toISOString()),'경과: '+format(elapsed(s,now),true),'녹음 보정: '+(s.offsetMs/1000)+'초 (녹음 = 앱 + 보정)','학생: '+s.students.map(p=>p.name+'('+p.side+')').join(', '),''];
    const list=ordered(s);
    for (let i=0;i<list.length;i++) { const t=list[i]; lines.push('['+format(t.atMs+s.offsetMs,true)+'] '+speaker(s,t)+' · '+t.phase+' · 앱 '+format(t.atMs,true)+' · '+format((list[i+1]?.atMs??elapsed(s,now))-t.atMs,true));
      s.observations.filter(o=>o.turnId===t.id).forEach(o=>lines.push('  '+(o.type==='tag'?'태그: ':'메모: ')+o.value+' (관찰 추가 '+format(o.atMs,true)+')'));
    }
    lines.push('','단계 변경:'); s.phaseEvents.forEach(p=>lines.push(format(p.atMs+s.offsetMs,true)+' '+p.phase));
    if(s.syncEvents.length){lines.push('','박수 기준 표시 (실제 박수는 화면 표시와 반응 시간 차이가 있을 수 있음):');s.syncEvents.forEach(e=>lines.push('앱 '+format(e.atMs,true)+' / 녹음 보정 '+format(e.atMs+s.offsetMs,true)+' '+e.label));}
    return lines.join('\n');
  }
  return {PHASES,DEFAULT_TAGS,id,fresh,clone,validate,elapsed,ordered,current,phase,seatSides,apply,format,parseTime,speaker,rows,csv,json,plain};
}));
