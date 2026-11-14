/* ============================================================================
 INTELECT · firebase-db.js  — the database layer (Firebase Auth + Firestore)
 index.html loads this file and talks to the database ONLY through window.DB.
 SETUP: 1) Firebase console → create project → add Web app → paste config below
        2) Authentication → enable Email/Password, Google, Anonymous; add your domain under Authorized domains
        3) Firestore Database → create → Rules tab → paste the RULES block at the bottom of this file → Publish
 DATA MODEL (all linked by the 6-digit game PIN):
   quizzes/{id}                 {owner,title,questions[],n,created}
   games/{pin}                  {host,title,qid,state,q,n,reveal,ex,q_start,created}
   games/{pin}/qs/{idx}         {idx,data}   question WITHOUT answers (players read this)
   games/{pin}/private/key      {k}          answer key (host only)
   games/{pin}/players/{uid}    {pin,uid,name,score,streak,last,joined}
   games/{pin}/answers/{q_uid}  {pin,q,uid,a,t}  one answer per player per question, t = server time
============================================================================ */
(function(){
const FIREBASE_CONFIG={apiKey:"AIzaSyC1oDG53Bu3Rn63OGyM-7KgswxLzuU0X2c",authDomain:"intelect-4fb9f.firebaseapp.com",projectId:"intelect-4fb9f",storageBucket:"intelect-4fb9f.firebasestorage.app",messagingSenderId:"579118699609",appId:"1:579118699609:web:5a9dae007416770b558d48"};
const ready=!!window.firebase&&!/YOUR[-_]/.test(JSON.stringify(FIREBASE_CONFIG));
let auth,db,TS;
if(ready){firebase.initializeApp(FIREBASE_CONFIG);auth=firebase.auth();db=firebase.firestore();TS=()=>firebase.firestore.FieldValue.serverTimestamp()}
const iso=v=>v&&v.toDate?v.toDate().toISOString():v;
const out=d=>{const o={};for(const k in d)o[k]=iso(d[k]);return o};
const err=e=>({message:String(e.message||e).replace('Firebase: ',''),code:e.code});
const uid=()=>auth.currentUser&&auth.currentUser.uid;
const G=p=>db.collection('games').doc(String(p));
const SUB={players:'players',answers:'answers',game_private:'private',game_qs:'qs'};
const mu=u=>({id:u.uid,email:u.email,is_anonymous:u.isAnonymous,user_metadata:{name:u.displayName||''},email_confirmed_at:u.emailVerified?'y':null});
const sortRows=(r,o)=>o?r.sort((a,b)=>String(a[o[0]]).localeCompare(String(b[o[0]]))*o[1]):r;
const once=(ref,data)=>db.runTransaction(async x=>{if((await x.get(ref)).exists){const e=new Error('exists');e.code='23505';throw e}x.set(ref,data)});
async function wipe(pin){for(const s of Object.values(SUB)){const q=await G(pin).collection(s).get();for(let i=0;i<q.docs.length;i+=400){const b=db.batch();q.docs.slice(i,i+400).forEach(d=>b.delete(d.ref));await b.commit()}}await G(pin).delete()}

class Q{constructor(t){this.t=t;this.f={};this.op='select';this.ord=null;this.sg=0}
 select(){return this} eq(k,v){this.f[k]=v;return this}
 order(k,o){this.ord=[k,o&&o.ascending===false?-1:1];return this}
 single(){this.sg=1;return this} maybeSingle(){this.sg=2;return this}
 insert(d){this.op='insert';this.d=d;return this} update(d){this.op='update';this.d=d;return this}
 upsert(){this.op='noop';return this} delete(){this.op='delete';return this}
 then(a,b){return this.run().then(a,b)}
 async run(){try{return{data:await this.exec(),error:null}}catch(e){return{data:null,error:err(e)}}}
 ret(r){if(this.sg===1&&!r)throw Error('Not found');return r}
 async exec(){const{t,f,d,op}=this,pin=f.pin;if(op==='noop')return null;
  if(t==='quizzes'){const c=db.collection('quizzes');
   if(op==='insert'){await c.add({...d,owner:uid(),created:TS()});return null}
   if(op==='update'){await c.doc(f.id).update(d);return null}
   if(op==='delete'){await c.doc(f.id).delete();return null}
   if(f.id){const s=await c.doc(f.id).get();return this.ret(s.exists?{id:s.id,...out(s.data())}:null)}
   return sortRows((await c.where('owner','==',f.owner).get()).docs.map(x=>({id:x.id,...out(x.data())})),this.ord)}
  if(t==='games'){
   if(op==='insert'){await once(G(d.pin),{...d,host:uid(),created:TS()});return null}
   if(op==='update'){const u={...d};if(u.state==='question')u.q_start=TS();await G(pin).update(u);return null}
   if(op==='delete'){await wipe(pin);return null}
   if(pin){const s=await G(pin).get();return this.ret(s.exists?out(s.data()):null)}
   return sortRows((await db.collection('games').where('host','==',f.host).get()).docs.map(x=>out(x.data())),this.ord)}
  const S=G(pin).collection(SUB[t]);
  if(t==='game_private'){const r=S.doc('key');if(op==='insert'){await r.set({k:JSON.stringify(d.k)});return null}
   const s=await r.get();return this.ret(s.exists?{k:JSON.parse(s.data().k)}:null)}
  if(t==='game_qs'){if(op==='insert'){const b=db.batch();d.forEach(x=>b.set(S.doc(String(x.idx)),{idx:x.idx,data:x.data}));await b.commit();return null}
   const s=await S.doc(String(f.idx)).get();return this.ret(s.exists?s.data():null)}
  if(t==='players'){if(op==='insert'){await once(S.doc(d.uid),{pin:d.pin,uid:d.uid,name:d.name,score:0,streak:0,joined:TS()});return null}
   return(await S.get()).docs.map(x=>out(x.data()))}
  if(t==='answers'){if(op==='insert'){await once(S.doc(d.q+'_'+d.uid),{pin:d.pin,q:d.q,uid:d.uid,a:d.a,t:TS()});return null}
   const s=await(f.q!=null?S.where('q','==',f.q):S).get();return s.docs.map(x=>out(x.data()))}
  throw Error('Unknown table '+t)}}

const sb={
 from:t=>new Q(t),
 async rpc(n,a){try{if(n!=='finish_question')throw Error('Unknown rpc');const b=db.batch();
  a.p_rows.forEach(r=>b.update(G(a.p_pin).collection('players').doc(r.uid),{score:r.score,streak:r.streak,last:r.last}));
  b.update(G(a.p_pin),{state:'lb',reveal:a.p_reveal,ex:a.p_ex||''});await b.commit();return{data:null,error:null}}catch(e){return{data:null,error:err(e)}}},
 channel(){const ch={on(_,o,cb){ch.c={t:o.table,pin:String(o.filter||'').split('=eq.')[1],cb};return ch},
  subscribe(){const{t,pin,cb}=ch.c;ch.u=(t==='games'?G(pin):G(pin).collection(SUB[t])).onSnapshot(()=>cb(),()=>{});return ch}};return ch},
 removeChannel(ch){try{ch.u&&ch.u()}catch(e){}},
 auth:{
  onAuthStateChange(cb){let first=true;return auth.onAuthStateChanged(u=>{cb(first?'INITIAL_SESSION':u?'SIGNED_IN':'SIGNED_OUT',u?{user:mu(u)}:null);first=false})},
  async getSession(){return{data:{session:auth.currentUser?{user:mu(auth.currentUser)}:null}}},
  async getUser(){try{await auth.currentUser.reload();return{data:{user:mu(auth.currentUser)}}}catch(e){return{data:null,error:err(e)}}},
  async signInAnonymously(){try{const r=await auth.signInAnonymously();return{data:{user:mu(r.user)},error:null}}catch(e){return{error:err(e)}}},
  async signInWithPassword({email,password}){try{await auth.signInWithEmailAndPassword(email,password);return{data:{},error:null}}catch(e){return{error:err(e)}}},
  async signUp({email,password,options}){try{const r=await auth.createUserWithEmailAndPassword(email,password);
   await r.user.updateProfile({displayName:options&&options.data&&options.data.name||''});await r.user.sendEmailVerification();return{data:{session:null},error:null}}catch(e){return{error:err(e)}}},
  async signInWithOAuth(){try{await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());return{error:null}}catch(e){return{error:err(e)}}},
  async resend(){try{await auth.currentUser.sendEmailVerification();return{error:null}}catch(e){return{error:err(e)}}},
  async resetPasswordForEmail(e){try{await auth.sendPasswordResetEmail(e);return{error:null}}catch(x){return{error:err(x)}}},
  async updateUser({password}){try{await auth.currentUser.updatePassword(password);return{error:null}}catch(e){return{error:err(e)}}},
  async signOut(){await auth.signOut();return{error:null}}}};
window.DB={ready,sb};
})();

