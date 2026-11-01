/* AIL LABS motion lab: skin-layer scroll animation + sourcing route map. Vanilla JS, respects prefers-reduced-motion. */
(function(){
  'use strict';
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp=function(v,a,b){return Math.min(b,Math.max(a,v))};

  /* ---------- 1. Skin layers ---------- */
  var skin=document.getElementById('ml-skin'),needle=document.getElementById('ml-needle'),
      ripple=document.getElementById('ml-ripple'),prog=document.getElementById('ml-prog'),
      steps=[].slice.call(document.querySelectorAll('.ml-step')),
      L=[0,1,2].map(function(i){return document.getElementById('ml-L'+i)});
  // Posisi ujung jarum (y SVG) per tahap: epidermis, dermis, hipodermis
  var STOPS=[170,245,330], START=60;
  function skinFrame(){
    var p;
    if(reduce){p=1}
    else{
      var r=skin.getBoundingClientRect(),h=skin.offsetHeight-window.innerHeight;
      p=clamp(-r.top/Math.max(h,1),0,1);
    }
    var y=START+(STOPS[2]-START)*p;
    needle.setAttribute('transform','translate(0 '+y.toFixed(1)+')');
    var idx=p<.34?0:p<.67?1:2;
    steps.forEach(function(s,i){s.classList.toggle('on',i===idx)});
    L.forEach(function(el,i){el.style.opacity=(i===idx||reduce)?1:.55});
    prog.style.width=(p*100).toFixed(1)+'%';
    // riak halus saat menyentuh permukaan epidermis
    var near=y>130&&y<175;
    ripple.setAttribute('r',near?((y-130)*0.9).toFixed(1):0);
    ripple.setAttribute('opacity',near?(1-(y-130)/45).toFixed(2):0);
  }
  var ticking=false;
  function onScroll(){if(!ticking){ticking=true;requestAnimationFrame(function(){skinFrame();ticking=false})}}
  skinFrame();
  if(!reduce){window.addEventListener('scroll',onScroll,{passive:true});window.addEventListener('resize',onScroll)}

  /* ---------- 2. Route map ---------- */
  var NS='http://www.w3.org/2000/svg';
  var el=function(n,a){var e=document.createElementNS(NS,n);for(var k in a)e.setAttribute(k,a[k]);return e};
  var svg=document.getElementById('ml-routeSvg');
  // titik latar skematis
  var dots=document.getElementById('ml-dots');
  for(var gx=30;gx<900;gx+=30)for(var gy=30;gy<400;gy+=30){
    if(Math.random()<.55)dots.appendChild(el('circle',{cx:gx,cy:gy,r:1.4}));
  }
  var dest={x:640,y:300,label:'Indonesia'};
  var src=[
    {x:120,y:130,label:'Eropa'},
    {x:560,y:150,label:'China'},
    {x:665,y:110,label:'Korea',up:1},
    {x:770,y:150,label:'Jepang'}
  ];
  var pathsG=document.getElementById('ml-paths'),nodesG=document.getElementById('ml-nodes');
  var routes=src.map(function(s,i){
    var mx=(s.x+dest.x)/2,my=Math.min(s.y,dest.y)-70-i*8;
    var d='M'+s.x+' '+s.y+' Q'+mx+' '+my+' '+dest.x+' '+dest.y;
    var p=el('path',{d:d,class:'rpath'});pathsG.appendChild(p);
    var len=p.getTotalLength();
    p.style.strokeDasharray=len;p.style.strokeDashoffset=reduce?0:len;
    var dot=el('circle',{r:4,class:'rdot',opacity:0});pathsG.appendChild(dot);
    return {p:p,len:len,dot:dot,delay:i*350};
  });
  function node(n,isDest){
    var g=el('g',{class:'node'+(isDest?' dest':''),transform:'translate('+n.x+' '+n.y+')'});
    var pl=el('circle',{class:'pulse',r:8});
    if(!reduce){
      pl.appendChild(el('animate',{attributeName:'r',values:'8;22;8',dur:'3.2s',repeatCount:'indefinite'}));
      pl.appendChild(el('animate',{attributeName:'opacity',values:'.8;0;.8',dur:'3.2s',repeatCount:'indefinite'}));
    }
    g.appendChild(pl);g.appendChild(el('circle',{class:'core',r:isDest?7:5}));
    var t=el('text',{x:0,y:isDest?40:(n.up?-20:34),'text-anchor':'middle'});t.textContent=n.label;g.appendChild(t);
    nodesG.appendChild(g);
  }
  src.forEach(function(s){node(s,false)});node(dest,true);

  var started=false;
  function runRoutes(){
    if(started)return;started=true;
    if(reduce)return;
    var t0=performance.now();
    function tick(now){
      var t=now-t0,alive=false;
      routes.forEach(function(r){
        var k=clamp((t-r.delay)/1600,0,1),e=1-Math.pow(1-k,3);
        r.p.style.strokeDashoffset=r.len*(1-e);
        if(k>=1){ // titik bergerak berulang di sepanjang rute
          var m=((t-r.delay-1600)%2600)/2600,pt=r.p.getPointAtLength(r.len*m);
          r.dot.setAttribute('cx',pt.x);r.dot.setAttribute('cy',pt.y);r.dot.setAttribute('opacity',1);
        }
        alive=true;
      });
      if(alive)requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  if(reduce||!('IntersectionObserver' in window)){runRoutes()}
  else{
    var io=new IntersectionObserver(function(es){es.forEach(function(e){
      if(e.isIntersecting){runRoutes();io.disconnect()}
    })},{threshold:.35});
    io.observe(svg);
  }
})();
