import {db,auth,json} from '../backend/_db.js';
import {notifyUser} from '../backend/_notify.js';

async function patchWallet(userId,filters,body){
 const path='wallets?user_id=eq.'+encodeURIComponent(userId)+filters.map(([k,v])=>'&'+k+'=eq.'+encodeURIComponent(String(v))).join('');
 return db(path,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...body,updated_at:new Date().toISOString()})});
}

export default async function handler(req,res){
 try{
  const me=await auth(req);
  if(!me)return json(res,401,{ok:false,message:'Unauthorized'});
  const b=typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{});

  if(b.action==='get'){
   let w=(await db('wallets?user_id=eq.'+encodeURIComponent(me.id)+'&select=*'))[0];
   if(!w)w=(await db('wallets',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:me.id,balance:0,pending:0,paid:0})}))[0];
   return json(res,200,{ok:true,wallet:w});
  }

  if(b.action==='withdraw'){
   const amount=Number(b.amount),method=String(b.method||'').trim(),account=String(b.account_number||'').trim();
   if(!Number.isFinite(amount)||amount<=0||amount>1000000||!method||!account)return json(res,400,{ok:false,message:'Invalid withdrawal request'});
   if(!['bKash','Nagad','Rocket'].includes(method))return json(res,400,{ok:false,message:'Unsupported payment method'});
   if(!/^[0-9+ -]{8,25}$/.test(account))return json(res,400,{ok:false,message:'Invalid account number'});

   const w=(await db('wallets?user_id=eq.'+encodeURIComponent(me.id)+'&select=*'))[0];
   if(!w||Number(w.balance)<amount)return json(res,400,{ok:false,message:'Insufficient balance'});

   const updated=await patchWallet(me.id,[['balance',Number(w.balance)]],{
    balance:Number(w.balance)-amount,pending:Number(w.pending||0)+amount
   });
   if(!updated.length)return json(res,409,{ok:false,message:'Balance changed. Please try again.'});

   try{
    const wd=(await db('withdrawals',{
     method:'POST',headers:{Prefer:'return=representation'},
     body:JSON.stringify({user_id:me.id,amount,method,account_number:account,status:'pending'})
    }))[0];
    return json(res,201,{ok:true,withdrawal:wd});
   }catch(e){
    await patchWallet(me.id,[['balance',Number(w.balance)-amount],['pending',Number(w.pending||0)+amount]],{
     balance:Number(w.balance),pending:Number(w.pending||0)
    }).catch(()=>{});
    throw e;
   }
  }

  if(b.action==='list'){
   const q=me.role==='admin'?'withdrawals?select=*&order=created_at.desc&limit=200':'withdrawals?user_id=eq.'+encodeURIComponent(me.id)+'&select=*&order=created_at.desc&limit=200';
   return json(res,200,{ok:true,withdrawals:await db(q)});
  }

  if(b.action==='update'){
   if(me.role!=='admin')return json(res,403,{ok:false,message:'Admin only'});
   const id=String(b.id||''),next=String(b.status||''),paymentRef=String(b.payment_ref||'').trim().slice(0,120);
   if(!['approved','rejected','cancelled'].includes(next))return json(res,400,{ok:false,message:'Invalid status'});
   if(next==='approved'&&!paymentRef)return json(res,400,{ok:false,message:'Payment reference is required when marking a manual payment as paid'});

   const wd=(await db('withdrawals?id=eq.'+encodeURIComponent(id)+'&select=*'))[0];
   if(!wd)return json(res,404,{ok:false,message:'Withdrawal not found'});
   if(wd.status!=='pending')return json(res,409,{ok:false,message:'Withdrawal is already '+wd.status});

   const w=(await db('wallets?user_id=eq.'+encodeURIComponent(wd.user_id)+'&select=*'))[0];
   if(!w)return json(res,500,{ok:false,message:'Wallet not found'});

   let walletUpdated;
   if(next==='approved'){
    walletUpdated=await patchWallet(wd.user_id,[['pending',Number(w.pending||0)]],{
     pending:Math.max(0,Number(w.pending||0)-Number(wd.amount)),
     paid:Number(w.paid||0)+Number(wd.amount)
    });
   }else{
    walletUpdated=await patchWallet(wd.user_id,[['balance',Number(w.balance||0)],['pending',Number(w.pending||0)]],{
     balance:Number(w.balance||0)+Number(wd.amount),
     pending:Math.max(0,Number(w.pending||0)-Number(wd.amount))
    });
   }
   if(!walletUpdated.length)return json(res,409,{ok:false,message:'Wallet changed. Refresh and try again.'});

   try{
    const updated=(await db('withdrawals?id=eq.'+encodeURIComponent(id)+'&status=eq.pending',{
     method:'PATCH',headers:{Prefer:'return=representation'},
     body:JSON.stringify({status:next,provider_ref:paymentRef||null,updated_at:new Date().toISOString()})
    }))[0];
    if(!updated)throw new Error('Withdrawal was changed by another request');
    if(next==='approved')await notifyUser(wd.user_id,'Withdrawal paid','Your TrackNest withdrawal of await notifyUser(wd.user_id,'Withdrawal rejected','Your TrackNest withdrawal of $'+Number(wd.amount).toFixed(2)+' was rejected and returned to your balance.');
    if(next==='cancelled')await notifyUser(wd.user_id,'Withdrawal cancelled','Your TrackNest withdrawal of $'+Number(wd.amount).toFixed(2)+' was cancelled.');
    return json(res,200,{ok:true,withdrawal:updated});
   }catch(e){
    if(next==='approved'){
     await patchWallet(wd.user_id,[['pending',Math.max(0,Number(w.pending||0)-Number(wd.amount))],['paid',Number(w.paid||0)+Number(wd.amount)]],{pending:Number(w.pending||0),paid:Number(w.paid||0)}).catch(()=>{});
    }else{
     await patchWallet(wd.user_id,[['balance',Number(w.balance||0)+Number(wd.amount)],['pending',Math.max(0,Number(w.pending||0)-Number(wd.amount))]],{balance:Number(w.balance||0),pending:Number(w.pending||0)}).catch(()=>{});
    }
    throw e;
   }
  }

  return json(res,400,{ok:false,message:'Unknown action'});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}
