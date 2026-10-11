import {db,auth,json} from '../backend/_db.js';
export default async function handler(req,res){
 try{
  const me=await auth(req); if(!me)return json(res,401,{ok:false,message:'Unauthorized'});
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  if(req.method==='GET'){
   const rows=await db('offers?select=*&order=created_at.asc&limit=1000');
   const memberships=await db('offer_memberships?user_id=eq.'+encodeURIComponent(me.id)+'&select=offer_id'); const joined=new Set(memberships.map(x=>String(x.offer_id))); return json(res,200,{ok:true,offers:rows.map(o=>({...o,joined:joined.has(String(o.id))}))});
  }
  if(b.action==='join'){const offerId=String(b.id||'');if(!offerId)return json(res,400,{ok:false,message:'Offer id required'});await db('offer_memberships',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({user_id:me.id,offer_id:offerId})});return json(res,200,{ok:true});}
  if(me.role!=='admin')return json(res,403,{ok:false,message:'Admin only'});
  if(b.action==='create'){
   if(!b.name||!b.url)return json(res,400,{ok:false,message:'Offer name and URL are required'});
   const row=(await db('offers',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({id:crypto.randomUUID(),name:String(b.name).slice(0,200),url:String(b.url),payout:Number(b.payout||0),category:String(b.category||'General'),country:String(b.country||'Any'),device:String(b.device||'Any'),daily_cap:b.dailyCap?Number(b.dailyCap):null,s2s:String(b.s2s||''),status:'active'})}))[0];
   return json(res,201,{ok:true,offer:row});
  }
  if(b.action==='status'){await db('offers?id=eq.'+encodeURIComponent(b.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({status:b.status==='paused'?'paused':'active'})});return json(res,200,{ok:true});}
  if(b.action==='delete'){await db('offers?id=eq.'+encodeURIComponent(b.id),{method:'DELETE'});return json(res,200,{ok:true});}
  return json(res,400,{ok:false,message:'Unknown action'});
 }catch(e){return json(res,500,{ok:false,message:e.message});}
}