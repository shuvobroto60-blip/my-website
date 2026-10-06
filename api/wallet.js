import {db,auth,json} from './_db.js';
import {notifyUser} from './_notify.js';
export default async function handler(req,res){
 try{
  const me=await auth(req); if(!me)return json(res,401,{ok:false,message:'Unauthorized'});
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});
  if(b.action==='get'){
   let w=(await db('wallets?user_id=eq.'+encodeURIComponent(me.id)+'&select=*'))[0];
   if(!w)w=(await db('wallets',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:me.id})}))[0];
   return json(res,200,{ok:true,wallet:w});
  }
  if(b.action==='withdraw'){
   const amount=Number(b.amount),method=String(b.method||''),account=String(b.account_number||'');
   const w=(await db('wallets?user_id=eq.'+encodeURIComponent(me.id)+'&select=*'))[0];
   if(!amount||amount<=0||!method||!account)return json(res,400,{ok:false,message:'Invalid withdrawal request'});
   if(!w||Number(w.balance)<amount)return json(res,400,{ok:false,message:'Insufficient balance'});
   await db('wallets?user_id=eq.'+encodeURIComponent(me.id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({balance:Number(w.balance)-amount,pending:Number(w.pending)+amount,updated_at:new Date().toISOString()})});
   const wd=(await db('withdrawals',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:me.id,amount,method,account_number:account})}))[0];
   return json(res,201,{ok:true,withdrawal:wd});
  }
  if(b.action==='list'&&me.role==='admin')return json(res,200,{ok:true,withdrawals:await db('withdrawals?select=*&order=created_at.desc&limit=200')});
  if(b.action==='update'){
   const id=String(b.id||''),next=String(b.status||'');
   if(!['approved','rejected','cancelled'].includes(next))return json(res,400,{ok:false,message:'Invalid status'});
   const wd=(await db('withdrawals?id=eq.'+encodeURIComponent(id)+'&select=*'))[0];
   if(!wd)return json(res,404,{ok:false,message:'Withdrawal not found'});
   if(me.role!=='admin'&&wd.user_id!==me.id)return json(res,403,{ok:false,message:'Forbidden'});
   if(wd.status!=='pending')return json(res,409,{ok:false,message:'Withdrawal is already '+wd.status});
   const w=(await db('wallets?user_id=eq.'+encodeURIComponent(wd.user_id)+'&select=*'))[0];
   if(!w)return json(res,500,{ok:false,message:'Wallet not found'});
   if(next==='approved'){
    await db('wallets?user_id=eq.'+encodeURIComponent(wd.user_id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({pending:Math.max(0,Number(w.pending)-Number(wd.amount)),paid:Number(w.paid)+Number(wd.amount),updated_at:new Date().toISOString()})});
   }else{
    await db('wallets?user_id=eq.'+encodeURIComponent(wd.user_id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({balance:Number(w.balance)+Number(wd.amount),pending:Math.max(0,Number(w.pending)-Number(wd.amount)),updated_at:new Date().toISOString()})});
   }
   const updated=(await db('withdrawals?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({status:next,updated_at:new Date().toISOString()})}))[0];
   if(next==='approved')await notifyUser(wd.user_id,'Withdrawal approved','Your TrackNest withdrawal of 
  }
  return json(res,403,{ok:false,message:'Forbidden'});
 }catch(e){return json(res,500,{ok:false,message:e.message});}
}+Number(wd.amount).toFixed(2)+' has been approved.');
   if(next==='rejected')await notifyUser(wd.user_id,'Withdrawal rejected','Your TrackNest withdrawal of 
  }
  return json(res,403,{ok:false,message:'Forbidden'});
 }catch(e){return json(res,500,{ok:false,message:e.message});}
}+Number(wd.amount).toFixed(2)+' was rejected and returned to your balance.');
   if(next==='cancelled')await notifyUser(wd.user_id,'Withdrawal cancelled','Your TrackNest withdrawal of 
  }
  return json(res,403,{ok:false,message:'Forbidden'});
 }catch(e){return json(res,500,{ok:false,message:e.message});}
}+Number(wd.amount).toFixed(2)+' was cancelled.');
   return json(res,200,{ok:true,withdrawal:updated});
  }
  return json(res,403,{ok:false,message:'Forbidden'});
 }catch(e){return json(res,500,{ok:false,message:e.message});}
}