/* ================================ FIRESTORE RULES ================================
rules_version = '2';
service cloud.firestore { match /databases/{d}/documents {
  function isHost(pin){ return get(/databases/$(d)/documents/games/$(pin)).data.host == request.auth.uid; }
  match /quizzes/{id} {
    allow read, delete: if request.auth != null && resource.data.owner == request.auth.uid;
    allow create: if request.auth != null && request.resource.data.owner == request.auth.uid;
    allow update: if resource.data.owner == request.auth.uid && request.resource.data.owner == request.auth.uid; }
  match /games/{pin} {
    allow read: if request.auth != null;
    allow create: if request.auth != null && request.resource.data.host == request.auth.uid
                  && request.auth.token.firebase.sign_in_provider != 'anonymous';
    allow update, delete: if resource.data.host == request.auth.uid;
    match /private/{x} { allow read, write: if isHost(pin); }
    match /qs/{x} { allow read: if request.auth != null; allow write: if isHost(pin); }
    match /players/{u} { allow read: if request.auth != null;
      allow create: if request.auth.uid == u && request.resource.data.score == 0;
      allow update, delete: if isHost(pin); }
    match /answers/{a} { allow read: if isHost(pin);
      allow create: if request.auth.uid == request.resource.data.uid
        && a == string(request.resource.data.q) + '_' + request.auth.uid
        && request.resource.data.t == request.time; }
  } } }
================================================================================ */
