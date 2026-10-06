import {db,auth,json} from './_db.js';
export default async function handler(req,res){
 try{
  const me=await auth(req); if(!me)return json(res,401,{ok:false,message:'Unauthorized'});
  const since=new Date(Date.now()-6*86400000); since.setHours(0,0,0,0);
  const filter=me.role==='admin'?'':'&user_id=eq.'+encodeURIComponent(me.id);
  const clicks=await db('clicks?select=offer_id,created_at,user_id&created_at=gte.'+encodeURIComponent(since.toISOString())+filter+'&limit=10000');
  const conv=await db('conversions?select=offer_id,payout,user_id,status,created_at&status=eq.approved&created_at=gte.'+encodeURIComponent(since.toISOString())+filter+'&limit=10000');
  const offers=await db('offers?select=id,name');
  const names=Object.fromEntries(offers.map(o=>[String(o.id),o.name]));
  const daily={};
  for(let i=0;i<7;i++){const d=new Date(since);d.setDate(since.getDate()+i);daily[d.toISOString().slice(0,10)]={clicks:0,conversions:0};}
  const byOffer={};
  for(const x of clicks){const d=String(x.created_at).slice(0,10);if(daily[d])daily[d].clicks++;const k=String(x.offer_id||'');if(!byOffer[k])byOffer[k]={clicks:0,conversions:0,earnings:0};byOffer[k].clicks++;}
  for(const x of conv){const d=String(x.created_at).slice(0,10);if(daily[d])daily[d].conversions++;const k=String(x.offer_id||'');if(!byOffer[k])byOffer[k]={clicks:0,conversions:0,earnings:0};byOffer[k].conversions++;byOffer[k].earnings+=Number(x.payout||0);}
  const allConv=await db('conversions?select=offer_id,payout,user_id,status,created_at&status=eq.approved'+(me.role==='admin'?'':'&user_id=eq.'+encodeURIComponent(me.id))+'&limit=10000');
  const withdrawals=me.role==='admin'?await db('withdrawals?select=amount,status&limit=10000'):await db('withdrawals?select=amount,status&user_id=eq.'+encodeURIComponent(me.id)+'&limit=10000');
  const paidOut=withdrawals.filter(x=>x.status==='approved').reduce((a,x)=>a+Number(x.amount||0),0);
  const pendingWithdrawals=withdrawals.filter(x=>x.status==='pending').reduce((a,x)=>a+Number(x.amount||0),0);
  return json(res,200,{ok:true,totalClicks:clicks.length,totalConversions:conv.length,totalConversionValue:allConv.reduce((a,x)=>a+Number(x.payout||0),0),paidOut,pendingWithdrawals,daily,byOffer:Object.fromEntries(Object.entries(byOffer).map(([k,v])=>[k,{...v,name:names[k]||k}])),conversions:allConv.map(x=>({...x,offer_name:names[String(x.offer_id)]||String(x.offer_id||'')}))});
 }catch(e){return json(res,500,{ok:false,message:e.message});}
}