import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import express from 'express';
import {installSecurity, installMakeRelay} from './studio-security.js';
import {chromium} from 'playwright';
import {CloudWorkspaceStore} from './cloud-store.js';

const app=express();
const port=Number(process.env.PORT||8080);
const publicDirectory=process.env.F2K_PUBLIC_DIR||path.join(process.cwd(),'public');
const chatSarahWebhookUrl=process.env.CHAT_SARAH_WEBHOOK_URL||'';
const workspaceStores=new Map();
function storeFor(user){
  if(!workspaceStores.has(user))workspaceStores.set(user,new CloudWorkspaceStore({bucketName:process.env.F2K_STORAGE_BUCKET||'',localDirectory:process.env.F2K_STORAGE_DIR||'',namespace:user}));
  return workspaceStores.get(user);
}
const retentionMs=Math.max(15*60*1000,Number(process.env.F2K_RETENTION_MS||24*60*60*1000));
const jobs=new Map();
let queue=Promise.resolve();

const security=installSecurity(app,express);
installMakeRelay(app,express,{'/api/cutout':'CUTOUT_WEBHOOK_URL'});
app.use(express.json({limit:'75mb'}));
function authenticate(req,res,next){req.workspaceStore=storeFor(req.studioUser);next()}

function publicJob(job){
  return{
    jobId:job.id,
    status:job.status,
    progress:job.progress,
    error:job.error||undefined,
    downloadUrl:job.status==='completed'?`/api/video-jobs/${job.id}/download`:undefined,
    expiresAt:job.expiresAt?new Date(job.expiresAt).toISOString():undefined
  };
}

function validatePayload(body){
  const width=Math.round(Number(body.width)),height=Math.round(Number(body.height));
  const renderWidth=Math.round(Number(body.renderWidth||width)),renderHeight=Math.round(Number(body.renderHeight||height));
  const duration=Math.min(10,Math.max(1,Number(body.duration||5)));
  const fps=Math.min(24,Math.max(12,Math.round(Number(body.fps||24))));
  if(!body.html||typeof body.html!=='string')throw new Error('Missing render HTML');
  if(body.html.length>30_000_000)throw new Error('Render HTML is too large');
  if(!width||!height||width>2200||height>2200)throw new Error('Invalid output dimensions');
  if(!renderWidth||!renderHeight||renderWidth>1200||renderHeight>1200)throw new Error('Invalid render dimensions');
  return{html:body.html,width,height,renderWidth,renderHeight,duration,fps,filename:String(body.filename||'f2k-export.mp4').replace(/[^a-z0-9._-]/gi,'-')};
}

async function run(command,args,options={}){
  await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','ignore','pipe'],...options});
    let error='';
    child.stderr.on('data',chunk=>error+=chunk.toString());
    child.on('error',reject);
    child.on('close',code=>code===0?resolve():reject(new Error(`${command} exited with ${code}: ${error.slice(-2000)}`)));
  });
}

async function restrictRenderNetwork(page,htmlPath){
  const hosts=new Set(['fonts.googleapis.com','fonts.gstatic.com','res.cloudinary.com','f2kstudio.github.io']);
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return (url.protocol==='data:'||url.protocol==='blob:'||url.href===`file://${htmlPath}`||(url.protocol==='https:'&&(!url.port||url.port==='443')&&hosts.has(url.hostname)))?route.continue():route.abort();
  });
  await page.routeWebSocket('**/*',socket=>socket.close());
}

