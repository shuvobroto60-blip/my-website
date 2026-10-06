import {db,auth,json} from '../backend/_db.js';
export default async function handler(req,res){
 try{const me=await auth(req);if(!me||me.role!=='admin')return json(res,403,{ok:false,message:'Admin only'});
 const kind=String(req.query.kind||'s2s');
 if(kind==='s2s'){const posts=await db('postbacks?select=click_id,payout,status,received_at&order=received_at.desc&limit=200');const ids=[...new Set(posts.map(x=>x.click_id))];const clicks=ids.length?await db('clicks?click_id=in.('+ids.map(encodeURIComponent).join(',')+')&select=click_id,offer_id'):[];const offers=await db('offers?select=id,name');const cm=Object.fromEntries(clicks.map(x=>[x.click_id,x.offer_id]));const om=Object.fromEntries(offers.map(x=>[x.id,x.name]));return json(res,200,{ok:true,logs:posts.map(x=>({time:x.received_at,click_id:x.click_id,offer:om[cm[x.click_id]]||cm[x.click_id]||'Unknown',payout:Number(x.payout||0),status:x.status}))});}
 return json(res,400,{ok:false,message:'Unknown security view'});
 }catch(e){return json(res,500,{ok:false,message:e.message});}
}