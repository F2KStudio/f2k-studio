import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {Storage} from '@google-cloud/storage';

export const CLOUD_LIMITS=Object.freeze({projects:10,products:20,cards:40,elements:20});
const VALID_KINDS=new Set(['products','cards','elements']);
const ROOT='workspace/v1';

function cleanName(value,fallback='Sans nom'){
  return String(value||fallback).trim().replace(/[\u0000-\u001f]/g,' ').slice(0,100)||fallback;
}

function imageFromDataUrl(value){
  const match=String(value||'').match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
  if(!match)throw Object.assign(new Error('Image invalide.'),{statusCode:400});
  const buffer=Buffer.from(match[2].replace(/\s/g,''),'base64');
  if(!buffer.length||buffer.length>12*1024*1024)throw Object.assign(new Error('Image trop volumineuse (12 Mo maximum).'),{statusCode:413});
  return{contentType:match[1].toLowerCase(),buffer};
}

function extensionFor(contentType){
  return contentType==='image/jpeg'?'jpg':contentType.split('/')[1];
}

export class CloudWorkspaceStore{
  constructor({bucketName='',localDirectory='' }={}){
    this.bucketName=bucketName;
    this.localDirectory=localDirectory;
    this.storage=bucketName?new Storage():null;
    this.bucket=bucketName?this.storage.bucket(bucketName):null;
    this.mutation=Promise.resolve();
  }

  get enabled(){return Boolean(this.bucket||this.localDirectory)}

  async read(key){
    if(this.bucket){
      const file=this.bucket.file(`${ROOT}/${key}`);
      const [exists]=await file.exists();
      if(!exists)return null;
      const [buffer]=await file.download();
      return buffer;
    }
    try{return await fs.readFile(path.join(this.localDirectory,key))}catch(error){if(error.code==='ENOENT')return null;throw error}
  }

