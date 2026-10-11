import {db,auth,json} from '../backend/_db.js';
export default async function handler(req,res){
 try{
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  // This network is configured for manual payouts only. Do not mutate withdrawal status
  // from an uncoordinated provider webhook, which could desynchronize wallet balances.
  if(b.action==='webhook'){
   return json(res,410,{ok:false,message:'Automatic payment webhooks are disabled. Use the manual payout approval flow.'});
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
   const conversion=(await db('conversions',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:me.id,click_id:clickId,offer_id:offerId,payout,status:'approved',sub1:'tracknest-test',sub2:'admin-qa',raw_data:{test:true,source:'TrackNest Admin QA',created_at:now}})}))[0];
   const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
   if(!url||!key)return json(res,503,{ok:false,message:'Wallet credit service is not configured'});
   const creditResponse=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/process_wallet_credit',{
    method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
    body:JSON.stringify({p_click_id:clickId,p_user_id:me.id,p_amount:payout,p_conversion_id:conversion?.id||null})
   });
   const creditText=await creditResponse.text();let credit={};try{credit=creditText?JSON.parse(creditText):{}}catch{}
   if(!creditResponse.ok||!credit.ok)return json(res,500,{ok:false,message:'Test conversion was recorded but wallet credit failed',error:credit.message||creditText});
   return json(res,200,{ok:true,test:true,offer_id:offerId,click_id:clickId,conversion_id:conversion?.id||null,payout,balance_after:credit.balance_after,message:'QA test conversion completed through the idempotent wallet ledger'});

  }
  if(b.action==='request'){
   return json(res,200,{ok:true,message:'Use the Wallet withdrawal flow. Automatic provider transfer requires configured merchant credentials.'});
  }
  return json(res,400,{ok:false,message:'Unknown payment action'});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Payment error'});}
}