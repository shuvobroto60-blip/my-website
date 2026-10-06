import crypto from 'node:crypto';
import {db,auth,json} from '../backend/_db.js';
export default async function handler(req,res){
 try{
  if(req.method!=='POST')return json(res,405,{ok:false,message:'Method not allowed'});
  const me=await auth(req);
  if(!me||me.role!=='admin')return json(res,403,{ok:false,message:'Admin only'});
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
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
 }catch(e){return json(res,500,{ok:false,message:e.message||'Test conversion failed'});}
}