  async write(key,buffer,contentType='application/octet-stream'){
    if(this.bucket){
      await this.bucket.file(`${ROOT}/${key}`).save(buffer,{resumable:false,contentType,metadata:{cacheControl:contentType.startsWith('image/')?'private, max-age=31536000':'no-store'}});
      return;
    }
    const target=path.join(this.localDirectory,key);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,buffer);
  }

  async remove(key){
    if(this.bucket){await this.bucket.file(`${ROOT}/${key}`).delete({ignoreNotFound:true});return}
    await fs.rm(path.join(this.localDirectory,key),{force:true});
  }

  async readJson(key,fallback){
    const buffer=await this.read(key);
    if(!buffer)return structuredClone(fallback);
    try{return JSON.parse(buffer.toString('utf8'))}catch(_){return structuredClone(fallback)}
  }

  writeJson(key,value){return this.write(key,Buffer.from(JSON.stringify(value)),'application/json')}

  serialized(task){
    const next=this.mutation.then(task,task);
    this.mutation=next.catch(()=>{});
    return next;
  }

  async workspace(){
    const [projectIndex,assetIndex]=await Promise.all([
      this.readJson('projects/index.json',{projects:[]}),
      this.readJson('assets/index.json',{assets:[]})
    ]);
    return{
      limits:CLOUD_LIMITS,
      projects:(projectIndex.projects||[]).sort((a,b)=>(b.savedAt||0)-(a.savedAt||0)),
      libraries:Object.fromEntries([...VALID_KINDS].map(kind=>[kind,(assetIndex.assets||[]).filter(item=>item.kind===kind&&item.inLibrary!==false).map(item=>({...item,url:`/api/assets/${item.id}`}))]))
    };
  }

  async getProject(id){
    const index=await this.readJson('projects/index.json',{projects:[]});
    const summary=(index.projects||[]).find(item=>item.id===id);
    if(!summary)return null;
    const data=await this.readJson(`projects/${id}.json`,null);
    return data?{...summary,data}:null;
  }

  saveProject({id='',name='',data}){
    return this.serialized(async()=>{
      if(!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(new Error('Projet invalide.'),{statusCode:400});
      const index=await this.readJson('projects/index.json',{projects:[]});
      const projects=index.projects||[];
      const normalizedName=cleanName(name,'Projet sans nom');
      let existing=id?projects.find(item=>item.id===id):projects.find(item=>item.name.toLocaleLowerCase('fr')===normalizedName.toLocaleLowerCase('fr'));
      if(!existing&&projects.length>=CLOUD_LIMITS.projects)throw Object.assign(new Error('La limite de 10 projets est atteinte. Supprime un ancien projet pour continuer.'),{statusCode:409,code:'PROJECT_LIMIT'});
      const projectId=existing?.id||crypto.randomUUID(),savedAt=Date.now(),summary={id:projectId,name:normalizedName,savedAt};
      const next=projects.filter(item=>item.id!==projectId);
      next.push(summary);
      await this.writeJson(`projects/${projectId}.json`,data);
      await this.writeJson('projects/index.json',{projects:next});
      return summary;
    });
  }

  deleteProject(id){
    return this.serialized(async()=>{
      const index=await this.readJson('projects/index.json',{projects:[]});
      const projects=index.projects||[];
      if(!projects.some(item=>item.id===id))return false;
      await this.writeJson('projects/index.json',{projects:projects.filter(item=>item.id!==id)});
      await this.remove(`projects/${id}.json`);
      return true;
    });
  }

  addAsset({kind,name,dataUrl,usage='library'}){
    return this.serialized(async()=>{
      if(!VALID_KINDS.has(kind))throw Object.assign(new Error('Catégorie invalide.'),{statusCode:400});
      const {contentType,buffer}=imageFromDataUrl(dataUrl),sha256=crypto.createHash('sha256').update(buffer).digest('hex');
      const normalizedUsage=usage==='background'?'background':'element';
      const index=await this.readJson('assets/index.json',{assets:[]}),assets=index.assets||[];
      const duplicate=assets.find(item=>item.kind===kind&&item.usage===normalizedUsage&&item.sha256===sha256&&item.inLibrary!==false);
      if(duplicate)return{...duplicate,url:`/api/assets/${duplicate.id}`,duplicate:true};
      const inKind=assets.filter(item=>item.kind===kind&&item.inLibrary!==false).length;
      if(inKind>=CLOUD_LIMITS[kind])throw Object.assign(new Error(`La limite de ${CLOUD_LIMITS[kind]} ${kind==='products'?'produits':kind==='cards'?'cartes':'éléments personnels'} est atteinte.`),{statusCode:409,code:'ASSET_LIMIT'});
      const id=crypto.randomUUID(),extension=extensionFor(contentType),objectKey=`assets/files/${id}.${extension}`;
      const item={id,kind,name:cleanName(name,kind==='products'?'Produit':kind==='cards'?'Carte':'Élément'),usage:normalizedUsage,contentType,objectKey,sha256,createdAt:Date.now(),inLibrary:true};
      await this.write(objectKey,buffer,contentType);
      assets.push(item);
      await this.writeJson('assets/index.json',{assets});
      return{...item,url:`/api/assets/${id}`};
    });
  }

  async getAsset(id){
    const index=await this.readJson('assets/index.json',{assets:[]});
    const item=(index.assets||[]).find(asset=>asset.id===id);
    if(!item)return null;
    const buffer=await this.read(item.objectKey);
    return buffer?{item,buffer}:null;
  }

  removeAssetFromLibrary(id){
    return this.serialized(async()=>{
      const index=await this.readJson('assets/index.json',{assets:[]}),assets=index.assets||[];
      const item=assets.find(asset=>asset.id===id);
      if(!item)return false;
      item.inLibrary=false;
      await this.writeJson('assets/index.json',{assets});
      return true;
    });
  }
}
