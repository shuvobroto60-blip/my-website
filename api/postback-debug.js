import {db} from '../backend/_db.js';
export default async function handler(req,res){
 try{
  const rows=await db('users?select=id&limit=1');
  res.status(200).json({ok:true,method:req.method,query:req.query||{},supabase:true,rowCount:Array.isArray(rows)?rows.length:0});
 }catch(e){
  res.status(500).json({ok:false,error:e?.message||String(e),name:e?.name||null});
 }
}