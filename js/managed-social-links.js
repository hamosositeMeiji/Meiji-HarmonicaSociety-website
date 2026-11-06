/* Keep official social destinations consistent across every public subpage. */
(async function syncManagedSocialLinks(){
  const nav=document.querySelector(".hamoso-social-float");
  if(!nav)return;
  const youtube=nav.querySelector('a[aria-label*="公式YouTube"]');
  const hideYoutube=()=>{
    if(!youtube)return;
    youtube.hidden=true;
    youtube.style.display="none";
  };
  const safeHttps=value=>{
    if(typeof value!=="string"||!value.trim())return "";
    try{const url=new URL(value);return url.protocol==="https:"?url.href:"";}catch(_){return "";}
  };
  const isYoutubeUrl=value=>{
    try{
      const url=new URL(value);
      return url.protocol==="https:"&&(url.hostname==="youtu.be"||url.hostname==="youtube.com"||url.hostname.endsWith(".youtube.com"));
    }catch(_){return false;}
  };
  try{
    const response=await fetch("https://hamoso-admin-auth.hamososaitoguanli.workers.dev/api/public/site-content",{cache:"no-store"});
    if(!response.ok){hideYoutube();return;}
    const result=await response.json();
    const media=result&&result.content&&result.content.media?result.content.media:{};
    const social=media.social&&typeof media.social==="object"?media.social:{};
    const x=nav.querySelector('a[aria-label*="公式X"]');
    const instagram=nav.querySelector('a[aria-label*="公式Instagram"]');
    const xUrl=safeHttps(social.x);
    const instagramUrl=safeHttps(social.instagram);
    if(x&&xUrl)x.href=xUrl;
    if(instagram&&instagramUrl)instagram.href=instagramUrl;
    let firstVideo="";
    if(Array.isArray(media.videos)){
      for(const entry of media.videos){
        if(typeof entry!=="string")continue;
        const line=entry.trim();
        const separator=line.indexOf("|");
        const url=separator>=0?line.slice(separator+1).trim():line;
        if(isYoutubeUrl(url)){firstVideo=safeHttps(url);break;}
      }
    }
    const youtubeTarget=safeHttps(social.youtube)||firstVideo;
    if(youtube&&youtubeTarget){
      youtube.href=youtubeTarget;
      youtube.hidden=false;
      youtube.style.display="";
    }else hideYoutube();
  }catch(_){
    // Keep existing X/Instagram fallback links, but never show a generic YouTube homepage as an official account.
    hideYoutube();
  }
})();