async function render(job,payload){
  if(job.cancelled)throw new DOMException('Render cancelled','AbortError');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),`f2k-${job.id}-`));
  const htmlPath=path.join(directory,'render.html');
  const outputPath=path.join(directory,'output.mp4');
  job.directory=directory;
  job.status='rendering';
  job.progress=2;
  await fs.writeFile(htmlPath,payload.html,'utf8');
  const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--no-sandbox']});
  try{
    const scale=Math.min(4,payload.width/payload.renderWidth,payload.height/payload.renderHeight);
    const page=await browser.newPage({serviceWorkers:'block',viewport:{width:payload.renderWidth,height:payload.renderHeight},deviceScaleFactor:scale});
    await restrictRenderNetwork(page,htmlPath);
    await page.goto(`file://${htmlPath}`,{waitUntil:'networkidle'});
    await page.evaluate(async()=>{if(document.fonts?.ready)await document.fonts.ready;for(const image of document.images){if(!image.complete)await new Promise(resolve=>{image.onload=image.onerror=resolve})}});
    await page.evaluate(()=>{const stage=document.querySelector('.stage');if(!stage)return;stage.classList.remove('animate-in');void stage.offsetWidth;stage.classList.add('animate-in')});
    const total=Math.round(payload.duration*payload.fps);
    for(let frame=0;frame<total;frame++){
      if(job.cancelled)throw new DOMException('Render cancelled','AbortError');
      const time=frame*1000/payload.fps;
      await page.evaluate(value=>{document.getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=value})},time);
      await page.screenshot({path:path.join(directory,`frame-${String(frame).padStart(6,'0')}.jpg`),type:'jpeg',quality:92});
      job.progress=Math.round(5+(frame+1)/total*75);
    }
  }finally{
    await browser.close();
  }
  job.status='encoding';
  job.progress=84;
  if(job.cancelled)throw new DOMException('Render cancelled','AbortError');
  await run('ffmpeg',['-y','-framerate',String(payload.fps),'-i',path.join(directory,'frame-%06d.jpg'),'-vf','crop=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',outputPath],{signal:job.abortController.signal});
  const entries=await fs.readdir(directory);
  await Promise.all(entries.filter(name=>name.startsWith('frame-')).map(name=>fs.unlink(path.join(directory,name))));
  await fs.rm(htmlPath,{force:true});
  job.outputPath=outputPath;
  job.filename=payload.filename.endsWith('.mp4')?payload.filename:`${payload.filename}.mp4`;
  job.status='completed';
  job.progress=100;
  job.expiresAt=Date.now()+retentionMs;
}

// PNGs are rendered in Chromium on the server too. This avoids the Safari/iOS
// `foreignObject` / canvas limitations of client-side html-to-image exports.
async function renderPng(payload){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'f2k-png-'));
  const htmlPath=path.join(directory,'render.html');
  await fs.writeFile(htmlPath,payload.html,'utf8');
  const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--no-sandbox']});
  try{
    const scale=Math.min(4,payload.width/payload.renderWidth,payload.height/payload.renderHeight);
    const page=await browser.newPage({serviceWorkers:'block',viewport:{width:payload.renderWidth,height:payload.renderHeight},deviceScaleFactor:scale});
    await restrictRenderNetwork(page,htmlPath);
    await page.goto(`file://${htmlPath}`,{waitUntil:'networkidle'});
    await page.evaluate(async()=>{
      if(document.fonts?.ready)await document.fonts.ready;
      for(const image of document.images){
        if(!image.complete)await new Promise(resolve=>{image.onload=image.onerror=resolve});
      }
    });
    return await page.screenshot({type:'png',omitBackground:true});
  }finally{
    await browser.close();
    await fs.rm(directory,{recursive:true,force:true}).catch(()=>{});
  }
}

function enqueue(job,payload){
  queue=queue.then(()=>job.cancelled?undefined:render(job,payload)).catch(async error=>{
    if(job.cancelled||error?.name==='AbortError'){
      job.status='cancelled';
      if(job.directory)await fs.rm(job.directory,{recursive:true,force:true}).catch(()=>{});
      return;
    }
    job.status='failed';
    job.error=error.message||'Video rendering failed';
  });
}

app.get('/api/health',(req,res)=>res.json({ok:true,queued:[...jobs.values()].filter(job=>['queued','rendering','encoding'].includes(job.status)).length}));

function requireCloudStore(req,res,next){
  if(!req.workspaceStore.enabled)return res.status(503).json({error:'La sauvegarde cloud n’est pas configurée.'});
  return next();
}

function cloudError(res,error){
  console.error('Cloud workspace error',error);
  res.status(error.statusCode||500).json({error:error.message||'La sauvegarde cloud a échoué.',code:error.code});
}

app.get('/api/workspace',authenticate,requireCloudStore,async(req,res)=>{
  try{res.json(await req.workspaceStore.workspace())}catch(error){cloudError(res,error)}
});

app.get('/api/projects/:id',authenticate,requireCloudStore,async(req,res)=>{
  try{const project=await req.workspaceStore.getProject(req.params.id);project?res.json(project):res.status(404).json({error:'Projet introuvable.'})}catch(error){cloudError(res,error)}
});

app.post('/api/projects',authenticate,requireCloudStore,async(req,res)=>{
  try{res.json(await req.workspaceStore.saveProject({id:req.body.id,name:req.body.name,data:req.body.data}))}catch(error){cloudError(res,error)}
});

app.delete('/api/projects/:id',authenticate,requireCloudStore,async(req,res)=>{
  try{(await req.workspaceStore.deleteProject(req.params.id))?res.json({ok:true}):res.status(404).json({error:'Projet introuvable.'})}catch(error){cloudError(res,error)}
});

app.post('/api/assets',authenticate,requireCloudStore,async(req,res)=>{
  try{res.json(await req.workspaceStore.addAsset({kind:req.body.kind,name:req.body.name,dataUrl:req.body.dataUrl,usage:req.body.usage}))}catch(error){cloudError(res,error)}
});

