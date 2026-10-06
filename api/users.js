import {db,auth,json} from './_db.js';
export default async function handler(req,res){
 try{
  const me=await auth(req);
  if(!me||me.role!=='admin')return json(res,403,{ok:false,message:'Admin only'});
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  if(b.action==='status'||b.action==='subrole'){
   if(!b.userId)return json(res,400,{ok:false,message:'userId required'});
   const patch=b.action==='status'?{status:String(b.status||'active')}:{sub_role:String(b.subRole||'none')};
   const rows=await db('users?id=eq.'+encodeURIComponent(b.userId),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(patch)});
   return json(res,200,{ok:true,user:rows[0]||null});
  }
  const rows=await db('users?select=id,public_id,username,email,name,phone,role,status,sub_role,created_at&order=created_at.desc&limit=1000');
  return json(res,200,{ok:true,users:rows});
 }catch(e){return json(res,500,{ok:false,message:e.message});}
}