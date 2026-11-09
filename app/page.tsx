 "use client";

import { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import AdSenseUnit from "./AdSenseUnit";

type Category = { id: string; name: string; subcategories: {id: string; name: string}[] };
type Video = {
  id: string; title: string; thumbnail: string; url: string; channel?: string;
  duration?: number | null; uploadDate?: string; categoryId: string; subcategoryId: string;
  addedAt: string; contentType?: string; platform?: string;
};
type ExtractResult = {url: string; video?: Omit<Video, "categoryId"|"subcategoryId"|"addedAt">; error?: string};
type ImportRow = {url: string; category?: string; subcategory?: string};
type ImportStatus = "ADDED" | "SKIPPED – DUPLICATE" | "SKIPPED – INVALID URL" | "SKIPPED – EXTRACTION FAILED";
type ImportLogRow = {
  url: string; category: string; subcategory: string; status: ImportStatus;
  reason: string; videoTitle: string; processedAt: string;
};

const STORAGE_KEY = "youtube-content-library-v2";
const IMPORT_LOG_KEY = "youtube-content-import-log-v1";
const DEFAULT_CATEGORIES: Category[] = [
  {id:"food", name:"Food", subcategories:[{id:"recipes",name:"Recipes"},{id:"cooking-techniques",name:"Cooking Techniques"},{id:"baking",name:"Baking"}]},
  {id:"diy", name:"DIY", subcategories:[{id:"home-projects",name:"Home Projects"},{id:"crafts",name:"Crafts"},{id:"repairs",name:"Repairs"}]},
  {id:"agriculture", name:"Agriculture", subcategories:[{id:"organic-farming",name:"Organic Farming"},{id:"crop-cultivation",name:"Crop Cultivation"},{id:"livestock",name:"Livestock"}]}
];

function slug(s:string) { return s.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || `item-${Date.now()}`; }
function parseCsv(text:string): ImportRow[] {
  // Small RFC-4180-style parser: quoted fields, escaped quotes, commas and newlines.
  const rows:string[][]=[]; let row:string[]=[], field="", quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){ if(c === '"' && text[i+1] === '"'){field+='"';i++;} else if(c === '"') quoted=false; else field+=c; }
    else if(c === '"') quoted=true;
    else if(c === ','){row.push(field.trim());field="";}
    else if(c === '\n'){row.push(field.trim());rows.push(row);row=[];field="";}
    else if(c !== '\r') field+=c;
  }
  row.push(field.trim()); if(row.some(x=>x)) rows.push(row);
  if(!rows.length) return [];
  const headers=rows[0].map(x=>x.toLowerCase().replace(/^\uFEFF/,""));
  const urlIndex=headers.findIndex(x=>["url","link","website","website url","article url","youtube url","video url","facebook url","instagram url","tiktok url","pinterest url","linkedin url","twitter url","x url"].includes(x) || x.endsWith(" url"));
  const catIndex=headers.findIndex(x=>["category","main category"].includes(x));
  const subIndex=headers.findIndex(x=>["subcategory","sub-category","sub category"].includes(x));
  const start = urlIndex >= 0 ? 1 : 0;
  const ui = urlIndex >= 0 ? urlIndex : 0;
  return rows.slice(start).map(r=>({url:(r[ui]||"").trim(),category:catIndex>=0?r[catIndex]?.trim():"",subcategory:subIndex>=0?r[subIndex]?.trim():""})).filter(r=>r.url);
}
function canonicalVideoId(raw:string):string|null{
  try{
    const u=new URL(raw.trim()); const host=u.hostname.toLowerCase().replace(/^www\./,"");
    if(host==="youtu.be") return u.pathname.split("/").filter(Boolean)[0]||null;
    if(["youtube.com","m.youtube.com","youtube-nocookie.com","music.youtube.com"].includes(host)){
      if(u.searchParams.get("v")) return u.searchParams.get("v");
      const p=u.pathname.split("/").filter(Boolean);
      if(["embed","shorts","live"].includes(p[0])) return p[1]||null;
    }
  }catch{}
  return null;
}
type LinkInfo = {
  id:string; url:string; kind:"youtube"|"web"; platform:string; contentType:string;
  host:string; title:string;
};
function stableLinkId(value:string):string{
  // FNV-1a 32-bit hash; URL itself is also stored and used for opening the link.
  let hash=0x811c9dc5;
  for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,0x01000193);}
  return `link-${(hash>>>0).toString(16).padStart(8,"0")}`;
}
function identifyLink(raw:string):LinkInfo|null{
  try{
    const input=raw.trim();
    if(!input)return null;
    const candidate=/^https?:\/\//i.test(input)?input:`https://${input}`;
    const u=new URL(candidate);
    if(!["http:","https:"].includes(u.protocol) || u.username || u.password)return null;
    const host=u.hostname.toLowerCase().replace(/^www\./,"");
    if(!host || !host.includes(".") || host==="localhost" || host.endsWith(".local"))return null;

    const youtubeId=canonicalVideoId(u.toString());
    if(youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId)){
      return {id:youtubeId,url:`https://www.youtube.com/watch?v=${youtubeId}`,kind:"youtube",platform:"YouTube",contentType:"YouTube video",host:"YouTube",title:""};
    }

    // Remove common tracking parameters so the same shared link is less likely to be saved twice.
    for(const key of [...u.searchParams.keys()]){
      if(/^utm_/i.test(key) || ["fbclid","gclid","igsh","igshid","si","feature"].includes(key.toLowerCase())) u.searchParams.delete(key);
    }
    u.hash="";
    if(u.pathname.length>1) u.pathname=u.pathname.replace(/\/+$/,"");
    const normalized=u.toString();
    const socialPlatforms:Array<[RegExp,string,string]>=[
      [/(^|\.)facebook\.com$|(^|\.)fb\.watch$/,"Facebook","Facebook link"],
      [/(^|\.)instagram\.com$/,"Instagram","Instagram link"],
      [/(^|\.)tiktok\.com$/,"TikTok","TikTok link"],
      [/(^|\.)pinterest\.[a-z.]+$/,"Pinterest","Pinterest link"],
      [/(^|\.)linkedin\.com$/,"LinkedIn","LinkedIn link"],
      [/(^|\.)x\.com$|(^|\.)twitter\.com$/,"X / Twitter","Social media link"],
      [/(^|\.)reddit\.com$|(^|\.)redd\.it$/,"Reddit","Reddit link"],
      [/(^|\.)threads\.net$/,"Threads","Social media link"],
      [/(^|\.)t\.me$|(^|\.)telegram\.me$/,"Telegram","Social media link"]
    ];
    const social=socialPlatforms.find(([pattern])=>pattern.test(host));
    const articleHosts=/(^|\.)medium\.com$|(^|\.)substack\.com$|(^|\.)dev\.to$|(^|\.)theconversation\.com$/;
    const path=u.pathname.split("/").filter(Boolean).pop()||"";
    const looksLikeArticle=articleHosts.test(host) || /\.(html?|php)$/i.test(path) || /\/(article|articles|blog|news|story|stories)\//i.test(u.pathname);
    const isYoutubeSite=["youtube.com","m.youtube.com","music.youtube.com","youtube-nocookie.com","youtu.be"].includes(host);
    const platform=social?.[1] || (isYoutubeSite?"YouTube":host);
    const contentType=social?.[2] || (isYoutubeSite?"YouTube link":looksLikeArticle?"Article":"Website link");
    let decodedPath=path;
    try{decodedPath=decodeURIComponent(path);}catch{}
    let title=decodedPath ? decodedPath.replace(/\.[a-z0-9]{1,5}$/i,"").replace(/[-_]+/g," ").replace(/\s+/g," ").trim() : "";
    if(!title || title.length<3) title=host;
    title=title.charAt(0).toUpperCase()+title.slice(1);
    if(social || isYoutubeSite) title=`${platform} link — ${title}`;
    return {id:stableLinkId(normalized),url:normalized,kind:"web",platform,contentType,host,title};
  }catch{return null;}
}
function durationLabel(n?:number|null){if(n==null)return "";const h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=n%60;return h?`${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${m}:${String(s).padStart(2,"0")}`;}

