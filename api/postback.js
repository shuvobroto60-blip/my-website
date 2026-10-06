import crypto from 'node:crypto';
import {db} from '../backend/_db.js';

function json(res,status,body){res.status(status).json(body);}
function safeEqual(a,b){const x=Buffer.from(String(a||''));const y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function normalizeStatus(v){const s=String(v||'approved').toLowerCase();if(['approved','pending','rejected','cancelled'].includes(s))return s;return null;}

async function supabaseInsert(row){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return false;
 const r=await fetch(url.replace(/\\/$/,'')+'/rest/v1/postbacks',{
  method:'POST',
  headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=minimal'},
  body:JSON.stringify(row)
 });
 if(!r.ok)throw new Error('Supabase insert failed ('+r.status+')');
 return true;
}

export default async function handler(req,res){
 if(req.method!=='GET'&&req.method!=='POST')return json(res,405,{ok:false,message:'Method not allowed'});
 try{
  const input=req.method==='GET'?req.query:(typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}));
  const expected=process.env.POSTBACK_TOKEN;
  if(expected&&!safeEqual(input.token,expected))return json(res,401,{ok:false,message:'Invalid postback token'});

  const clickId=String(input.click_id||input.clickid||input.subid||'').trim();
  const payout=Number(input.payout||0);
  const status=normalizeStatus(input.status||input.conv_status);
  if(!clickId)return json(res,400,{ok:false,message:'click_id is required'});
  if(!status)return json(res,400,{ok:false,message:'Invalid conversion status'});
  if(!Number.isFinite(payout)||payout<0)return json(res,400,{ok:false,message:'Invalid payout'});

  const click=(await db('clicks?click_id=eq.'+encodeURIComponent(clickId)+'&select=*'))[0];
  if(!click)return json(res,404,{ok:false,message:'Unknown click_id'});

  const existing=(await db('conversions?click_id=eq.'+encodeURIComponent(clickId)+'&select=id,status,payout&limit=1'))[0];
  if(existing)return json(res,200,{ok:true,message:'Postback already processed',click_id:clickId,status:existing.status,payout:Number(existing.payout||0),duplicate:true});

  const row={token:'',click_id:clickId,payout,status,query:req.method==='GET'?input:{},body:req.method==='POST'?input:{},received_at:new Date().toISOString()};
  await supabaseInsert(row);

  const conversion=(await db('conversions',{
   method:'POST',
   headers:{Prefer:'return=representation'},
   body:JSON.stringify({
    user_id:click.user_id,click_id:clickId,offer_id:click.offer_id,payout,status,
    sub1:click.sub1,sub2:click.sub2,sub3:click.sub3,sub4:click.sub4,
    sub5:click.sub5,sub6:click.sub6,sub7:click.sub7,sub8:click.sub8,raw:input
   })
  }))[0];

  if(click.user_id&&status==='approved'&&payout>0){
   let credited=false;
   let lastBalance=0;
   for(let attempt=0;attempt<3&&!credited;attempt++){
    const w=(await db('wallets?user_id=eq.'+encodeURIComponent(click.user_id)+'&select=*'))[0];
    if(!w)break;
    const current=Number(w.balance||0);
    lastBalance=current;
    const next=current+payout;
    const updated=await db('wallets?user_id=eq.'+encodeURIComponent(click.user_id)+'&balance=eq.'+encodeURIComponent(current),{
     method:'PATCH',headers:{Prefer:'return=representation'},
     body:JSON.stringify({balance:next,updated_at:new Date().toISOString()})
    });
    if(updated.length){credited=true;break;}
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,50*(attempt+1)));
   }
   if(!credited)return json(res,409,{ok:false,message:'Wallet credit could not be completed; safely retry the same postback',click_id:clickId,balance:lastBalance});
  }

  return json(res,200,{ok:true,message:'Postback received',click_id:clickId,status,payout,attributed:true,conversion_id:conversion?.id||null});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}
