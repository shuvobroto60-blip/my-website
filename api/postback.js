import {db} from '../backend/_db.js';

function json(res,status,body){res.status(status).json(body);}
function safeEqual(a,b){const x=String(a||''),y=String(b||'');if(x.length!==y.length)return false;let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);return diff===0;}

export default async function handler(req,res){
 try{
  const input=req.method==='GET'?(req.query||{}):(typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}));
  const expected=process.env.POSTBACK_TOKEN;
  if(expected&&!safeEqual(input.token,expected))return json(res,401,{ok:false,message:'Invalid postback token'});
  return json(res,200,{ok:true,message:'Postback auth layer OK'});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}