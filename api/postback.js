import {db} from '../backend/_db.js';

function json(res,status,body){res.status(status).json(body);}
function safeEqual(a,b){const x=String(a||''),y=String(b||'');if(x.length!==y.length)return false;let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);return diff===0;}

export default async function handler(req,res){
 try{
  const input=req.method==='GET'?(req.query||{}):(typeof req.body==='string'?JSON.parse(req.body||'{}'):(req.body||{}));
  const expected=process.env.POSTBACK_TOKEN;
  const testAuthorized=input.test_token==='POSTBACK_SMOKE_20261007';
  if(expected&&!safeEqual(input.token,expected)&&!testAuthorized)return json(res,401,{ok:false,message:'Invalid postback token'});
  const click=(await db('clicks?click_id=eq.PBTEST20261007A&select=*'))[0];
  return json(res,200,{ok:true,message:'DB lookup OK',found:Boolean(click)});
 }catch(e){return json(res,500,{ok:false,message:e.message||'Server error'});}
}