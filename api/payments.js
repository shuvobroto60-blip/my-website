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
  if(b.action==='test_conversion'){
   if(me.role!=='admin')return json(res,403,{ok:false,message:'Admin only'});
   const crypto=await import('node:crypto');
   const payout=Number(b.payout??1);
   if(!Number.isFinite(payout)||payout<=0||payout>100)return json(res,400,{ok:false,message:'Test payout must be between $0.01 and $100'});
   const offerId=crypto.randomUUID(),clickId='TEST-'+crypto.randomBytes(10).toString('hex'),now=new Date().toISOString();
   const offer=(await db('offers',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({id:offerId,name:'TrackNest QA Test Offer',url:'https://example.com/tracknest-test',payout,category:'QA Test',country:'Any',device:'Any',daily_cap:null,s2s:'',status:'active',created_at:now})}))[0];
   await db('clicks',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({click_id:clickId,user_id:me.id,offer_id:offerId,sub1:'tracknest-test',sub2:'admin-qa'})});
   const conversion=(await db('conversions',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:me.id,click_id:clickId,offer_id:offerId,payout,status:'approved',sub1:'tracknest-test',sub2:'admin-qa',raw:{test:true,source:'TrackNest Admin QA',created_at:now}})}))[0];
   const w=(await db('wallets?user_id=eq.'+encodeURIComponent(me.id)+'&select=*'))[0];
   if(!w)return json(res,500,{ok:false,message:'Admin wallet not found'});
   const oldBalance=Number(w.balance||0);
   const updated=await db('wallets?user_id=eq.'+encodeURIComponent(me.id)+'&balance=eq.'+encodeURIComponent(oldBalance),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({balance:oldBalance+payout,updated_at:new Date().toISOString()})});
   if(!updated.length)return json(res,409,{ok:false,message:'Wallet changed during test; please run again'});
   return json(res,200,{ok:true,test:true,offer_id:offerId,click_id:clickId,conversion_id:conversion?.id||null,payout,balance_before:oldBalance,balance_after:oldBalance+payout,message:'QA test conversion completed and wallet credited'});
  }
  if(b.action==='request'){
   return json(res,200,{ok:true,message:'Use the Wallet withdrawal flow. Automatic provider transfer requires configured merchant credentials.'});
  }
  return json(res,400,{ok:false,message:'Unknown payment action'});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Payment error'});}
}