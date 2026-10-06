import {db} from './_db.js';
export async function notifyUser(userId,subject,body){
 const u=(await db('users?id=eq.'+encodeURIComponent(userId)+'&select=email,phone'))[0]; if(!u)return;
 const jobs=[];
 if(process.env.RESEND_API_KEY&&u.email){
  jobs.push((async()=>{try{const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM||'TrackNest <onboarding@resend.dev>',to:[u.email],subject,html:'<p>'+String(body).replace(/</g,'&lt;')+'</p>'})});const j=await r.json().catch(()=>({}));await db('notifications',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({user_id:userId,channel:'email',recipient:u.email,subject,body,status:r.ok?'sent':'queued',provider_ref:j.id||null})});}catch(e){}})());
 }
 if(process.env.TWILIO_ACCOUNT_SID&&process.env.TWILIO_AUTH_TOKEN&&process.env.TWILIO_FROM&&u.phone){
  jobs.push((async()=>{try{const basic=Buffer.from(process.env.TWILIO_ACCOUNT_SID+':'+process.env.TWILIO_AUTH_TOKEN).toString('base64');const r=await fetch('https://api.twilio.com/2010-04-01/Accounts/'+process.env.TWILIO_ACCOUNT_SID+'/Messages.json',{method:'POST',headers:{Authorization:'Basic '+basic,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({From:process.env.TWILIO_FROM,To:u.phone,Body:String(body)})});const j=await r.json().catch(()=>({}));await db('notifications',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify({user_id:userId,channel:'sms',recipient:u.phone,subject,body,status:r.ok?'sent':'queued',provider_ref:j.sid||null})});}catch(e){}})());
 }
 await Promise.all(jobs);
}