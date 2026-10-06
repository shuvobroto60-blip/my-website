import {db,auth,json} from '../backend/_db.js';
export default async function handler(req,res){
 try{
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  // Provider webhooks must not require a user Bearer token.
  if(b.action==='webhook'){
   const expected=process.env.PAYMENT_WEBHOOK_TOKEN;
   if(expected && String(b.token||'')!==expected)return json(res,401,{ok:false,message:'Invalid webhook token'});
   const id=String(b.withdrawal_id||'');
   const status=String(b.status||'');
   if(!id||!['processing','approved','rejected','cancelled'].includes(status))return json(res,400,{ok:false,message:'Invalid payment webhook'});
   const wd=(await db('withdrawals?id=eq.'+encodeURIComponent(id)+'&select=*'))[0];
   if(!wd)return json(res,404,{ok:false,message:'Withdrawal not found'});
   if(wd.status!=='pending' && wd.status!==status)return json(res,409,{ok:false,message:'Withdrawal already settled'});
   const updated=(await db('withdrawals?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status,provider_ref:b.provider_ref||null,updated_at:new Date().toISOString()})}))[0];
   return json(res,200,{ok:true,withdrawal:updated});
  }
  const me=await auth(req);
  if(!me)return json(res,401,{ok:false,message:'Unauthorized'});
  if(b.action==='request'){
   return json(res,200,{ok:true,message:'Use the Wallet withdrawal flow. Automatic provider transfer requires configured merchant credentials.'});
  }
  return json(res,400,{ok:false,message:'Unknown payment action'});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Payment error'});}
}