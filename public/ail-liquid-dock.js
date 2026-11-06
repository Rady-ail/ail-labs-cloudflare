/* AIL LABS — floating glass dock (mobile). Injects a 5-item nav; styles live in styles/ail-liquid-glass.css.
   Presentation only: plain links, no tracking, safe if JS fails (the header menu still works). */
(function(){
  if(document.querySelector(".lg-dock"))return;
  var items=[
    {href:"/",label:"Home",match:["/","/index.html"],svg:'<path d="M4 11.2 12 4l8 7.2V19a1.4 1.4 0 0 1-1.4 1.4H15v-5.2H9v5.2H5.4A1.4 1.4 0 0 1 4 19z"/>'},
    {href:"/catalog.html",label:"Katalog",match:["/catalog.html"],svg:'<rect x="4" y="4" width="6.6" height="6.6" rx="1.8"/><rect x="13.4" y="4" width="6.6" height="6.6" rx="1.8"/><rect x="4" y="13.4" width="6.6" height="6.6" rx="1.8"/><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.8"/>'},
    {href:"/private-label.html",label:"Private Label",match:["/private-label.html"],svg:'<path d="M9.5 3.8h5M10.4 3.8v5.4L5.2 18a1.8 1.8 0 0 0 1.6 2.7h10.4a1.8 1.8 0 0 0 1.6-2.7l-5.2-8.8V3.8"/><path d="M8 14.5h8"/>'},
    {href:"/compliance.html",label:"Compliance",match:["/compliance.html"],svg:'<path d="M12 3.6 5 6.3v5.4c0 4.2 2.8 7.2 7 8.7 4.2-1.5 7-4.5 7-8.7V6.3z"/><path d="m8.9 12 2.3 2.3 4-4.3"/>'},
    {href:"/contact.html",label:"Kontak",match:["/contact.html"],svg:'<path d="M20 11.6c0 3.9-3.6 7-8 7-1 0-2-.15-2.9-.45L4.6 19.6l1.2-3.5A6.6 6.6 0 0 1 4 11.6c0-3.9 3.6-7 8-7s8 3.1 8 7z"/>'}
  ];
  var path=location.pathname.replace(/\/+$/,"")||"/";
  var active=0;
  items.forEach(function(it,i){if(it.match.indexOf(path)>-1)active=i});
  var nav=document.createElement("nav");
  nav.className="lg-dock";nav.setAttribute("aria-label","Navigasi bawah");
  nav.style.setProperty("--lg-i",active);
  var html='<ul><li class="lg-pill" aria-hidden="true"></li>';
  items.forEach(function(it,i){
    html+='<li><a href="'+it.href+'" aria-label="'+it.label+'"'+(i===active?' aria-current="page"':"")+
      '><svg viewBox="0 0 24 24" aria-hidden="true">'+it.svg+'</svg><span class="lg-sr">'+it.label+'</span></a></li>';
  });
  nav.innerHTML=html+"</ul>";
  document.body.appendChild(nav);
  /* press squash + pill slides to the tapped item right before the page changes */
  nav.addEventListener("pointerdown",function(e){if(e.target.closest("a"))nav.classList.add("is-press")});
  ["pointerup","pointercancel","pointerleave"].forEach(function(t){nav.addEventListener(t,function(){nav.classList.remove("is-press")})});
  nav.addEventListener("click",function(e){
    var a=e.target.closest("a");if(!a)return;
    var idx=[].indexOf.call(nav.querySelectorAll("a"),a);
    if(idx>-1)nav.style.setProperty("--lg-i",idx);
  });
})();