export default function Home(){
  const [categories,setCategories]=useState<Category[]>(DEFAULT_CATEGORIES);
  const [videos,setVideos]=useState<Video[]>([]);
  const [hydrated,setHydrated]=useState(false);
  const [categoryId,setCategoryId]=useState("food");
  const [subcategoryId,setSubcategoryId]=useState("recipes");
  const [urlText,setUrlText]=useState("");
  const [newCategory,setNewCategory]=useState("");
  const [newSubcategory,setNewSubcategory]=useState("");
  const [selectedFile,setSelectedFile]=useState<File|null>(null);
  const [loading,setLoading]=useState(false);
  const [importResults,setImportResults]=useState<ImportLogRow[]>([]);
  const [importProgress,setImportProgress]=useState({done:0,total:0});
  const [notice,setNotice]=useState("");
  const [filterCategory,setFilterCategory]=useState("all");
  const [filterSubcategory,setFilterSubcategory]=useState("all");
  const [search,setSearch]=useState("");
  const [selectedVideoIds,setSelectedVideoIds]=useState<string[]>([]);
  const [editingSubcategoryId,setEditingSubcategoryId]=useState<string|null>(null);
  const [editingSubcategoryName,setEditingSubcategoryName]=useState("");
  const [dragSelection,setDragSelection]=useState<{left:number;top:number;width:number;height:number}|null>(null);
  const gridRef=useRef<HTMLDivElement>(null);
  const dragRef=useRef<{pointerId:number;startX:number;startY:number;currentX:number;currentY:number;additive:boolean;active:boolean}|null>(null);
  const suppressCardClickRef=useRef(false);
  const fileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    try{
      const saved=localStorage.getItem(STORAGE_KEY);
      if(saved){const data=JSON.parse(saved);if(Array.isArray(data.categories)&&data.categories.length)setCategories(data.categories);if(Array.isArray(data.videos))setVideos(data.videos);}
    }catch{ /* Ignore corrupt local browser data; keep starter categories. */ }
    try{
      const savedLog=localStorage.getItem(IMPORT_LOG_KEY);
      if(savedLog){const parsed=JSON.parse(savedLog);if(Array.isArray(parsed)){setImportResults(parsed);setImportProgress({done:parsed.length,total:parsed.length});}}
    }catch{ /* Ignore a damaged previous import log. */ }
    setHydrated(true);
  },[]);
  useEffect(()=>{if(hydrated)localStorage.setItem(STORAGE_KEY,JSON.stringify({categories,videos}));},[categories,videos,hydrated]);

  const currentCategory=categories.find(c=>c.id===categoryId)||categories[0];
  const filtered=useMemo(()=>videos.filter(v=>{
    const catOk=filterCategory==="all"||v.categoryId===filterCategory;
    const subOk=filterSubcategory==="all"||v.subcategoryId===filterSubcategory;
    const q=search.toLowerCase();
    return catOk&&subOk&&(!q||`${v.title} ${v.channel||""} ${v.id} ${v.url} ${v.platform||""} ${v.contentType||""}`.toLowerCase().includes(q));
  }),[videos,filterCategory,filterSubcategory,search]);
  const subOptions=currentCategory?.subcategories||[];

  function chooseCategory(id:string){
    setCategoryId(id);
    const c=categories.find(x=>x.id===id);
    setSubcategoryId("");
    setFilterCategory(id);
    setFilterSubcategory("all");
    setSelectedVideoIds([]);
  }
  function chooseSubcategory(id:string){
    setSubcategoryId(id);
    setFilterCategory(currentCategory.id);
    setFilterSubcategory(id||"all");
    setSelectedVideoIds([]);
  }
  function beginEditSubcategory(sub:{id:string;name:string}){
    setEditingSubcategoryId(sub.id);setEditingSubcategoryName(sub.name);
  }
  function saveSubcategoryEdit(){
    if(!currentCategory||!editingSubcategoryId)return;
    const name=editingSubcategoryName.trim();
    if(!name){setNotice("Subcategory name cannot be empty.");return;}
    if(currentCategory.subcategories.some(s=>s.id!==editingSubcategoryId&&s.name.toLowerCase()===name.toLowerCase())){setNotice("That subcategory name already exists in this category.");return;}
    setCategories(prev=>prev.map(c=>c.id===currentCategory.id?{...c,subcategories:c.subcategories.map(s=>s.id===editingSubcategoryId?{...s,name}:s)}:c));
    setEditingSubcategoryId(null);setEditingSubcategoryName("");setNotice(`Subcategory renamed to “${name}”.`);
  }
  function removeSubcategory(id:string){
    if(!currentCategory)return;
    const sub=currentCategory.subcategories.find(s=>s.id===id);if(!sub)return;
    const count=videos.filter(v=>v.categoryId===currentCategory.id&&v.subcategoryId===id).length;
    const message=count?`Delete “${sub.name}”? ${count} saved item(s) will remain in ${currentCategory.name} but become uncategorised within it.`:`Delete subcategory “${sub.name}”?`;
    if(!confirm(message))return;
    setCategories(prev=>prev.map(c=>c.id===currentCategory.id?{...c,subcategories:c.subcategories.filter(s=>s.id!==id)}:c));
    setVideos(prev=>prev.map(v=>v.categoryId===currentCategory.id&&v.subcategoryId===id?{...v,subcategoryId:""}:v));
    if(subcategoryId===id)setSubcategoryId("");
    if(filterSubcategory===id)setFilterSubcategory("all");
    setEditingSubcategoryId(null);setNotice(`Subcategory “${sub.name}” deleted. Saved content was kept.`);
  }
  function addCategory(){
    const name=newCategory.trim();if(!name)return;
    if(categories.some(c=>c.name.toLowerCase()===name.toLowerCase())){setNotice("That category already exists.");return;}
    const item={id:slug(name),name,subcategories:[]};setCategories(p=>[...p,item]);setCategoryId(item.id);setSubcategoryId("");setNewCategory("");setNotice(`Category “${name}” created.`);
  }
  function addSubcategory(){
    const name=newSubcategory.trim();if(!name||!currentCategory)return;
    if(currentCategory.subcategories.some(s=>s.name.toLowerCase()===name.toLowerCase())){setNotice("That subcategory already exists in this category.");return;}
    const item={id:slug(`${currentCategory.id}-${name}`),name};
    setCategories(p=>p.map(c=>c.id===currentCategory.id?{...c,subcategories:[...c.subcategories,item]}:c));
    setSubcategoryId(item.id);setNewSubcategory("");setNotice(`Subcategory “${name}” created.`);
  }
  function findOrCreateCategory(name:string){
    const clean=name.trim();if(!clean)return categories[0];
    let found=categories.find(c=>c.name.toLowerCase()===clean.toLowerCase());if(found)return found;
    const created={id:slug(clean),name:clean,subcategories:[]};setCategories(p=>p.some(c=>c.name.toLowerCase()===clean.toLowerCase())?p:[...p,created]);return created;
  }
  function findOrCreateSub(cat:Category,name:string){
    const clean=name.trim();if(!clean)return cat.subcategories[0];
    let found=cat.subcategories.find(s=>s.name.toLowerCase()===clean.toLowerCase());if(found)return found;
    const created={id:slug(`${cat.id}-${clean}`),name:clean};
    setCategories(p=>p.map(c=>c.id===cat.id?{...c,subcategories:c.subcategories.some(s=>s.name.toLowerCase()===clean.toLowerCase())?c.subcategories:[...c.subcategories,created]}:c));
    return created;
  }

  async function extractRows(rows:ImportRow[]){
    if(!rows.length){setNotice("No URLs were found.");return;}
    if(rows.length>400){setNotice("Import up to 100 URLs at a time.");return;}

    setLoading(true);
    setImportResults([]);
    try{localStorage.setItem(IMPORT_LOG_KEY,"[]");}catch{}
    setImportProgress({done:0,total:rows.length});
    setNotice(`Preparing ${rows.length} link(s)…`);

    const log:ImportLogRow[]=[];
    const seenInFile=new Set<string>();
    const knownIds=new Set(videos.map(v=>v.id));
    let workingVideos:Video[]=videos.slice();
    let workingCategories:Category[]=categories.map(c=>({...c,subcategories:[...c.subcategories]}));

    const addLog=(entry:ImportLogRow)=>{
      log.push(entry);
      setImportResults([...log]);
      try{localStorage.setItem(IMPORT_LOG_KEY,JSON.stringify(log));}catch{}
      setImportProgress({done:log.length,total:rows.length});
    };

    try{
      for(let index=0;index<rows.length;index++){
        const row=rows[index];
        const url=row.url.trim();
        const requestedCategory=row.category?.trim() || currentCategory?.name || "Uncategorised";
        const requestedSubcategory=row.subcategory?.trim() ||
          (row.category?.trim() ? "" : currentCategory?.subcategories.find(s=>s.id===subcategoryId)?.name || "");

        const linkInfo=identifyLink(url);
        if(!linkInfo){
          addLog({url,category:requestedCategory,subcategory:requestedSubcategory,status:"SKIPPED – INVALID URL",reason:"Enter a valid public http:// or https:// website URL.",videoTitle:"",processedAt:new Date().toISOString()});
          continue;
        }
        const identity=linkInfo.id;
        if(knownIds.has(identity)){
          addLog({url,category:requestedCategory,subcategory:requestedSubcategory,status:"SKIPPED – DUPLICATE",reason:"This link is already in your library.",videoTitle:"",processedAt:new Date().toISOString()});
          continue;
        }
        if(seenInFile.has(identity)){
          addLog({url,category:requestedCategory,subcategory:requestedSubcategory,status:"SKIPPED – DUPLICATE",reason:"This link appeared earlier in the same import file.",videoTitle:"",processedAt:new Date().toISOString()});
          continue;
        }
        seenInFile.add(identity);

        setNotice(`Processing ${index+1} of ${rows.length}: ${url}`);
        try{
          let extractedVideo:Omit<Video,"categoryId"|"subcategoryId"|"addedAt">;
          if(linkInfo.kind==="youtube"){
            const response=await fetch("/api/extract",{
              method:"POST",
              headers:{"Content-Type":"application/json"},
              body:JSON.stringify({urls:[linkInfo.url]})
            });
            let data:any;
            try{data=await response.json();}catch{data=null;}
            if(!response.ok) throw new Error(data?.error || `Server returned HTTP ${response.status}.`);
            const result:ExtractResult|undefined=data?.results?.[0];
            if(!result?.video) throw new Error(result?.error || "No YouTube metadata was returned.");
            extractedVideo={...result.video,contentType:"YouTube video",platform:"YouTube"};
          }else{
            // Retrieve basic metadata where the platform exposes it. Metadata is best-effort:
            // blocked/private pages still remain saveable as ordinary bookmarks.
            let metadata:{title?:string;thumbnail?:string;platform?:string;contentType?:string}|null=null;
            try{
              const response=await fetch("/api/metadata",{
                method:"POST",
                headers:{"Content-Type":"application/json"},
                body:JSON.stringify({url:linkInfo.url})
              });
              const data=await response.json().catch(()=>null);
              if(response.ok && data?.metadata) metadata=data.metadata;
            }catch{ /* Keep the fallback card if metadata lookup is unavailable. */ }
            extractedVideo={
              id:linkInfo.id,
              title:metadata?.title?.trim() || linkInfo.title,
              thumbnail:metadata?.thumbnail || "",
              url:linkInfo.url,
              channel:linkInfo.host,
              duration:null,
              uploadDate:"",
              contentType:metadata?.contentType || linkInfo.contentType,
              platform:metadata?.platform || linkInfo.platform
            };
          }

          const id=extractedVideo.id;
          if(knownIds.has(id)){
            addLog({url,category:requestedCategory,subcategory:requestedSubcategory,status:"SKIPPED – DUPLICATE",reason:"This link is already in your library.",videoTitle:extractedVideo.title||"",processedAt:new Date().toISOString()});
            continue;
          }

          let cat=workingCategories.find(c=>c.name.toLowerCase()===requestedCategory.toLowerCase());
          if(!cat){
            cat={id:slug(requestedCategory),name:requestedCategory,subcategories:[]};
            workingCategories=[...workingCategories,cat];
          }
          let sub=cat.subcategories.find(s=>s.name.toLowerCase()===requestedSubcategory.toLowerCase());
          if(!sub && requestedSubcategory){
            sub={id:slug(`${cat.id}-${requestedSubcategory}`),name:requestedSubcategory};
            workingCategories=workingCategories.map(c=>c.id===cat!.id?{...c,subcategories:[...c.subcategories,sub!]}:c);
            cat=workingCategories.find(c=>c.id===cat!.id)!;
          }
          if(!sub) sub=cat.subcategories[0];

          const newVideo:Video={
            ...extractedVideo,
            categoryId:cat.id,
            subcategoryId:sub?.id||"",
            addedAt:new Date().toISOString()
          };
          // Persist this individual result before marking it ADDED or moving on.
          const nextVideos=[...workingVideos,newVideo];
          localStorage.setItem(STORAGE_KEY,JSON.stringify({categories:workingCategories,videos:nextVideos}));
          workingVideos=nextVideos;
          knownIds.add(id);
          setCategories([...workingCategories]);
          setVideos(workingVideos);
          const hasPreview=Boolean(newVideo.thumbnail) || (newVideo.title && newVideo.title!==linkInfo.title);
          const reason=linkInfo.kind==="youtube"
            ?"YouTube metadata retrieved and video saved to this browser's library."
            :hasPreview
              ?"Basic page metadata retrieved where available; link saved to this browser's library."
              :"Metadata was unavailable or restricted; the link was saved with a fallback preview.";
          addLog({url:linkInfo.url,category:cat.name,subcategory:sub?.name||"",status:"ADDED",reason,videoTitle:newVideo.title,processedAt:new Date().toISOString()});
        }catch(error){
          addLog({url,category:requestedCategory,subcategory:requestedSubcategory,status:"SKIPPED – EXTRACTION FAILED",reason:error instanceof Error?error.message:"Link could not be saved.",videoTitle:"",processedAt:new Date().toISOString()});
        }
      }

      const added=log.filter(x=>x.status==="ADDED").length;
      const duplicates=log.filter(x=>x.status==="SKIPPED – DUPLICATE").length;
      const invalid=log.filter(x=>x.status==="SKIPPED – INVALID URL").length;
      const failed=log.filter(x=>x.status==="SKIPPED – EXTRACTION FAILED").length;
      setNotice(`Import finished: ${added} added; ${duplicates} duplicates skipped; ${invalid} invalid links; ${failed} extraction failures. Every link has a recorded result.`);
    }finally{
      setLoading(false);
    }
  }

  async function submitManual(e:FormEvent){
    e.preventDefault();
    const urls=urlText.split(/[\s,]+/).map(x=>x.trim()).filter(Boolean);
    await extractRows(urls.map(url=>({url,category:currentCategory?.name,subcategory:currentCategory?.subcategories.find(s=>s.id===subcategoryId)?.name||""})));
    setUrlText("");
  }
  async function handleFile(e:ChangeEvent<HTMLInputElement>){
    const file=e.target.files?.[0];if(!file)return;
    setSelectedFile(file);
    const text=await file.text();const rows=parseCsv(text);
    if(!rows.length){setNotice("Could not find URLs. Use a CSV with a URL column (and optional Category, Subcategory columns).");return;}
    await extractRows(rows);
    e.target.value="";
    setSelectedFile(null);
  }
  function downloadTemplate(){
    const csv="URL,Category,Subcategory\nhttps://www.youtube.com/watch?v=VIDEO_ID,Video,To Watch\nhttps://www.instagram.com/p/EXAMPLE/,Social Media,Instagram\nhttps://example.com/article,Articles,To Read\n";
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="content-links-import-template.csv";a.click();URL.revokeObjectURL(a.href);
  }
  function exportCsv(){
    const rows=[["ID","Content Type","Platform","Title","Source / Channel","Thumbnail URL","URL","Category","Subcategory","Duration seconds","Publication date","Added At"],
      ...videos.map(v=>[v.id,v.contentType||"YouTube video",v.platform||"YouTube",v.title,v.channel||"",v.thumbnail,v.url,categories.find(c=>c.id===v.categoryId)?.name||"",categories.find(c=>c.id===v.categoryId)?.subcategories.find(s=>s.id===v.subcategoryId)?.name||"",v.duration??"",v.uploadDate||"",v.addedAt])];
    const csv=rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(",")).join("\r\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="content-library.csv";a.click();URL.revokeObjectURL(a.href);
  }
  function exportImportResults(){
    const rows=[
      ["URL","Category","Subcategory","Status","Reason","Video Title","Processed At"],
      ...importResults.map(r=>[r.url,r.category,r.subcategory,r.status,r.reason,r.videoTitle,r.processedAt])
    ];
    const csv=rows.map(r=>r.map(x=>`"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="content-import-results.csv";a.click();URL.revokeObjectURL(a.href);
  }
  function toggleVideoSelection(id:string, checked:boolean){
    setSelectedVideoIds(current=>checked
      ? (current.includes(id)?current:[...current,id])
      : current.filter(item=>item!==id));
  }
  function toggleVisibleSelection(){
    const visibleIds=filtered.map(v=>v.id);
    const allVisibleSelected=visibleIds.length>0&&visibleIds.every(id=>selectedVideoIds.includes(id));
    setSelectedVideoIds(current=>allVisibleSelected
      ? current.filter(id=>!visibleIds.includes(id))
      : [...new Set([...current,...visibleIds])]);
  }
  function clearVideoSelection(){setSelectedVideoIds([]);}
  function selectionRect(a:{startX:number;startY:number;currentX:number;currentY:number}){
    return {left:Math.min(a.startX,a.currentX),top:Math.min(a.startY,a.currentY),width:Math.abs(a.currentX-a.startX),height:Math.abs(a.currentY-a.startY)};
  }
  function handleGridPointerDown(e:ReactPointerEvent<HTMLDivElement>){
    if(e.pointerType!=="mouse"||e.button!==0)return;
    const target=e.target as HTMLElement;
    if(target.closest("button,input,select,textarea"))return;
    const bounds=e.currentTarget.getBoundingClientRect();
    const x=e.clientX-bounds.left,y=e.clientY-bounds.top;
    dragRef.current={pointerId:e.pointerId,startX:x,startY:y,currentX:x,currentY:y,additive:e.shiftKey||e.ctrlKey||e.metaKey,active:false};
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handleGridPointerMove(e:ReactPointerEvent<HTMLDivElement>){
    const drag=dragRef.current;if(!drag||drag.pointerId!==e.pointerId)return;
    const bounds=e.currentTarget.getBoundingClientRect();
    drag.currentX=e.clientX-bounds.left;drag.currentY=e.clientY-bounds.top;
    const moved=Math.hypot(drag.currentX-drag.startX,drag.currentY-drag.startY)>5;
    if(!moved)return;
    drag.active=true;suppressCardClickRef.current=true;
    const rect=selectionRect(drag);setDragSelection(rect);
    const marquee={left:rect.left,top:rect.top,right:rect.left+rect.width,bottom:rect.top+rect.height};
    const hits=Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-video-id]")).filter(card=>{
      const r=card.getBoundingClientRect();const left=r.left-bounds.left,top=r.top-bounds.top;
      return left<marquee.right&&left+r.width>marquee.left&&top<marquee.bottom&&top+r.height>marquee.top;
    }).map(card=>card.dataset.videoId!).filter(Boolean);
    setSelectedVideoIds(current=>drag.additive?[...new Set([...current,...hits])]:hits);
  }
  function handleGridPointerUp(e:ReactPointerEvent<HTMLDivElement>){
    const drag=dragRef.current;if(!drag||drag.pointerId!==e.pointerId)return;
    if(drag.active)suppressCardClickRef.current=true;
    dragRef.current=null;setDragSelection(null);
  }
  function handleGridClickCapture(e:ReactMouseEvent<HTMLDivElement>){
    if(suppressCardClickRef.current){e.preventDefault();e.stopPropagation();suppressCardClickRef.current=false;}
  }
  function deleteSelectedVideos(){
    const idsToDelete=new Set(selectedVideoIds);
    const count=videos.filter(v=>idsToDelete.has(v.id)).length;
    if(!count){setSelectedVideoIds([]);return;}
    if(!confirm(`Permanently remove ${count} selected video(s) from this browser's library? This will not delete the videos from YouTube.`))return;
    const remaining=videos.filter(v=>!idsToDelete.has(v.id));
    try{
      localStorage.setItem(STORAGE_KEY,JSON.stringify({categories,videos:remaining}));
      setVideos(remaining);
      setSelectedVideoIds([]);
      setNotice(`${count} video(s) removed from this browser's library.`);
    }catch{
      setNotice("Could not save the deletion. Your library has not been changed.");
    }
  }
  function deleteVideo(id:string){
    if(!confirm("Remove this video from your library? This will not delete it from YouTube."))return;
    const remaining=videos.filter(v=>v.id!==id);
    try{
      localStorage.setItem(STORAGE_KEY,JSON.stringify({categories,videos:remaining}));
      setVideos(remaining);
      setSelectedVideoIds(current=>current.filter(item=>item!==id));
    }catch{setNotice("Could not save the deletion. Your library has not been changed.");}
  }
  function changeVideoCategory(videoId:string,catId:string){
    const cat=categories.find(c=>c.id===catId);setVideos(p=>p.map(v=>v.id===videoId?{...v,categoryId:catId,subcategoryId:cat?.subcategories[0]?.id||""}:v));
  }

  return <main className="shell">
    <header className="topbar"><div><div className="eyebrow">PERSONAL CONTENT LIBRARY</div><h1>Content organiser</h1><p>Save YouTube videos, articles, social media posts and useful website links in one organised library.</p></div><div className="countPill">{videos.length} saved links</div></header>

    <section className="panel importPanel">
      <div className="sectionTitle"><div><h2>Import links</h2><p>Save YouTube videos, articles, Facebook, Instagram and other website links. Existing links are never overwritten.</p></div></div>
      <div className="importGrid">
        <form onSubmit={submitManual} className="pasteBox">
          <label htmlFor="url-list">Paste links</label>
          <textarea id="url-list" rows={4} value={urlText} onChange={e=>setUrlText(e.target.value)} placeholder={"One URL per line\nhttps://www.youtube.com/watch?v=...\nhttps://www.instagram.com/p/...\nhttps://example.com/article"} />
          <button disabled={loading} type="submit">{loading?"Importing…":"Import pasted links"}</button>
        </form>
        <div className="csvBox">
          <label>Upload CSV file</label>
          <div className="uploadDrop"><div className="uploadIcon">⇧</div><strong>{selectedFile?selectedFile.name:"Choose a CSV file"}</strong><span>CSV columns: URL, Category, Subcategory (all website links accepted)</span>
            <button type="button" className="outline" disabled={loading} onClick={()=>fileRef.current?.click()}>Browse CSV</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={handleFile}/>
          </div>
          <button type="button" className="textButton" onClick={downloadTemplate}>Download CSV template</button>
        </div>
      </div>
      {notice&&<div className="notice" role="status">{notice}</div>}
      {importResults.length>0&&<div className="importReport">
        <div className="importReportHead">
          <div><strong>Import results</strong><span>{importProgress.done} / {importProgress.total} processed</span></div>
          <button type="button" className="outline" onClick={exportImportResults}>Download results CSV</button>
        </div>
        <div className="progressTrack"><div className="progressFill" style={{width:`${importProgress.total?importProgress.done/importProgress.total*100:0}%`}}/></div>
        <div className="resultList">
          {importResults.map((r,i)=><div className="resultRow" key={`${i}-${r.url}`}>
            <span className={`resultStatus ${r.status==="ADDED"?"isAdded":r.status==="SKIPPED – DUPLICATE"?"isDuplicate":r.status==="SKIPPED – INVALID URL"?"isInvalid":"isFailed"}`}>{r.status}</span>
            <div className="resultDetails"><strong>{r.videoTitle||r.url}</strong><span>{r.reason}</span></div>
          </div>)}
        </div>
      </div>}
      <p className="smallNote">Tip: If Category and Subcategory columns are included, new categories/subcategories are created automatically when needed. If omitted, the currently selected category is used for pasted links.</p>
    </section>

    <div className="workspace">
      <aside className="panel sidebar">
        <div className="sectionTitle"><div><h2>Organise</h2><p>Manage your library structure</p></div></div>
        <label htmlFor="active-category">Current category</label>
        <select id="active-category" value={categoryId} onChange={e=>chooseCategory(e.target.value)}>
          {categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div className="subCategoryManager">
          <div className="subCategoryHeading"><label>Subcategories in {currentCategory?.name}</label><span>{subOptions.length}</span></div>
          <div className="subCategoryTiles" role="group" aria-label={`${currentCategory?.name} subcategories`}>
            <button type="button" className={`subCategoryTile ${!subcategoryId?"active":""}`} onClick={()=>chooseSubcategory("")}>All content</button>
            {subOptions.map(sub=><button type="button" key={sub.id} className={`subCategoryTile ${subcategoryId===sub.id?"active":""}`} onClick={()=>chooseSubcategory(sub.id)}>{sub.name}<small>{videos.filter(v=>v.categoryId===currentCategory.id&&v.subcategoryId===sub.id).length}</small></button>)}
          </div>
          {editingSubcategoryId&&<div className="editSubcategory"><input aria-label="Edit subcategory name" value={editingSubcategoryName} onChange={e=>setEditingSubcategoryName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveSubcategoryEdit();if(e.key==="Escape")setEditingSubcategoryId(null);}}/><button type="button" onClick={saveSubcategoryEdit}>Save</button><button type="button" className="cancelEdit" onClick={()=>setEditingSubcategoryId(null)}>Cancel</button></div>}
          <div className="subcategoryEditList">{subOptions.map(sub=><div className="subcategoryEditRow" key={sub.id}><span>{sub.name}</span><button type="button" className="miniAction" onClick={()=>beginEditSubcategory(sub)} aria-label={`Rename ${sub.name}`}>Edit</button><button type="button" className="miniDanger" onClick={()=>removeSubcategory(sub.id)} aria-label={`Delete ${sub.name}`}>Delete</button></div>)}</div>
        </div>
        <div className="addGroup"><label htmlFor="new-cat">Add category</label><div className="inlineAdd"><input id="new-cat" value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="e.g. Gardening"/><button onClick={addCategory} type="button">Add</button></div></div>
        <div className="addGroup"><label htmlFor="new-sub">Add subcategory</label><div className="inlineAdd"><input id="new-sub" value={newSubcategory} onChange={e=>setNewSubcategory(e.target.value)} placeholder="e.g. Indoor plants"/><button onClick={addSubcategory} type="button" disabled={!currentCategory}>Add</button></div></div>
        <div className="categoryList"><strong>Categories</strong>{categories.map(c=><div className="categoryRow" key={c.id}><span>{c.name}</span><span className="muted">{videos.filter(v=>v.categoryId===c.id).length}</span></div>)}</div>
      </aside>

      <section className="library">
        <div className="libraryHead"><div><h2>Your saved content</h2><p>Search, filter and organise videos, articles and other links.</p></div><button className="outline" onClick={exportCsv} disabled={!videos.length}>Export library CSV</button></div>
        <div className="filters">
          <input aria-label="Search saved content" placeholder="Search titles, websites, platforms or URLs…" value={search} onChange={e=>setSearch(e.target.value)}/>
          <select aria-label="Filter category" value={filterCategory} onChange={e=>{setFilterCategory(e.target.value);setFilterSubcategory("all");}}>
            <option value="all">All categories</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

        </div>
        {filterCategory!=="all"&&<div className="librarySubcategoryStrip"><span className="stripLabel">{categories.find(c=>c.id===filterCategory)?.name||"Category"}</span><div className="stripTiles"><button type="button" className={`stripTile ${filterSubcategory==="all"?"active":""}`} onClick={()=>setFilterSubcategory("all")}>All</button>{(categories.find(c=>c.id===filterCategory)?.subcategories||[]).map(sub=><button type="button" key={sub.id} className={`stripTile ${filterSubcategory===sub.id?"active":""}`} onClick={()=>setFilterSubcategory(sub.id)}>{sub.name}</button>)}</div></div>}
        {process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID && process.env.NEXT_PUBLIC_ADSENSE_LIBRARY_SLOT_ID && (
          <AdSenseUnit
            clientId={process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID}
            slotId={process.env.NEXT_PUBLIC_ADSENSE_LIBRARY_SLOT_ID}
          />
        )}
        <div className="bulkActions">
          <div className="bulkSelectionInfo">
            <strong>{selectedVideoIds.length} selected</strong>
            <button type="button" className="textButton" onClick={toggleVisibleSelection} disabled={!filtered.length}>
              {filtered.length>0&&filtered.every(v=>selectedVideoIds.includes(v.id))?"Deselect visible":"Select visible"}
            </button>
            <button type="button" className="textButton" onClick={clearVideoSelection} disabled={!selectedVideoIds.length}>Clear selection</button>
          </div>
          <button type="button" className="bulkDeleteButton" onClick={deleteSelectedVideos} disabled={!selectedVideoIds.length}>
            Delete selected{selectedVideoIds.length?` (${selectedVideoIds.length})`:""}
          </button>
        </div>
        {filtered.length===0?<div className="empty"><div className="emptyIcon">▧</div><h3>No videos to show</h3><p>Import YouTube videos, articles or website links above to start building your library.</p></div>:
          <div className="videoGrid" ref={gridRef} onPointerDown={handleGridPointerDown} onPointerMove={handleGridPointerMove} onPointerUp={handleGridPointerUp} onPointerCancel={handleGridPointerUp} onClickCapture={handleGridClickCapture}>
            {dragSelection&&<div className="selectionMarquee" style={{left:dragSelection.left,top:dragSelection.top,width:dragSelection.width,height:dragSelection.height}}/>}
            {filtered.map(v=>{
            const cat=categories.find(c=>c.id===v.categoryId);const sub=cat?.subcategories.find(s=>s.id===v.subcategoryId);
            return <article className={`videoCard ${selectedVideoIds.includes(v.id)?"isSelected":""}`} data-video-id={v.id} key={v.id}>
              <a className={`thumb ${v.thumbnail?"":"thumbPlaceholder"}`} href={v.url} target="_blank" rel="noreferrer">
                {v.thumbnail?<img src={v.thumbnail} alt={v.title}/>:<div className="linkPreview"><strong>{v.platform||"Website"}</strong><span>{v.contentType||"Saved link"}</span><small>{v.url}</small></div>}
                {v.duration!=null&&<span>{durationLabel(v.duration)}</span>}
              </a>
              <div className="videoBody">
                <label className="videoSelectLabel">
                  <input type="checkbox" checked={selectedVideoIds.includes(v.id)} onChange={e=>toggleVideoSelection(v.id,e.target.checked)} aria-label={`Select ${v.title}`}/>
                  Select item
                </label>
                <h3><a href={v.url} target="_blank" rel="noreferrer">{v.title}</a></h3><p className="channel">{v.channel||"Unknown channel"}</p><div className="tags"><span>{cat?.name||"Uncategorised"}</span>{sub&&<span>{sub.name}</span>}</div>
                <label className="moveLabel">Move to category</label><select value={v.categoryId} onChange={e=>changeVideoCategory(v.id,e.target.value)}>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <div className="cardFoot"><small>{v.contentType||"Saved link"} · {v.platform||"Website"}</small><button className="removeButton" onClick={()=>deleteVideo(v.id)} title="Remove from library">Remove</button></div>
              </div>
            </article>;
          })}</div>
        }
      </section>
    </div>
    <footer>Library data is stored in this browser on this device. Back up regularly by exporting the content library CSV.</footer>
  </main>;
}
