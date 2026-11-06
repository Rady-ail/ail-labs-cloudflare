/* AIL LABS — "feel" layer (Phase 0): spring easing, metallic sheen tracking, optional haptic tick.
   Progressive enhancement only: CSS has fallbacks, so the site works if this file fails or is removed. */
(function(){
  'use strict';
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* Spring -> CSS linear() easing (stiffness/damping/mass, response 0.5 / zeta 0.8 by default) */
  function spring(o){
    o=o||{};var k=o.stiffness||158,c=o.damping||20,m=o.mass||1,n=o.steps||48;
    var w0=Math.sqrt(k/m),z=c/(2*Math.sqrt(k*m)),wd=w0*Math.sqrt(Math.max(1-z*z,1e-6));
    var x=function(t){return z<1?1-Math.exp(-z*w0*t)*(Math.cos(wd*t)+(z*w0/wd)*Math.sin(wd*t)):1-Math.exp(-w0*t)*(1+w0*t)};
    var settle=Math.min(6/(z*w0),2),p=[];
    for(var i=0;i<=n;i++)p.push(+x(i/n*settle).toFixed(4));
    p[n]=1;return{duration:Math.round(settle*1000),easing:'linear('+p.join(',')+')'};
  }
  var supportsLinear=window.CSS&&CSS.supports&&CSS.supports('transition-timing-function','linear(0,1)');
  if(supportsLinear&&!reduce){
    var s=spring(),r=document.documentElement.style;
    r.setProperty('--spring',s.easing);r.setProperty('--spring-ms',s.duration+'ms');
  }
  /* Haptic tick: Android vibrate; iOS 17.4+ switch-input trick (undocumented, best effort) */
  function tick(){
    try{
      if(navigator.vibrate)return navigator.vibrate(8);
      var l=document.createElement('label');l.setAttribute('aria-hidden','true');
      l.style.cssText='position:fixed;opacity:0;pointer-events:none';
      l.innerHTML='<input type="checkbox" switch tabindex="-1">';document.body.appendChild(l);
      l.click();setTimeout(function(){l.remove()},50);
    }catch(e){}
  }
  window.ailFeel={spring:spring,tick:tick};
  document.addEventListener('click',function(e){
    var t=e.target.closest&&e.target.closest('[data-haptic]');if(t&&!reduce)tick();
  },{passive:true});
  /* Metallic sheen follows the pointer on .btn-metal */
  document.addEventListener('pointermove',function(e){
    var b=e.target.closest&&e.target.closest('.btn-metal');if(!b||reduce)return;
    var r=b.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;
    b.style.setProperty('--x',x*100+'%');b.style.setProperty('--y',y*100+'%');b.style.setProperty('--a',(x-.5)*140+'deg');
  },{passive:true});
})();
