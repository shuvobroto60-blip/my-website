import {db,hashPassword,verifyPassword,token,tokenHash,publicId,json} from '../backend/_db.js';

const clean=(v,max=160)=>String(v??'').trim().slice(0,max);

export default async function handler(req,res){
 try{
  if(req.method!=='POST')return json(res,405,{ok:false,message:'Method not allowed'});
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}),a=b.action;

  if(a==='me'){
   const h=String(req.headers.authorization||'');
   if(!h.startsWith('Bearer '))return json(res,401,{ok:false});
   const q=await db('sessions?token_hash=eq.'+encodeURIComponent(tokenHash(h.slice(7)))+'&select=user_id,expires_at');
   const x=q[0];
   if(!x||new Date(x.expires_at)<new Date())return json(res,401,{ok:false});
   const u=(await db('users?id=eq.'+x.user_id+'&select=id,public_id,username,email,name,phone,role,status,sub_role'))[0];
   if(!u||u.status!=='active')return json(res,401,{ok:false,message:'Session is no longer active'});
   return json(res,200,{ok:true,user:{id:u.id,publicId:u.public_id,username:u.username,email:u.email,name:u.name,role:u.role,subRole:u.sub_role||'none'}});
  }

  if(a==='signup'){
   const username=clean(b.username,80),email=clean(b.email,160).toLowerCase(),phone=clean(b.phone,30),password=String(b.password||'');
   if(!/^[A-Za-z0-9_.-]{3,40}$/.test(username)||!/^\S+@\S+\.\S+$/.test(email)||!/^[0-9+ -]{8,25}$/.test(phone)||password.length<6||password.length>200)return json(res,400,{ok:false,message:'Invalid signup details'});
   const e=await db('users?or=(username.eq.'+encodeURIComponent(username)+',email.eq.'+encodeURIComponent(email)+')&select=id');
   if(e.length)return json(res,409,{ok:false,message:'Username or email already exists'});
   const u=(await db('users',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({public_id:await publicId(),username,email,phone,name:username,password_hash:hashPassword(password),role:'user',status:'active',sub_role:'none'})}))[0];
   await db('wallets',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({user_id:u.id,balance:0,pending:0,paid:0})});
   const t=token();
   await db('sessions',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({token_hash:tokenHash(t),user_id:u.id,expires_at:new Date(Date.now()+2592000000).toISOString()})});
   return json(res,201,{ok:true,token:t,user:{id:u.id,publicId:u.public_id,username:u.username,email:u.email,name:u.name,role:u.role,subRole:u.sub_role||'none'}});
  }

  if(a==='login'){
   const id=clean(b.identifier,160),pw=String(b.password||'');
   let u=(await db('users?or=(username.eq.'+encodeURIComponent(id)+',email.eq.'+encodeURIComponent(id.toLowerCase())+')&select=*'))[0];

   // Allow the configured admin credentials to bootstrap or repair the admin hash.
   const adminMatch=id===String(process.env.ADMIN_USERNAME||'')&&pw===String(process.env.ADMIN_PASSWORD||'');
   if(adminMatch){
    u=(await db('users?username=eq.'+encodeURIComponent(id)+'&select=*'))[0];
    if(!u){
     u=(await db('users',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({public_id:await publicId(),username:id,email:process.env.ADMIN_EMAIL||'admin@tracknest.com',name:'Administrator',password_hash:hashPassword(pw),role:'admin',status:'active',sub_role:'none'})}))[0];
    }else if(u.role!=='admin'||u.status!=='active'||!verifyPassword(pw,u.password_hash)){
     u=(await db('users?id=eq.'+encodeURIComponent(u.id),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({password_hash:hashPassword(pw),role:'admin',status:'active',sub_role:'none'})}))[0];
    }
   }

   if(!u||u.status!=='active'||!verifyPassword(pw,u.password_hash))return json(res,401,{ok:false,message:'Invalid username/email or password'});
   const t=token();
   await db('sessions',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({token_hash:tokenHash(t),user_id:u.id,expires_at:new Date(Date.now()+2592000000).toISOString()})});
   return json(res,200,{ok:true,token:t,user:{id:u.id,publicId:u.public_id,username:u.username,email:u.email,name:u.name,role:u.role,subRole:u.sub_role||'none'}});
  }

  if(a==='logout'){
   const h=String(req.headers.authorization||'');
   if(h.startsWith('Bearer '))await db('sessions?token_hash=eq.'+encodeURIComponent(tokenHash(h.slice(7))),{method:'DELETE'});
   return json(res,200,{ok:true});
  }
  return json(res,400,{ok:false,message:'Unknown action'});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}
