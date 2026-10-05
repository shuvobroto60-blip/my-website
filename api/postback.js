import crypto from 'node:crypto';
function json(res,status,body){res.status(status).json(body);}
function safeEqual(a,b){const x=Buffer.from(String(a||''));const y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
async function supabaseInsert(row){
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return false;
 const r=await fetch(`${url.replace(/\/$/,'')}/rest/v1/postbacks`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(row)});
 if(!r.ok)throw new Error(`Supabase insert failed (${r.status})`);
 return true;
}
export default async function handler(req,res){
 if(req.method!=='GET'&&req.method!=='POST')return json(res,405,{ok:false,message:'Method not allowed'});
 try{
  const input=req.method==='GET'?req.query:(typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}));
  const expected=process.env.POSTBACK_TOKEN;
  if(expected&&!safeEqual(input.token,expected))return json(res,401,{ok:false,message:'Invalid postback token'});
  const clickId=String(input.click_id||input.clickid||input.subid||'').trim(), payout=Number(input.payout||0), status=String(input.status||input.conv_status||'approved');
  if(!clickId)return json(res,400,{ok:false,message:'click_id is required'});
  const click=(await db('clicks?click_id=eq.'+encodeURIComponent(clickId)+'&select=*'))[0];
  const row={token:String(input.token||''),click_id:clickId,payout:Number.isFinite(payout)?payout:0,status,query:req.method==='GET'?input:{},body:req.method==='POST'?input:{},received_at:new Date().toISOString()};
  if(!await supabaseInsert(row))return json(res,503,{ok:false,message:'Postback receiver is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel.'});
  if(click){await db('conversions',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({user_id:click.user_id,click_id:clickId,offer_id:click.offer_id,payout:row.payout,status,sub1:click.sub1,sub2:click.sub2,sub3:click.sub3,sub4:click.sub4,sub5:click.sub5,sub6:click.sub6,sub7:click.sub7,sub8:click.sub8,raw:input})});if(click.user_id&&status==='approved'&&row.payout>0){const w=(await db('wallets?user_id=eq.'+click.user_id+'&select=*'))[0];if(w)await db('wallets?user_id=eq.'+click.user_id,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({balance:Number(w.balance)+row.payout,updated_at:new Date().toISOString()})});}return json(res,200,{ok:true,message:'Postback received',click_id:clickId,status,payout:row.payout,attributed:Boolean(click)});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}
