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
   const supabaseUrl=process.env.SUPABASE_URL;
   const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
   if(!supabaseUrl||!serviceKey)return json(res,500,{ok:false,message:'Wallet credit service is not configured',click_id:clickId});

   const creditResponse=await fetch(supabaseUrl.replace(/\\/$/,'')+'/rest/v1/rpc/process_wallet_credit',{
    method:'POST',
    headers:{
     apikey:serviceKey,
     Authorization:'Bearer '+serviceKey,
     'Content-Type':'application/json'
    },
    body:JSON.stringify({
     p_click_id:clickId,
     p_user_id:click.user_id,
     p_amount:payout,
     p_conversion_id:conversion?.id||null
    })
   });

   const creditText=await creditResponse.text();
   let creditResult=null;
   try{creditResult=creditText?JSON.parse(creditText):null;}catch{}

   if(!creditResponse.ok){
    return json(res,409,{
     ok:false,
     message:'Wallet credit could not be completed; safely retry the same postback',
     click_id:clickId,
     error:creditResult?.message||creditResult?.hint||creditText||'Wallet credit failed'
    });
   }

   if(!creditResult?.ok){
    return json(res,409,{ok:false,message:'Wallet credit was not confirmed; safely retry the same postback',click_id:clickId});
   }

   return json(res,200,{
    ok:true,
    message:creditResult.duplicate?'Postback already credited':'Postback received and wallet credited',
    click_id:clickId,
    status,
    payout,
    attributed:true,
    duplicate:Boolean(creditResult.duplicate),
    credited:Boolean(creditResult.credited),
    conversion_id:conversion?.id||null,
    ledger_id:creditResult.ledger_id||null,
    balance_after:creditResult.balance_after
   });
  }

  return json(res,200,{ok:true,message:'Postback received',click_id:clickId,status,payout,attributed:true,conversion_id:conversion?.id||null});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}
