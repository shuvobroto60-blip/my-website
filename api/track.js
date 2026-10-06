import crypto from 'node:crypto';
import {db,json} from '../backend/_db.js';

const clean=(v,max=500)=>String(v??'').trim().slice(0,max);

export default async function handler(req,res){
 try{
  if(req.method!=='GET'&&req.method!=='POST')return json(res,405,{ok:false,message:'Method not allowed'});
  const q=req.method==='GET'?(req.query||{}):(typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}));
  const userId=clean(q.user_id,120),offerId=clean(q.offer_id,120);
  if(!offerId)return json(res,400,{ok:false,message:'offer_id is required'});

  const offer=(await db('offers?id=eq.'+encodeURIComponent(offerId)+'&status=eq.active&select=id,url,status'))[0];
  if(!offer)return json(res,404,{ok:false,message:'Offer not found or inactive'});
  if(!offer.url||!/^https?:\\/\\//i.test(String(offer.url)))return json(res,500,{ok:false,message:'Offer destination URL is invalid'});

  let clickId=clean(q.click_id||q.clickid||'',120);
  if(!clickId)clickId=crypto.randomBytes(12).toString('hex');
  if(!/^[A-Za-z0-9._:-]{6,120}$/.test(clickId))return json(res,400,{ok:false,message:'Invalid click_id'});

  const exists=(await db('clicks?click_id=eq.'+encodeURIComponent(clickId)+'&select=id'))[0];
  if(exists)return json(res,409,{ok:false,message:'click_id already exists'});

  await db('clicks',{
   method:'POST',
   headers:{Prefer:'return=minimal'},
   body:JSON.stringify({
    click_id:clickId,user_id:userId||null,offer_id:offerId,
    sub1:clean(q.sub1,500)||null,sub2:clean(q.sub2,500)||null,sub3:clean(q.sub3,500)||null,sub4:clean(q.sub4,500)||null,
    sub5:clean(q.sub5,500)||null,sub6:clean(q.sub6,500)||null,sub7:clean(q.sub7,500)||null,sub8:clean(q.sub8,500)||null
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
