import crypto from 'node:crypto';
import {db} from '../backend/_db.js';

function json(res,status,body){res.status(status).json(body);}
function safeEqual(a,b){const x=Buffer.from(String(a||''));const y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function normalizeStatus(v){const s=String(v||'approved').toLowerCase();if(['approved','pending','rejected','cancelled'].includes(s))return s;return null;}

async function recordPostback(req,input,clickId,payout,status){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return;
 try{
  await db('postbacks',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({
   token:'',click_id:clickId,payout,status,query:req.method==='GET'?input:{},body:req.method==='POST'?input:{},received_at:new Date().toISOString()
  })});
 }catch{/* Logging must not prevent conversion processing. */}
}

async function creditApprovedConversion(click,conversion,payout){
 if(!click.user_id||payout<=0)return {ok:true,credited:false,duplicate:false};
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return {ok:false,status:503,message:'Wallet credit service is not configured'};
 const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/process_wallet_credit',{
  method:'POST',
  headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
  body:JSON.stringify({p_click_id:click.click_id,p_user_id:click.user_id,p_amount:payout,p_conversion_id:conversion?.id||null})
 });
 const text=await response.text();let result=null;try{result=text?JSON.parse(text):null;}catch{}
 if(!response.ok||!result?.ok)return {ok:false,status:409,message:'Wallet credit was not confirmed; safely retry the same postback',error:result?.message||result?.hint||text||'Wallet credit failed'};
 return {ok:true,...result};
}

export default async function handler(req,res){
 if(req.method!=='GET'&&req.method!=='POST'){res.setHeader('Allow','GET, POST');return json(res,405,{ok:false,message:'Method not allowed'});}
 try{
  const input=req.method==='GET'?(req.query||{}):(typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}));
  const expected=process.env.POSTBACK_TOKEN;
  if(!expected)return json(res,503,{ok:false,message:'Postback authentication is not configured'});
  if(!safeEqual(input.token,expected))return json(res,401,{ok:false,message:'Invalid postback token'});

  const clickId=String(input.click_id||input.clickid||input.subid||'').trim();
  const payout=Number(input.payout||0);
  const status=normalizeStatus(input.status||input.conv_status);
  if(!clickId)return json(res,400,{ok:false,message:'click_id is required'});
  if(!status)return json(res,400,{ok:false,message:'Invalid conversion status'});
  if(!Number.isFinite(payout)||payout<0)return json(res,400,{ok:false,message:'Invalid payout'});

  const click=(await db('clicks?click_id=eq.'+encodeURIComponent(clickId)+'&select=*'))[0];
  if(!click)return json(res,404,{ok:false,message:'Unknown click_id'});

  await recordPostback(req,input,clickId,payout,status);
  let conversion=(await db('conversions?click_id=eq.'+encodeURIComponent(clickId)+'&select=*&limit=1'))[0];
  const duplicate=Boolean(conversion);
  if(conversion){
   // A pending conversion may receive its final advertiser status later.
   if(conversion.status==='pending'&&status!=='pending'){
    conversion=(await db('conversions?id=eq.'+encodeURIComponent(conversion.id)+'&status=eq.pending',{
     method:'PATCH',headers:{Prefer:'return=representation'},
     body:JSON.stringify({status,payout,raw_data:input})
    }))[0]||conversion;
   }
  }else{
   conversion=(await db('conversions',{
    method:'POST',headers:{Prefer:'return=representation'},
    body:JSON.stringify({
     user_id:click.user_id,click_id:clickId,offer_id:click.offer_id,payout,status,
     sub1:click.sub1,sub2:click.sub2,sub3:click.sub3,sub4:click.sub4,
     sub5:click.sub5,sub6:click.sub6,sub7:click.sub7,sub8:click.sub8,raw_data:input,goal_name:input.goal_name||input.goal||null,transaction_id:input.transaction_id||input.txid||null,ip_address:input.ip_address||input.ip||null,country:input.country||null,city:input.city||null,device:input.device||null,os:input.os||input.device_os||null
    })
   }))[0];
  }

  // Crucial retry behavior: even if the conversion row already exists, run the
  // idempotent credit RPC again. This repairs a prior partial failure without
  // creating another conversion or crediting the wallet twice.
  const finalStatus=String(conversion?.status||status).toLowerCase();
  const finalPayout=Number(conversion?.payout??payout);
  if(finalStatus==='approved'&&finalPayout>0){
   const credit=await creditApprovedConversion(click,conversion,finalPayout);
   if(!credit.ok)return json(res,credit.status,{ok:false,message:credit.message,click_id:clickId,error:credit.error||undefined,duplicate});
   return json(res,200,{
    ok:true,message:credit.duplicate?'Postback already credited':'Postback received and wallet credited',
    click_id:clickId,status:finalStatus,payout:finalPayout,attributed:true,
    duplicate:duplicate||Boolean(credit.duplicate),credited:Boolean(credit.credited),
    conversion_id:conversion?.id||null,ledger_id:credit.ledger_id||null,balance_after:credit.balance_after
   });
  }
  return json(res,200,{ok:true,message:duplicate?'Postback already processed':'Postback received',click_id:clickId,status:finalStatus,payout:finalPayout,attributed:true,duplicate,conversion_id:conversion?.id||null});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}
