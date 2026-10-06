export default async function handler(req,res){
  return res.status(401).json({ok:false,message:'Postback handler smoke test'});
}
