/** Native apps do not return a success result. Only offer the fallback if the
 * page remains visible; leaving the page cancels it, including after returning. */
export function watchAppLaunch(onUnavailable:()=>void,page:Document=document,browser:Window=window,delay=2200):()=>void {
  let active=true;
  const cancel=()=>{
    if(!active)return;
    active=false;browser.clearTimeout(timer);
    page.removeEventListener("visibilitychange",onVisibility);
    browser.removeEventListener("pagehide",cancel);
  };
  const onVisibility=()=>{if(page.hidden)cancel();};
  const timer=browser.setTimeout(()=>{
    if(!active)return;
    const remainedVisible=!page.hidden;cancel();
    if(remainedVisible)onUnavailable();
  },delay);
  page.addEventListener("visibilitychange",onVisibility);
  browser.addEventListener("pagehide",cancel);
  return cancel;
}
