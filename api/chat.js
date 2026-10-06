import {db,auth,json} from '../backend/_db.js';
export default async function handler(req,res){
 try{
  const me=await auth(req);if(!me)return json(res,401,{ok:false,message:'Unauthorized'});
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}),kind=b.kind||req.query.kind||'global';
  if(kind==='global'){
   let c=(await db('conversations?kind=eq.global&select=id&limit=1'))[0];
   if(!c)c=(await db('conversations',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_a:me.id,kind:'global'})}))[0];
   if(req.method==='GET'){
    const messages=await db('messages?conversation_id=eq.'+encodeURIComponent(c.id)+'&select=id,sender_id,body,created_at,edited_at&order=created_at.asc&limit=200');
    const ids=[...new Set(messages.map(x=>x.sender_id))];
    const users=ids.length?await db('users?id=in.('+ids.join(',')+')&select=id,name,username'):[];const map=Object.fromEntries(users.map(u=>[u.id,u]));
    return json(res,200,{ok:true,messages:messages.map(m=>({...m,users:map[m.sender_id]||null}))});
   }
   const text=String(b.text||'').trim();if(!text)return json(res,400,{ok:false,message:'Message required'});
   await db('messages',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({conversation_id:c.id,sender_id:me.id,body:text.slice(0,2000)})});
   return json(res,201,{ok:true});
  }
  const other=String(b.userId||req.query.userId||'');if(!other)return json(res,400,{ok:false,message:'userId required'});
  let c=(await db('conversations?kind=eq.dm&or=(and(user_a.eq.'+encodeURIComponent(me.id)+',user_b.eq.'+encodeURIComponent(other)+'),and(user_a.eq.'+encodeURIComponent(other)+',user_b.eq.'+encodeURIComponent(me.id)+'))&select=id&limit=1'))[0];
  if(!c)c=(await db('conversations',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_a:me.id,user_b:other,kind:'dm'})}))[0];
  if(req.method==='GET'){
   const messages=await db('messages?conversation_id=eq.'+encodeURIComponent(c.id)+'&select=id,sender_id,body,created_at,edited_at&order=created_at.asc&limit=200');
   const ids=[...new Set(messages.map(x=>x.sender_id))];const users=ids.length?await db('users?id=in.('+ids.join(',')+')&select=id,name,username'):[];const map=Object.fromEntries(users.map(u=>[u.id,u]));
   return json(res,200,{ok:true,messages:messages.map(m=>({...m,users:map[m.sender_id]||null}))});
  }
  const text=String(b.text||'').trim();if(!text)return json(res,400,{ok:false,message:'Message required'});
  await db('messages',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({conversation_id:c.id,sender_id:me.id,body:text.slice(0,2000)})});
  return json(res,201,{ok:true});
 }catch(e){return json(res,500,{ok:false,message:e.message});}
}