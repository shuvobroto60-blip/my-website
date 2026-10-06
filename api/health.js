import {db} from './_db.js';
export default async function handler(req,res){
 const configured=Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY);
 let schemaReady=false,error=null;
 if(configured){try{await db('users?select=id&limit=1');await db('offers?select=id&limit=1');await db('wallets?select=user_id&limit=1');schemaReady=true;}catch(e){error=e.message;}}
 res.status(200).json({ok:true,service:'tracknest',timestamp:new Date().toISOString(),supabaseConfigured:configured,postbackConfigured:Boolean(process.env.POSTBACK_TOKEN),schemaReady,error});
}