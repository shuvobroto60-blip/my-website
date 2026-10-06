import crypto from 'node:crypto';
import {db,json,auth} from '../backend/_db.js';

const clean=(v,max=500)=>String(v??'').trim().slice(0,max);
const hmac=(value)=>crypto.createHmac('sha256',String(process.env.TRACKING_SIGNING_SECRET||'')).update(value).digest('hex');
const canonical=(userId,offerId,subs)=>[userId,offerId,...subs.map(v=>clean(v,500)||'')].join('|');

export default async function handler(req,res){
 try{
  if(req.method!=='GET'&&req.method!=='POST')return json(res,405,{ok:false,message:'Method not allowed'});
  const q=req.method==='GET'?(req.query||{}):(typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}));

  // Authenticated link generation: the browser never chooses the affiliate owner directly.
  if(req.method==='POST' && q.action==='sign'){
   const me=await auth(req);
   if(!me)return json(res,401,{ok:false,message:'Unauthorized'});
   const offerId=clean(q.offer_id,120);
   if(!offerId)return json(res,400,{ok:false,message:'offer_id is required'});
   const offer=(await db('offers?id=eq.'+encodeURIComponent(offerId)+'&status=eq.active&select=id,url,status'))[0];
   if(!offer)return json(res,404,{ok:false,message:'Offer not found or inactive'});
   if(!offer.url||!/^https?:\\/\\//i.test(String(offer.url)))return json(res,500,{ok:false,message:'Offer destination URL is invalid'});
   const subs=Array.from({length:8},(_,i)=>clean(q['sub'+(i+1)],500));
   const clickId=clean(q.click_id||q.clickid||'',120);
   if(clickId&&!/^[A-Za-z0-9._:-]{6,120}$/.test(clickId))return json(res,400,{ok:false,message:'Invalid click_id'});
   const sig=hmac(canonical(me.id,offerId,subs,clickId));
   const params=new URLSearchParams({user_id:me.id,offer_id:offerId,sig});
   if(clickId)params.set('click_id',clickId);
   subs.forEach((v,i)=>{if(v)params.set('sub'+(i+1),v);});
   return json(res,200,{ok:true,url:'/api/track?'+params.toString(),click_url:params.toString()});
  }

  const userId=clean(q.user_id,120),offerId=clean(q.offer_id,120),sig=clean(q.sig,128);
  if(!offerId)return json(res,400,{ok:false,message:'offer_id is required'});
  const offer=(await db('offers?id=eq.'+encodeURIComponent(offerId)+'&status=eq.active&select=id,url,status'))[0];
  if(!offer)return json(res,404,{ok:false,message:'Offer not found or inactive'});
  if(!offer.url||!/^https?:\\/\\//i.test(String(offer.url)))return json(res,500,{ok:false,message:'Offer destination URL is invalid'});

  const subs=Array.from({length:8},(_,i)=>clean(q['sub'+(i+1)],500));
  const requestedClickId=clean(q.click_id||q.clickid||'',120);
  if(requestedClickId&&!/^[A-Za-z0-9._:-]{6,120}$/.test(requestedClickId))return json(res,400,{ok:false,message:'Invalid click_id'});
  const expectedSig=hmac(canonical(userId,offerId,subs,requestedClickId)); const validSig=Buffer.byteLength(sig)===Buffer.byteLength(expectedSig)&&crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expectedSig)); if(!userId || !sig || !process.env.TRACKING_SIGNING_SECRET || !validSig)return json(res,403,{ok:false,message:'Invalid or unsigned tracking link'});

  let clickId=requestedClickId;
  if(!clickId)clickId=crypto.randomBytes(12).toString('hex');
  if(!/^[A-Za-z0-9._:-]{6,120}$/.test(clickId))return json(res,400,{ok:false,message:'Invalid click_id'});
  const exists=(await db('clicks?click_id=eq.'+encodeURIComponent(clickId)+'&select=id'))[0];
  if(exists)return json(res,409,{ok:false,message:'click_id already exists'});

  await db('clicks',{
   method:'POST',
   headers:{Prefer:'return=minimal'},
   body:JSON.stringify({
    click_id:clickId,user_id:userId,offer_id:offerId,
    sub1:subs[0]||null,sub2:subs[1]||null,sub3:subs[2]||null,sub4:subs[3]||null,
    sub5:subs[4]||null,sub6:subs[5]||null,sub7:subs[6]||null,sub8:subs[7]||null
   })
  });

  const u=new URL(String(offer.url));
  u.searchParams.set('click_id',clickId);
  res.statusCode=302;
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Location',u.toString());
  return res.end();
 }catch(e){return json(res,500,{ok:false,message:e.message||'Tracking error'});}
}
