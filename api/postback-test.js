export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({ok:false,message:'Method not allowed'});
 try{
  const token=process.env.POSTBACK_TOKEN||'';
  const r=await fetch(`https://${req.headers.host}/api/postback?click_id=TEST123&payout=10&status=approved&token=${encodeURIComponent(token)}`);
  const data=await r.json().catch(()=>({}));
  return res.status(r.status).json({...data,status:r.status});
 }catch(e){return res.status(500).json({ok:false,message:e.message||'Unable to test receiver'});}
}
