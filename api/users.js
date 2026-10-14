export default async function handler(req,res){
 try{
  const me=await auth(req);
  if(!me)return json(res,401,{ok:false,message:'Unauthorized'});
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  if(req.method==='GET'){
   const query=me.role==='admin'
    ? 'users?select=id,public_id,username,email,name,phone,role,status,sub_role,created_at&order=created_at.desc&limit=1000'
    : 'users?status=eq.active&select=id,public_id,username,name,role,status,sub_role&order=username.asc&limit=500';
   const rows=await db(query);
   return json(res,200,{ok:true,users:rows});
  }
  if(me.role!=='admin')return json(res,403,{ok:false,message:'Admin only'});
  if(b.action==='status'||b.action==='subrole'){
   if(!b.userId)return json(res,400,{ok:false,message:'userId required'});
   const target=(await db('users?id=eq.'+encodeURIComponent(b.userId)+'&select=id,role'))[0];
   if(!target)return json(res,404,{ok:false,message:'User not found'});
   if(target.role==='admin')return json(res,403,{ok:false,message:'Admin accounts cannot be modified here'});
   if(b.action==='status'&&!['active','suspended'].includes(String(b.status||'')))return json(res,400,{ok:false,message:'Invalid user status'});
   if(b.action==='subrole'&&!['none','manager','support'].includes(String(b.subRole||'')))return json(res,400,{ok:false,message:'Invalid sub-role'});
   const patch=b.action==='status'?{status:String(b.status)}:{sub_role:String(b.subRole)};
   const rows=await db('users?id=eq.'+encodeURIComponent(b.userId),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
   await auditLog(me.id, b.action==='status'?'user.status_changed':'user.subrole_changed',{target_user_id:b.userId,changes:patch});
   return json(res,200,{ok:true,user:rows[0]||null});
  }
  const rows=await db('users?select=id,public_id,username,email,name,phone,role,status,sub_role,created_at&order=created_at.desc&limit=1000');
  return json(res,200,{ok:true,users:rows});
 }catch{return json(res,500,{ok:false,message:'User request could not be completed'});}
}