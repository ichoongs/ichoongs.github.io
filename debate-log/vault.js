/* IndexedDB holds past sessions locally; current-session autosave uses localStorage. */
(function () {
  'use strict';
  let opening;
  function open() {
    if(opening)return opening;
    opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('debate-log-library',1);
      request.onupgradeneeded=()=>{request.result.createObjectStore('sessions',{keyPath:'sessionId'});};
      request.onerror=()=>{opening=null;reject(request.error||new Error('보관함을 열 수 없습니다.'));};
      request.onblocked=()=>{opening=null;reject(new Error('다른 탭을 닫고 보관함을 다시 열어 주세요.'));};
      request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
    });
    return opening;
  }
  async function transaction(mode, work) {
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('sessions',mode);let result;
      const request=work(tx.objectStore('sessions'));
      request.onsuccess=()=>{result=request.result;};
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error||new Error('기기 보관함 저장에 실패했습니다.'));
      tx.onabort=()=>reject(tx.error||new Error('기기 보관함 작업이 중단되었습니다.'));
    });
  }
  window.DebateVault={
    put: (state,draft)=>{
      const data=JSON.parse(JSON.stringify(state));data.history=[];
      return transaction('readwrite',store=>store.put({sessionId:state.sessionId,state:data,draft:JSON.parse(JSON.stringify(draft)),savedAt:Date.now()}));
    },
    list: async()=>{const sessions=await transaction('readonly',store=>store.getAll());return sessions.sort((a,b)=>b.savedAt-a.savedAt);},
    get: sessionId=>transaction('readonly',store=>store.get(sessionId)),
    remove: sessionId=>transaction('readwrite',store=>store.delete(sessionId))
  };
}());
