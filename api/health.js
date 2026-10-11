import {db} from '../backend/_db.js';

export default async function handler(req,res){
 if(req.method!=='GET'&&req.method!=='HEAD'){
  res.setHeader('Allow','GET, HEAD');
  return res.status(405).json({ok:false,service:'tracknest',message:'Method not allowed'});
 }
 const supabaseConfigured=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
 const postbackConfigured=Boolean(process.env.POSTBACK_TOKEN);
 let schemaReady=false,error=null;
 if(supabaseConfigured){
  try{
   await db('users?select=id&limit=1');
   await db('offers?select=id&limit=1');
   await db('wallets?select=user_id&limit=1');
   schemaReady=true;
  }catch(e){error=String(e?.message||'Database health check failed').slice(0,240);}
 }else{
  error='Supabase server credentials are not configured';
 }
 const ok=supabaseConfigured&&postbackConfigured&&schemaReady;
 return res.status(ok?200:503).json({
  ok,service:'tracknest',timestamp:new Date().toISOString(),
  supabaseConfigured,postbackConfigured,schemaReady,error
 });
}
