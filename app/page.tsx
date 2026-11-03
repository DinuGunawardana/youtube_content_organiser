 "use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Category = { id: string; name: string; subcategories: {id: string; name: string}[] };
type Video = {
  id: string; title: string; thumbnail: string; url: string; channel?: string;
  duration?: number | null; uploadDate?: string; categoryId: string; subcategoryId: string;
  addedAt: string;
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
  const urlIndex=headers.findIndex(x=>["url","youtube url","video url","link"].includes(x));
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
    if(["youtube.com","m.youtube.com","youtube-nocookie.com"].includes(host)){
      if(u.searchParams.get("v")) return u.searchParams.get("v");
      const p=u.pathname.split("/").filter(Boolean);
      if(["embed","shorts","live"].includes(p[0])) return p[1]||null;
    }
  }catch{}
  return null;
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
    return catOk&&subOk&&(!q||`${v.title} ${v.channel||""} ${v.id}`.toLowerCase().includes(q));
  }),[videos,filterCategory,filterSubcategory,search]);
  const subOptions=currentCategory?.subcategories||[];

  function chooseCategory(id:string){setCategoryId(id);const c=categories.find(x=>x.id===id);setSubcategoryId(c?.subcategories[0]?.id||"");}
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
    if(rows.length>100){setNotice("Import up to 100 URLs at a time.");return;}

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

        const videoId=canonicalVideoId(url);
        if(!videoId){
          addLog({url,category:requestedCategory,subcategory:requestedSubcategory,status:"SKIPPED – INVALID URL",reason:"Not a supported HTTPS YouTube URL.",videoTitle:"",processedAt:new Date().toISOString()});
          continue;
        }
        if(knownIds.has(videoId)){
          addLog({url,category:requestedCategory,subcategory:requestedSubcategory,status:"SKIPPED – DUPLICATE",reason:"This video is already in your library.",videoTitle:"",processedAt:new Date().toISOString()});
          continue;
        }
        if(seenInFile.has(videoId)){
          addLog({url,category:requestedCategory,subcategory:requestedSubcategory,status:"SKIPPED – DUPLICATE",reason:"This video appeared earlier in the same import file.",videoTitle:"",processedAt:new Date().toISOString()});
          continue;
        }
        seenInFile.add(videoId);

        setNotice(`Processing ${index+1} of ${rows.length}: ${url}`);
        try{
          const response=await fetch("/api/extract",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({urls:[url]})
          });
          let data:any;
          try{data=await response.json();}catch{data=null;}
          if(!response.ok) throw new Error(data?.error || `Server returned HTTP ${response.status}.`);
          const result:ExtractResult|undefined=data?.results?.[0];
          if(!result?.video) throw new Error(result?.error || "No video metadata was returned.");

          const id=result.video.id;
          if(knownIds.has(id)){
            addLog({url,category:requestedCategory,subcategory:requestedSubcategory,status:"SKIPPED – DUPLICATE",reason:"The extracted video ID is already in your library.",videoTitle:result.video.title||"",processedAt:new Date().toISOString()});
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
            ...result.video,
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
          addLog({url,category:cat.name,subcategory:sub?.name||"",status:"ADDED",reason:"Video metadata extracted and saved to this browser's library.",videoTitle:newVideo.title,processedAt:new Date().toISOString()});
        }catch(error){
          addLog({url,category:requestedCategory,subcategory:requestedSubcategory,status:"SKIPPED – EXTRACTION FAILED",reason:error instanceof Error?error.message:"Extraction failed.",videoTitle:"",processedAt:new Date().toISOString()});
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
    const csv="URL,Category,Subcategory\nhttps://www.youtube.com/watch?v=VIDEO_ID,Food,Recipes\nhttps://youtu.be/VIDEO_ID,DIY,Home Projects\n";
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="youtube-import-template.csv";a.click();URL.revokeObjectURL(a.href);
  }
  function exportCsv(){
    const rows=[["Video ID","Title","Channel","Thumbnail URL","Video URL","Category","Subcategory","Duration seconds","Upload date"],
      ...videos.map(v=>[v.id,v.title,v.channel||"",v.thumbnail,v.url,categories.find(c=>c.id===v.categoryId)?.name||"",categories.find(c=>c.id===v.categoryId)?.subcategories.find(s=>s.id===v.subcategoryId)?.name||"",v.duration??"",v.uploadDate||""])];
    const csv=rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(",")).join("\r\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="youtube-library.csv";a.click();URL.revokeObjectURL(a.href);
  }
  function exportImportResults(){
    const rows=[
      ["URL","Category","Subcategory","Status","Reason","Video Title","Processed At"],
      ...importResults.map(r=>[r.url,r.category,r.subcategory,r.status,r.reason,r.videoTitle,r.processedAt])
    ];
    const csv=rows.map(r=>r.map(x=>`"${String(x??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="youtube-import-results.csv";a.click();URL.revokeObjectURL(a.href);
  }
  function deleteVideo(id:string){if(!confirm("Remove this video from your library?"))return;setVideos(p=>p.filter(v=>v.id!==id));}
  function changeVideoCategory(videoId:string,catId:string){
    const cat=categories.find(c=>c.id===catId);setVideos(p=>p.map(v=>v.id===videoId?{...v,categoryId:catId,subcategoryId:cat?.subcategories[0]?.id||""}:v));
  }

  return <main className="shell">
    <header className="topbar"><div><div className="eyebrow">PERSONAL VIDEO LIBRARY</div><h1>YouTube content organiser</h1><p>Collect videos, sort them into categories and subcategories, and keep duplicates out.</p></div><div className="countPill">{videos.length} saved videos</div></header>

    <section className="panel importPanel">
      <div className="sectionTitle"><div><h2>Import videos</h2><p>Paste links or upload a CSV. Existing videos are never overwritten.</p></div></div>
      <div className="importGrid">
        <form onSubmit={submitManual} className="pasteBox">
          <label htmlFor="url-list">Paste YouTube links</label>
          <textarea id="url-list" rows={4} value={urlText} onChange={e=>setUrlText(e.target.value)} placeholder={"One URL per line\nhttps://www.youtube.com/watch?v=..."} />
          <button disabled={loading} type="submit">{loading?"Importing…":"Import pasted links"}</button>
        </form>
        <div className="csvBox">
          <label>Upload CSV file</label>
          <div className="uploadDrop"><div className="uploadIcon">⇧</div><strong>{selectedFile?selectedFile.name:"Choose a CSV file"}</strong><span>CSV columns: URL, Category, Subcategory</span>
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
        <label htmlFor="active-subcategory">Subcategory</label>
        <select id="active-subcategory" value={subcategoryId} onChange={e=>setSubcategoryId(e.target.value)}>
          <option value="">No subcategory</option>{subOptions.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="addGroup"><label htmlFor="new-cat">Add category</label><div className="inlineAdd"><input id="new-cat" value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="e.g. Gardening"/><button onClick={addCategory} type="button">Add</button></div></div>
        <div className="addGroup"><label htmlFor="new-sub">Add subcategory</label><div className="inlineAdd"><input id="new-sub" value={newSubcategory} onChange={e=>setNewSubcategory(e.target.value)} placeholder="e.g. Indoor plants"/><button onClick={addSubcategory} type="button" disabled={!currentCategory}>Add</button></div></div>
        <div className="categoryList"><strong>Categories</strong>{categories.map(c=><div className="categoryRow" key={c.id}><span>{c.name}</span><span className="muted">{videos.filter(v=>v.categoryId===c.id).length}</span></div>)}</div>
      </aside>

      <section className="library">
        <div className="libraryHead"><div><h2>Your videos</h2><p>Search, filter and organise extracted videos.</p></div><button className="outline" onClick={exportCsv} disabled={!videos.length}>Export library CSV</button></div>
        <div className="filters">
          <input aria-label="Search videos" placeholder="Search titles, channels or IDs…" value={search} onChange={e=>setSearch(e.target.value)}/>
          <select aria-label="Filter category" value={filterCategory} onChange={e=>{setFilterCategory(e.target.value);setFilterSubcategory("all");}}>
            <option value="all">All categories</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Filter subcategory" value={filterSubcategory} onChange={e=>setFilterSubcategory(e.target.value)}>
            <option value="all">All subcategories</option>{categories.filter(c=>filterCategory==="all"||c.id===filterCategory).flatMap(c=>c.subcategories.map(s=><option key={`${c.id}-${s.id}`} value={s.id}>{c.name} / {s.name}</option>))}
          </select>
        </div>
        {filtered.length===0?<div className="empty"><div className="emptyIcon">▧</div><h3>No videos to show</h3><p>Import YouTube links above to start building your library.</p></div>:
          <div className="videoGrid">{filtered.map(v=>{
            const cat=categories.find(c=>c.id===v.categoryId);const sub=cat?.subcategories.find(s=>s.id===v.subcategoryId);
            return <article className="videoCard" key={v.id}>
              <a className="thumb" href={v.url} target="_blank" rel="noreferrer"><img src={v.thumbnail} alt={v.title}/>{v.duration!=null&&<span>{durationLabel(v.duration)}</span>}</a>
              <div className="videoBody"><h3><a href={v.url} target="_blank" rel="noreferrer">{v.title}</a></h3><p className="channel">{v.channel||"Unknown channel"}</p><div className="tags"><span>{cat?.name||"Uncategorised"}</span>{sub&&<span>{sub.name}</span>}</div>
                <label className="moveLabel">Move to category</label><select value={v.categoryId} onChange={e=>changeVideoCategory(v.id,e.target.value)}>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <div className="cardFoot"><small>Video ID: {v.id}</small><button className="removeButton" onClick={()=>deleteVideo(v.id)} title="Remove from library">Remove</button></div>
              </div>
            </article>;
          })}</div>
        }
      </section>
    </div>
    <footer>Library data is stored in this browser on this device. Back up regularly by exporting the library CSV.</footer>
  </main>;
}
