import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const app=express();
app.use(helmet());
app.use(cors({origin:process.env.FRONTEND_ORIGIN?.split(',')||'*',credentials:true}));
app.use(express.json({limit:'1mb'}));
const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const secret=process.env.JWT_SECRET;
function auth(req,res,next){try{const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):null;if(!token) return res.status(401).json({error:'Unauthorized'});req.user=jwt.verify(token,secret);next()}catch{return res.status(401).json({error:'Invalid session'})}}
function admin(req,res,next){if(req.user?.role!=='admin') return res.status(403).json({error:'Admin only'});next()}
app.get('/api/health',(req,res)=>res.json({ok:true,service:'tracknest-backend',time:new Date().toISOString()}));
app.post('/api/auth/login',async(req,res)=>{try{const {username,password}=req.body||{};if(!username||!password)return res.status(400).json({error:'Username and password required'});const {data,error}=await supabase.from('users').select('id,public_id,username,email,password_hash,role,status,name').or(`username.eq.${username},email.eq.${username}`).maybeSingle();if(error)throw error;if(!data||data.status!=='active'||!(await bcrypt.compare(password,data.password_hash)))return res.status(401).json({error:'Invalid credentials'});const token=jwt.sign({sub:data.id,role:data.role,publicId:data.public_id},secret,{expiresIn:'7d'});res.json({token,user:{id:data.id,publicId:data.public_id,username:data.username,email:data.email,role:data.role,status:data.status,name:data.name}})}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/me',auth,async(req,res)=>{const {data,error}=await supabase.from('users').select('id,public_id,username,email,role,status,name').eq('id',req.user.sub).single();if(error)return res.status(404).json({error:'User not found'});res.json(data)});
app.get('/api/admin/users',auth,admin,async(req,res)=>{const q=String(req.query.q||'').trim();let query=supabase.from('users').select('id,public_id,username,email,role,status,name,created_at').order('created_at',{ascending:false});if(q)query=query.or(`public_id.eq.${q},username.ilike.%${q}%,email.ilike.%${q}%,name.ilike.%${q}%`);const {data,error}=await query.limit(100);if(error)return res.status(500).json({error:error.message});res.json(data)});
app.post('/api/postback/:token',async(req,res)=>{const token=req.params.token;const payload={token,received_at:new Date().toISOString(),query:req.query,body:req.body};const {data,error}=await supabase.from('postbacks').insert(payload).select('id').single();if(error)return res.status(500).json({error:error.message});res.json({ok:true,conversion_id:data.id})});
app.listen(process.env.PORT||3000,()=>console.log(`TrackNest backend listening on ${process.env.PORT||3000}`));
