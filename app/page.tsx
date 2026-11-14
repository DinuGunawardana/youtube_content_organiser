 "use client";

import { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";
import AdSenseUnit from "./AdSenseUnit";
import { supabase } from "../lib/supabase";
import type { User } from "@supabase/supabase-js";

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

const ADSENSE_CLIENT_ID =
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID || "ca-pub-2741821782196575";

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

function ContentLibrary({ user }: { user: User }){
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

  const revisionRef=useRef(0);
  const dirtyRef=useRef(false);
  const savingRef=useRef(false);
  const skipNextSaveRef=useRef(false);
  const saveTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [syncStatus,setSyncStatus]=useState("Connecting to cloud…");
  const [needsNewLibrary,setNeedsNewLibrary]=useState(false);
  const [conflict,setConflict]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [theme,setTheme]=useState<"light"|"dark">(user.user_metadata?.content_organiser_theme==="dark"?"dark":"light");
  const [editingCategoryId,setEditingCategoryId]=useState<string|null>(null);
  const [editingCategoryName,setEditingCategoryName]=useState("");
  const [editingSettingSubId,setEditingSettingSubId]=useState<string|null>(null);
  const [editingSettingSubName,setEditingSettingSubName]=useState("");
  const [newSettingSubcategory,setNewSettingSubcategory]=useState<Record<string,string>>({});
  const [newSettingCategory,setNewSettingCategory]=useState("");

  useEffect(()=>{
    let active=true;
    async function loadCloudLibrary(){
      if(!supabase){setSyncStatus("Cloud connection is not configured.");return;}
      setSyncStatus("Loading your cloud library…");
      const {data:cloud,error}=await supabase.from("content_organiser_library")
        .select("categories,videos,import_logs,revision")
        .eq("user_id",user.id).maybeSingle();
      if(!active)return;
      if(error){setSyncStatus(`Cloud load failed: ${error.message}`);return;}
      if(cloud){
        skipNextSaveRef.current=true;
        setCategories(Array.isArray(cloud.categories)&&cloud.categories.length?cloud.categories:DEFAULT_CATEGORIES);
        setVideos(Array.isArray(cloud.videos)?cloud.videos:[]);
        const logs=Array.isArray(cloud.import_logs)?cloud.import_logs:[];
        setImportResults(logs);setImportProgress({done:logs.length,total:logs.length});
        revisionRef.current=cloud.revision||1;
        try{localStorage.setItem(STORAGE_KEY,JSON.stringify({categories:cloud.categories,videos:cloud.videos}));localStorage.setItem(IMPORT_LOG_KEY,JSON.stringify(logs));}catch{}
        setSyncStatus("Cloud library loaded");setHydrated(true);return;
      }
      // First authenticated device migrates the original browser's local data.
      let localData:any=null;let localLogs:any=[];
      try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)localData=JSON.parse(raw);}catch{}
      try{const raw=localStorage.getItem(IMPORT_LOG_KEY);if(raw){const parsed=JSON.parse(raw);if(Array.isArray(parsed))localLogs=parsed;}}catch{}
      if(localData&&(Array.isArray(localData.categories)||Array.isArray(localData.videos))){
        const migratedCategories=Array.isArray(localData.categories)&&localData.categories.length?localData.categories:DEFAULT_CATEGORIES;
        const migratedVideos=Array.isArray(localData.videos)?localData.videos:[];
        const {data,error:saveError}=await supabase.rpc("save_content_organiser_library",{
          p_categories:migratedCategories,p_videos:migratedVideos,p_import_logs:localLogs,p_expected_revision:0
        });
        if(!active)return;
        if(saveError){setSyncStatus(`Migration failed: ${saveError.message}`);return;}
        const saved=Array.isArray(data)?data[0]:data;
        revisionRef.current=saved?.revision||1;
        skipNextSaveRef.current=true;
        setCategories(migratedCategories);setVideos(migratedVideos);setImportResults(localLogs);
        setImportProgress({done:localLogs.length,total:localLogs.length});
        setSyncStatus(`Migrated ${migratedVideos.length} item(s) from this browser`);setHydrated(true);return;
      }
      setCategories(DEFAULT_CATEGORIES);setVideos([]);setImportResults([]);
      setNeedsNewLibrary(true);setSyncStatus("No cloud library exists yet");setHydrated(true);
    }
    loadCloudLibrary();
    return ()=>{active=false;};
  },[user.id]);

  useEffect(()=>{
    if(!hydrated||needsNewLibrary||!supabase)return;
    if(skipNextSaveRef.current){skipNextSaveRef.current=false;return;}
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({categories,videos}));localStorage.setItem(IMPORT_LOG_KEY,JSON.stringify(importResults));}catch{}
    dirtyRef.current=true;
    if(saveTimerRef.current)clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(async()=>{
      if(!supabase)return;
      setSyncStatus("Saving…");
      const expected=revisionRef.current;
      savingRef.current=true;
      const {data,error}=await supabase.rpc("save_content_organiser_library",{
        p_categories:categories,p_videos:videos,p_import_logs:importResults,p_expected_revision:expected
      });
      savingRef.current=false;
      if(error){
        if(error.message.includes("REVISION_CONFLICT")){setConflict(true);setSyncStatus("A newer version exists on another device. Resolve the sync conflict before continuing.");}
        else setSyncStatus(`Save failed: ${error.message}`);
        return;
      }
      const saved=Array.isArray(data)?data[0]:data;
      revisionRef.current=saved?.revision||expected+1;dirtyRef.current=false;
      setSyncStatus("All changes saved");
    },700);
    return ()=>{if(saveTimerRef.current)clearTimeout(saveTimerRef.current);};
  },[categories,videos,importResults,hydrated,needsNewLibrary]);

  useEffect(()=>{
    if(!supabase||!hydrated||needsNewLibrary)return;
    const supabaseClient=supabase;
    const channel=supabaseClient.channel(`content-organiser-${user.id}`)
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"content_organiser_library",filter:`user_id=eq.${user.id}`},(payload:any)=>{
        const remote:any=payload.new;
        if(!remote||remote.revision<=revisionRef.current||savingRef.current)return;
        if(dirtyRef.current){setConflict(true);setSyncStatus("Another device changed this library. Your unsaved edits are protected; reload the cloud version to continue.");return;}
        revisionRef.current=remote.revision;
        skipNextSaveRef.current=true;
        setCategories(Array.isArray(remote.categories)&&remote.categories.length?remote.categories:DEFAULT_CATEGORIES);
        setVideos(Array.isArray(remote.videos)?remote.videos:[]);
        const logs=Array.isArray(remote.import_logs)?remote.import_logs:[];
        setImportResults(logs);setImportProgress({done:logs.length,total:logs.length});
        setSyncStatus("Updated from another device");
      }).subscribe();
    return ()=>{supabaseClient.removeChannel(channel);};
  },[user.id,hydrated,needsNewLibrary]);

  async function createNewCloudLibrary(){
    if(!supabase)return;
    const {data,error}=await supabase.rpc("save_content_organiser_library",{
      p_categories:DEFAULT_CATEGORIES,p_videos:[],p_import_logs:[],p_expected_revision:0
    });
    if(error){setNotice(`Could not create cloud library: ${error.message}`);return;}
    const saved=Array.isArray(data)?data[0]:data;revisionRef.current=saved?.revision||1;
    skipNextSaveRef.current=true;
    setCategories(DEFAULT_CATEGORIES);setVideos([]);setImportResults([]);setNeedsNewLibrary(false);setSyncStatus("Cloud library created");
  }
  async function reloadCloudVersion(){
    if(!supabase)return;
    const {data,error}=await supabase.from("content_organiser_library").select("categories,videos,import_logs,revision").eq("user_id",user.id).single();
    if(error){setNotice(`Could not reload cloud version: ${error.message}`);return;}
    revisionRef.current=data.revision;dirtyRef.current=false;setConflict(false);skipNextSaveRef.current=true;
    setCategories(data.categories||DEFAULT_CATEGORIES);setVideos(data.videos||[]);setImportResults(data.import_logs||[]);
    setSyncStatus("Cloud version loaded");
  }

  async function changeTheme(next:"light"|"dark"){
    if(!supabase)return;
    const previous=theme;
    setTheme(next);
    const {error}=await supabase.auth.updateUser({data:{content_organiser_theme:next}});
    if(error){setTheme(previous);setNotice(`Could not save theme preference: ${error.message}`);}
  }
  function saveCategoryEdit(){
    if(!editingCategoryId)return;
    const name=editingCategoryName.trim();
    if(!name){setNotice("Category name cannot be empty.");return;}
    if(categories.some(c=>c.id!==editingCategoryId&&c.name.toLowerCase()===name.toLowerCase())){setNotice("That category already exists.");return;}
    setCategories(prev=>prev.map(c=>c.id===editingCategoryId?{...c,name}:c));
    setEditingCategoryId(null);setEditingCategoryName("");setNotice(`Category renamed to “${name}”.`);
  }
  function removeCategory(id:string){
    const target=categories.find(c=>c.id===id);if(!target)return;
    if(categories.length===1){setNotice("You must keep at least one category.");return;}
    const remaining=categories.filter(c=>c.id!==id);
    const replacement=remaining[0];
    const count=videos.filter(v=>v.categoryId===id).length;
    if(!confirm(`Delete category “${target.name}”? ${count} saved item(s) will be moved to “${replacement.name}”.`))return;
    setCategories(remaining);
    setVideos(prev=>prev.map(v=>v.categoryId===id?{...v,categoryId:replacement.id,subcategoryId:""}:v));
    if(categoryId===id){setCategoryId(replacement.id);setSubcategoryId("");}
    if(filterCategory===id){setFilterCategory("all");setFilterSubcategory("all");}
    setNotice(`Category “${target.name}” deleted. Its saved content was kept under “${replacement.name}”.`);
  }
  function addSettingCategory(){
    const name=newSettingCategory.trim();if(!name)return;
    if(categories.some(c=>c.name.toLowerCase()===name.toLowerCase())){setNotice("That category already exists.");return;}
    const item={id:slug(name),name,subcategories:[]};
    setCategories(prev=>[...prev,item]);setCategoryId(item.id);setSubcategoryId("");setNewSettingCategory("");
    setNotice(`Category “${name}” created.`);
  }
  function addSettingSubcategory(category:string){
    const name=(newSettingSubcategory[category]||"").trim();if(!name)return;
    const target=categories.find(c=>c.id===category);if(!target)return;
    if(target.subcategories.some(x=>x.name.toLowerCase()===name.toLowerCase())){setNotice("That subcategory already exists in this category.");return;}
    const item={id:slug(`${category}-${name}`),name};
    setCategories(prev=>prev.map(c=>c.id===category?{...c,subcategories:[...c.subcategories,item]}:c));
    setNewSettingSubcategory(prev=>({...prev,[category]:""}));
    setNotice(`Subcategory “${name}” added to ${target.name}.`);
  }
  function saveSettingSubcategory(category:string){
    if(!editingSettingSubId)return;
    const name=editingSettingSubName.trim();const target=categories.find(c=>c.id===category);
    if(!target||!name){setNotice("Subcategory name cannot be empty.");return;}
    if(target.subcategories.some(x=>x.id!==editingSettingSubId&&x.name.toLowerCase()===name.toLowerCase())){setNotice("That subcategory already exists in this category.");return;}
    setCategories(prev=>prev.map(c=>c.id===category?{...c,subcategories:c.subcategories.map(x=>x.id===editingSettingSubId?{...x,name}:x)}:c));
    setEditingSettingSubId(null);setEditingSettingSubName("");setNotice(`Subcategory renamed to “${name}”.`);
  }
  function deleteSettingSubcategory(category:string,subId:string){
    const target=categories.find(c=>c.id===category);const sub=target?.subcategories.find(x=>x.id===subId);if(!target||!sub)return;
    const count=videos.filter(v=>v.categoryId===category&&v.subcategoryId===subId).length;
    if(!confirm(`Delete subcategory “${sub.name}”? ${count} saved item(s) will remain in “${target.name}” without a subcategory.`))return;
    setCategories(prev=>prev.map(c=>c.id===category?{...c,subcategories:c.subcategories.filter(x=>x.id!==subId)}:c));
    setVideos(prev=>prev.map(v=>v.categoryId===category&&v.subcategoryId===subId?{...v,subcategoryId:""}:v));
    if(filterSubcategory===subId)setFilterSubcategory("all");
    if(subcategoryId===subId)setSubcategoryId("");
  }
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
    if(target.closest("a,button,input,select,textarea"))return;
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
    setVideos(p=>p.map(v=>v.id===videoId?{...v,categoryId:catId,subcategoryId:""}:v));
  }
  function changeVideoSubcategory(videoId:string,subId:string){
    setVideos(p=>p.map(v=>v.id===videoId?{...v,subcategoryId:subId}:v));
  }

  if(needsNewLibrary)return <main className="shell"><section className="panel" style={{maxWidth:560,margin:"12vh auto",padding:28}}><div className="eyebrow">CLOUD LIBRARY SETUP</div><h1>Welcome to Content Organiser</h1><p>No existing browser library or cloud library was found for this account. If your saved content is on another device, sign in there first to migrate it. Otherwise, create a new cloud library.</p><button className="primary" onClick={createNewCloudLibrary}>Create new cloud library</button><p className="muted" style={{marginTop:14}}>Your library will be private to this account.</p></section></main>;

  return <main className="shell">
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",padding:"8px 0",fontSize:12}}><span aria-live="polite">☁ {syncStatus}{conflict?" · Unsaved changes are protected.":""}</span><span>{user.email||"Signed in"} · <button className="textButton" onClick={()=>setSettingsOpen(true)}>Settings</button> · <button className="textButton" onClick={()=>changeTheme(theme==="light"?"dark":"light")}>{theme==="light"?"Dark theme":"Light theme"}</button> · <button className="textButton" onClick={async()=>{await supabase?.auth.signOut();}}>Sign out</button>{conflict&&<> · <button className="textButton" onClick={reloadCloudVersion}>Load cloud version</button></>}</span></div>
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
          <button type="button" className="outline settingsManageButton" onClick={()=>setSettingsOpen(true)}>Manage categories & subcategories</button>
        </div>
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
        {process.env.NEXT_PUBLIC_ADSENSE_LIBRARY_SLOT_ID && (
          <AdSenseUnit
            clientId={ADSENSE_CLIENT_ID}
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
                <label className="moveLabel subcategoryMoveLabel">Move to subcategory</label><select value={v.subcategoryId||""} onChange={e=>changeVideoSubcategory(v.id,e.target.value)}><option value="">No subcategory</option>{(cat?.subcategories||[]).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <div className="cardFoot"><small>{v.contentType||"Saved link"} · {v.platform||"Website"}</small><button className="removeButton" onClick={()=>deleteVideo(v.id)} title="Remove from library">Remove</button></div>
              </div>
            </article>;
          })}</div>
        }
      </section>
    </div>
    {settingsOpen&&<div className="settingsBackdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSettingsOpen(false);}}>
      <section className="settingsModal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <div className="settingsHeader"><div><span className="eyebrow">PERSONAL PREFERENCES</span><h2 id="settingsTitle">Settings</h2><p>Changes here apply only to your signed-in account.</p></div><button type="button" className="settingsClose" onClick={()=>setSettingsOpen(false)} aria-label="Close settings">×</button></div>
        <div className="settingsThemeRow"><div><strong>Appearance</strong><span>Choose how your library looks on your devices.</span></div><div className="themeSwitch"><button type="button" className={theme==="light"?"selected":""} onClick={()=>changeTheme("light")}>☀ Light</button><button type="button" className={theme==="dark"?"selected":""} onClick={()=>changeTheme("dark")}>☾ Dark</button></div></div>
        <div className="settingsSectionHead"><div><h3>Categories & subcategories</h3><p>Add, rename or remove the structure used in your personal library.</p></div><div className="settingsAddCategory"><input aria-label="New category name" placeholder="New category name" value={newSettingCategory} onChange={e=>setNewSettingCategory(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addSettingCategory();}}/><button type="button" onClick={addSettingCategory}>Add</button></div></div>
        <div className="settingsCategoryList">{categories.map(c=><div className="settingsCategory" key={c.id}>
          <div className="settingsCategoryTop">{editingCategoryId===c.id?<div className="settingsEditInline"><input value={editingCategoryName} autoFocus onChange={e=>setEditingCategoryName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveCategoryEdit();if(e.key==="Escape")setEditingCategoryId(null);}}/><button type="button" onClick={saveCategoryEdit}>Save</button><button type="button" className="settingsCancel" onClick={()=>setEditingCategoryId(null)}>Cancel</button></div>:<><strong>{c.name}</strong><span className="muted">{videos.filter(v=>v.categoryId===c.id).length} items</span><button type="button" className="settingsTextAction" onClick={()=>{setEditingCategoryId(c.id);setEditingCategoryName(c.name);}}>Rename</button><button type="button" className="settingsDeleteAction" onClick={()=>removeCategory(c.id)}>Delete</button></>}</div>
          <div className="settingsSubList">{c.subcategories.map(sub=><div className="settingsSubRow" key={sub.id}>{editingSettingSubId===sub.id?<div className="settingsEditInline"><input value={editingSettingSubName} autoFocus onChange={e=>setEditingSettingSubName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")saveSettingSubcategory(c.id);if(e.key==="Escape")setEditingSettingSubId(null);}}/><button type="button" onClick={()=>saveSettingSubcategory(c.id)}>Save</button><button type="button" className="settingsCancel" onClick={()=>setEditingSettingSubId(null)}>Cancel</button></div>:<><span>{sub.name}</span><small>{videos.filter(v=>v.categoryId===c.id&&v.subcategoryId===sub.id).length} items</small><button type="button" className="settingsTextAction" onClick={()=>{setEditingSettingSubId(sub.id);setEditingSettingSubName(sub.name);}}>Edit</button><button type="button" className="settingsDeleteAction" onClick={()=>deleteSettingSubcategory(c.id,sub.id)}>Delete</button></>}</div>)}</div>
          <div className="settingsAddSub"><input aria-label={`New subcategory for ${c.name}`} placeholder="Add a subcategory…" value={newSettingSubcategory[c.id]||""} onChange={e=>setNewSettingSubcategory(prev=>({...prev,[c.id]:e.target.value}))} onKeyDown={e=>{if(e.key==="Enter")addSettingSubcategory(c.id);}}/><button type="button" onClick={()=>addSettingSubcategory(c.id)}>Add</button></div>
        </div>)}</div>
        <div className="settingsFooter"><span>Synced to your account · {user.email}</span><button type="button" className="outline" onClick={()=>setSettingsOpen(false)}>Done</button></div>
      </section>
    </div>}
    <footer>Library data is synced to your personal account. Export a CSV for an additional backup.</footer>
  </main>;
}


function AuthGate(){
  const [user,setUser]=useState<User|null>(null);
  const [checking,setChecking]=useState(true);
  const [mode,setMode]=useState<"signin"|"signup">("signin");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  useEffect(()=>{
    if(!supabase){setMessage("Supabase environment variables are missing. Check your Netlify and .env.local settings.");setChecking(false);return;}
    supabase.auth.getUser().then(({data,error})=>{setUser(data.user);if(error)setMessage(error.message);setChecking(false);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{setUser(session?.user||null);setChecking(false);});
    return ()=>subscription.unsubscribe();
  },[]);
  async function submit(e:FormEvent){
    e.preventDefault();
    if(busy)return;
    setMessage("");
    if(!supabase){
      setMessage("Supabase is not configured in this deployment. Check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart the development server or redeploy Netlify.");
      return;
    }
    const cleanEmail=email.trim();
    if(!cleanEmail||!password){setMessage("Enter your email address and password.");return;}
    if(mode==="signup"&&password.length<6){setMessage("Your password must contain at least 6 characters.");return;}
    setBusy(true);
    try{
      const result=mode==="signin"
        ? await supabase.auth.signInWithPassword({email:cleanEmail,password})
        : await supabase.auth.signUp({email:cleanEmail,password});
      if(result.error){setMessage(result.error.message);return;}
      if(mode==="signup"&&!result.data.session){
        setMessage("Account created. Check your email for the confirmation link. After confirming your email, return here and sign in.");
      }else if(result.data.user){
        setUser(result.data.user);
        setMessage("Authentication successful. Loading your library…");
      }else{
        setMessage("The authentication request completed, but no user session was returned. Check your email confirmation settings and try signing in.");
      }
    }catch(error){
      const detail=error instanceof Error?error.message:"Unknown network or browser error";
      setMessage(`Could not ${mode==="signup"?"create your account":"sign in"}: ${detail}. Check your connection and try again.`);
    }finally{
      setBusy(false);
    }
  }
  if(checking)return <main className="authPage"><section className="authLoading"><span className="authSpinner"/><strong>Connecting to your library</strong><span>Securely checking your session…</span></section></main>;
  if(user)return <ContentLibrary user={user}/>;
  const isSignup=mode==="signup";
  return <main className="authPage">
    <section className="authShell" aria-label="Content Organiser account">
      <aside className="authStory">
        <div className="authBrand">
          <span className="authBrandMark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M8 7.5h10.5A5.5 5.5 0 0 1 24 13v11.5H13.5A5.5 5.5 0 0 1 8 19V7.5Z" stroke="currentColor" strokeWidth="2.2"/><path d="M8 12.5h10.5A5.5 5.5 0 0 1 24 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><path d="M13 16.5h6M13 20h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span>
          <span>Content<span className="authBrandLight">Organiser</span></span>
        </div>
        <div className="authStoryContent">
          <span className="authOverline">YOUR IDEAS, IN ONE PLACE</span>
          <h1>Make room for<br/><em>good discoveries.</em></h1>
          <p>Keep the videos, articles and links worth coming back to - organised in one personal library.</p>
          <div className="authFeatureList">
            <div><span className="authFeatureIcon">↗</span><span><strong>Save anything worth keeping</strong><small>Videos, articles and useful links together.</small></span></div>
            <div><span className="authFeatureIcon">▦</span><span><strong>Organise it your way</strong><small>Build categories that match how you think.</small></span></div>
            <div><span className="authFeatureIcon">⌁</span><span><strong>Pick up on any device</strong><small>Your library stays in sync when you sign in.</small></span></div>
          </div>
        </div>
        <div className="authStoryFoot"><span className="authStatusDot"/> Private by default <span className="authFootDivider">·</span> Synced securely</div>
        <div className="authDecor authDecorOne"/><div className="authDecor authDecorTwo"/>
      </aside>
      <section className="authFormSide">
        <div className="authMobileBrand">
          <span className="authBrandMark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M8 7.5h10.5A5.5 5.5 0 0 1 24 13v11.5H13.5A5.5 5.5 0 0 1 8 19V7.5Z" stroke="currentColor" strokeWidth="2.2"/><path d="M8 12.5h10.5A5.5 5.5 0 0 1 24 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><path d="M13 16.5h6M13 20h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span>
          <span>Content<span className="authBrandLight">Organiser</span></span>
        </div>
        <div className="authFormWrap">
          <div className="authWelcome">
            <span className="authEyebrow">{isSignup?"GET STARTED":"WELCOME BACK"}</span>
            <h2>{isSignup?"Create your account":"Sign in to your library"}</h2>
            <p>{isSignup?"A personal space for everything you want to remember.":"Your saved ideas are right where you left them."}</p>
          </div>
          <div className="authModeSwitch" role="tablist" aria-label="Account access">
            <button type="button" role="tab" aria-selected={!isSignup} className={!isSignup?"active":""} onClick={()=>{setMode("signin");setMessage("");}}>Sign in</button>
            <button type="button" role="tab" aria-selected={isSignup} className={isSignup?"active":""} onClick={()=>{setMode("signup");setMessage("");}}>Create account</button>
          </div>
          <form className="authForm" onSubmit={submit}>
            <label className="authField"><span>Email address</span><div className="authInputWrap"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg><input type="email" autoComplete="email" placeholder="you@example.com" required value={email} onChange={e=>setEmail(e.target.value)}/></div></label>
            <label className="authField"><span>Password</span><div className="authInputWrap"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><input type={showPassword?"text":"password"} autoComplete={isSignup?"new-password":"current-password"} placeholder={isSignup?"At least 6 characters":"Enter your password"} minLength={6} required value={password} onChange={e=>setPassword(e.target.value)}/><button className="authShowPassword" type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?"Hide password":"Show password"}>{showPassword?"Hide":"Show"}</button></div></label>
            {isSignup&&<p className="authPasswordHint">Use at least 6 characters for your password.</p>}
            <button className="authSubmit" type="submit" disabled={busy}>{busy?<><span className="authButtonSpinner"/>{isSignup?"Creating your account…":"Signing you in…"}</>:<>{isSignup?"Create account":"Sign in"} <span aria-hidden="true">→</span></>}</button>
          </form>
          {message&&<div role="status" aria-live="polite" className={`authMessage ${message.startsWith("Account created")||message.startsWith("Authentication successful")?"success":""}`}>{message}</div>}
          <p className="authSwitchPrompt">{isSignup?"Already have an account?":"New to Content Organiser?"} <button type="button" onClick={()=>{setMode(isSignup?"signin":"signup");setMessage("");}}>{isSignup?"Sign in":"Create an account"}</button></p>
          <div className="authSecurityNote"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg><span>Your library is private to your account.</span></div>
        </div>
        <div className="authCopyright">CONTENT ORGANISER <span>·</span> YOUR PERSONAL LIBRARY</div>
      </section>
    </section>
  </main>;
}

export default function Home(){return <AuthGate/>;}