+Number(wd.amount).toFixed(2)+' has been paid manually. Reference: '+paymentRef);
    if(next==='rejected')await notifyUser(wd.user_id,'Withdrawal rejected','Your TrackNest withdrawal of $'+Number(wd.amount).toFixed(2)+' was rejected and returned to your balance.');
    if(next==='cancelled')await notifyUser(wd.user_id,'Withdrawal cancelled','Your TrackNest withdrawal of $'+Number(wd.amount).toFixed(2)+' was cancelled.');
    return json(res,200,{ok:true,withdrawal:updated});
   }catch(e){
    if(next==='approved'){
     await patchWallet(wd.user_id,[['pending',Math.max(0,Number(w.pending||0)-Number(wd.amount))],['paid',Number(w.paid||0)+Number(wd.amount)]],{pending:Number(w.pending||0),paid:Number(w.paid||0)}).catch(()=>{});
    }else{
     await patchWallet(wd.user_id,[['balance',Number(w.balance||0)+Number(wd.amount)],['pending',Math.max(0,Number(w.pending||0)-Number(wd.amount))]],{balance:Number(w.balance||0),pending:Number(w.pending||0)}).catch(()=>{});
    }
    throw e;
   }
  }

  return json(res,400,{ok:false,message:'Unknown action'});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}
+Number(wd.amount).toFixed(2)+' has been paid manually. Reference: '+paymentRef);
    if(next==='rejected')await notifyUser(wd.user_id,'Withdrawal rejected','Your TrackNest withdrawal of $'+Number(wd.amount).toFixed(2)+' was rejected and returned to your balance.');
    if(next==='cancelled')await notifyUser(wd.user_id,'Withdrawal cancelled','Your TrackNest withdrawal of $'+Number(wd.amount).toFixed(2)+' was cancelled.');
    return json(res,200,{ok:true,withdrawal:updated});
   }catch(e){
    if(next==='approved'){
     await patchWallet(wd.user_id,[['pending',Math.max(0,Number(w.pending||0)-Number(wd.amount))],['paid',Number(w.paid||0)+Number(wd.amount)]],{pending:Number(w.pending||0),paid:Number(w.paid||0)}).catch(()=>{});
    }else{
     await patchWallet(wd.user_id,[['balance',Number(w.balance||0)+Number(wd.amount)],['pending',Math.max(0,Number(w.pending||0)-Number(wd.amount))]],{balance:Number(w.balance||0),pending:Number(w.pending||0)}).catch(()=>{});
    }
    throw e;
   }
  }

  return json(res,400,{ok:false,message:'Unknown action'});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}
+Number(wd.amount).toFixed(2)+' has been paid manually. Reference: '+paymentRef);
    if(next==='rejected')await notifyUser(wd.user_id,'Withdrawal rejected','Your TrackNest withdrawal of $'+Number(wd.amount).toFixed(2)+' was rejected and returned to your balance.');
    if(next==='cancelled')await notifyUser(wd.user_id,'Withdrawal cancelled','Your TrackNest withdrawal of $'+Number(wd.amount).toFixed(2)+' was cancelled.');
    return json(res,200,{ok:true,withdrawal:updated});
   }catch(e){
    if(next==='approved'){
     await patchWallet(wd.user_id,[['pending',Math.max(0,Number(w.pending||0)-Number(wd.amount))],['paid',Number(w.paid||0)+Number(wd.amount)]],{pending:Number(w.pending||0),paid:Number(w.paid||0)}).catch(()=>{});
    }else{
     await patchWallet(wd.user_id,[['balance',Number(w.balance||0)+Number(wd.amount)],['pending',Math.max(0,Number(w.pending||0)-Number(wd.amount))]],{balance:Number(w.balance||0),pending:Number(w.pending||0)}).catch(()=>{});
    }
    throw e;
   }
  }

  return json(res,400,{ok:false,message:'Unknown action'});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}
