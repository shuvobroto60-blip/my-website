import crypto from 'node:crypto';
import {db,json} from './_db.js';
export default async function handler(req,res){
 try{
  const q=req.query||{},userId=String(q.user_id||''),offerId=String(q.offer_id||'');
  if(!offerId)return json(res,400,{ok:false,message:'offer_id is required'});
  const offer=(await db('offers?id=eq.'+encodeURIComponent(offerId)+'&status=eq.active&select=id,url,status'))[0];
  if(!offer)return json(res,404,{ok:false,message:'Offer not found or inactive'});
  const clickId=String(q.click_id||crypto.randomBytes(9).toString('hex'));
  const exists=(await db('clicks?click_id=eq.'+encodeURIComponent(clickId)+'&select=id'))[0];
  if(exists)return json(res,409,{ok:false,message:'click_id already exists'});
  await db('clicks',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({click_id:clickId,user_id:userId||null,offer_id:offerId,sub1:q.sub1||null,sub2:q.sub2||null,sub3:q.sub3||null,sub4:q.sub4||null,sub5:q.sub5||null,sub6:q.sub6||null,sub7:q.sub7||null,sub8:q.sub8||null})});
  const u=new URL(offer.url);u.searchParams.set('click_id',clickId);
  res.statusCode=302;res.setHeader('Location',u.toString());return res.end();
 }catch(e){return json(res,500,{ok:false,message:e.message||'Tracking error'});}
}