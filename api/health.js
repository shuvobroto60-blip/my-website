export default function handler(req,res){
 res.status(200).json({ok:true,service:'tracknest',timestamp:new Date().toISOString(),supabaseConfigured:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY),postbackConfigured:Boolean(process.env.POSTBACK_TOKEN)});
}