app.get('/api/assets/:id',authenticate,requireCloudStore,async(req,res)=>{
  try{
    const asset=await req.workspaceStore.getAsset(req.params.id);
    if(!asset)return res.status(404).end();
    res.setHeader('Cache-Control','private, no-store');
    res.type(asset.item.contentType).send(asset.buffer);
  }catch(error){cloudError(res,error)}
});

app.delete('/api/assets/:id',authenticate,requireCloudStore,async(req,res)=>{
  try{(await req.workspaceStore.removeAssetFromLibrary(req.params.id))?res.json({ok:true}):res.status(404).json({error:'Image introuvable.'})}catch(error){cloudError(res,error)}
});

app.post('/api/png',authenticate,async(req,res)=>{
  try{
    const payload=validatePayload(req.body);
    payload.html=await req.workspaceStore.inlineAssetUrls(payload.html);
    const png=await renderPng(payload);
    const filename=String(req.body.filename||'f2k-export.png').replace(/[^a-z0-9._-]/gi,'-').replace(/\.mp4$/i,'.png');
    res.type('png');
    res.setHeader('Content-Disposition',`attachment; filename="${filename.endsWith('.png')?filename:`${filename}.png`}"`);
    res.send(png);
  }catch(error){
    res.status(500).json({error:error.message||'PNG rendering failed'});
  }
});

app.post('/api/chat-sarah',authenticate,async(req,res)=>{
  if(!chatSarahWebhookUrl)return res.status(503).json({error:'Chat Sarah is not configured'});
  const message=String(req.body.message||'').trim(),email=String(req.body.email||'').trim().slice(0,320);
  if(!message||message.length>3000)return res.status(400).json({error:'Invalid message'});
  try{
    const response=await fetch(chatSarahWebhookUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:'Chat Sarah — F2K Studio',email,message,page:String(req.body.page||'').slice(0,1000),atelier:String(req.body.atelier||'').slice(0,80),format:String(req.body.format||'').slice(0,80),envoye_le:new Date().toISOString()})});
    if(!response.ok)throw new Error(`Make returned ${response.status}`);
    res.json({ok:true});
  }catch(error){
    res.status(502).json({error:'Message delivery failed'});
  }
});

app.post('/api/video-jobs',authenticate,async(req,res)=>{
  try{
    const payload=validatePayload(req.body);
    payload.html=await req.workspaceStore.inlineAssetUrls(payload.html);
    const id=crypto.randomUUID();
    const job={id,owner:req.studioUser,status:'queued',progress:0,createdAt:Date.now(),cancelled:false,abortController:new AbortController()};
    jobs.set(id,job);
    enqueue(job,payload);
    res.status(202).json(publicJob(job));
  }catch(error){
    res.status(400).json({error:error.message});
  }
});

app.get('/api/video-jobs/:id',authenticate,(req,res)=>{
  const job=jobs.get(req.params.id);
  if(!job||job.owner!==req.studioUser)return res.status(404).json({error:'Job not found'});
  res.json(publicJob(job));
});

app.delete('/api/video-jobs/:id',authenticate,(req,res)=>{
  const job=jobs.get(req.params.id);
  if(!job||job.owner!==req.studioUser)return res.status(404).json({error:'Job not found'});
  if(['completed','failed','cancelled'].includes(job.status))return res.json(publicJob(job));
  job.cancelled=true;
  job.status='cancelled';
  job.abortController.abort();
  res.json(publicJob(job));
});

app.get('/api/video-jobs/:id/download',authenticate,(req,res)=>{
  const job=jobs.get(req.params.id);
  if(!job||job.owner!==req.studioUser||job.status!=='completed')return res.status(404).json({error:'Video is not available'});
  res.download(job.outputPath,job.filename);
});

setInterval(async()=>{
  const now=Date.now();
  for(const [id,job] of jobs){
    const expired=job.expiresAt&&job.expiresAt<=now;
    const abandoned=job.status==='failed'&&now-job.createdAt>60*60*1000;
    if(!expired&&!abandoned)continue;
    if(job.directory)await fs.rm(job.directory,{recursive:true,force:true}).catch(()=>{});
    jobs.delete(id);
  }
},10*60*1000).unref();

app.get(['/', '/index.html'],(req,res)=>{res.setHeader('Cache-Control','no-store');security.sendEditor(req,res,path.join(publicDirectory,'index.html'))});
app.use(express.static(publicDirectory,{index:false,maxAge:process.env.NODE_ENV==='production'?'5m':0}));

app.listen(port,'0.0.0.0',()=>console.log(`F2K renderer listening on ${port}`));
