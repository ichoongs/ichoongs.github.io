// 인라인 스크립트 문법 검사: node tools/check_syntax.js
const fs=require('fs');
const h=fs.readFileSync(process.argv[2]||'student_record_app_personal_firebase.html','utf8');
const b=[...h.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
let bad=0;
b.forEach(m=>{try{new Function(m[1])}catch(e){bad++;console.log('문법 오류:',e.message)}});
console.log(`스크립트 ${b.length}개, 오류 ${bad}개`);
process.exit(bad?1:0);
