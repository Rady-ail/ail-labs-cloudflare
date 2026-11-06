/* AIL LABS — RFQ Island (web component). Client-side only: items live in localStorage until the user sends the form.
   Max 8 items; product/qty strings are composed to fit the /api/quotation limits (500 / 80 chars). Progressive enhancement. */
(function(){
  'use strict';
  var KEY='ail-rfq',MAX=8,MAXP=500;
  function read(){try{var a=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(a)?a.filter(function(i){return i&&typeof i.name==='string'}).slice(0,MAX):[]}catch(e){return[]}}
  function write(a){try{localStorage.setItem(KEY,JSON.stringify(a))}catch(e){}}
  function clamp(q){q=parseInt(q,10);return isFinite(q)?Math.min(Math.max(q,1),999):1}
  /* "Name (x3), Name2 (x5)" — names are shortened evenly if the whole string would exceed 500 chars */
  function composeProduct(items){
    var tails=items.map(function(i){return' (x'+clamp(i.qty)+')'});
    var overhead=tails.reduce(function(s,t){return s+t.length},0)+2*Math.max(items.length-1,0);
    var budget=items.length?Math.floor((MAXP-overhead)/items.length):0;
    return items.map(function(i,k){
      var n=i.name.replace(/\s+/g,' ').trim();
      if(n.length>budget)n=n.slice(0,Math.max(budget-1,1)).trimEnd()+'…';
      return n+tails[k];
    }).join(', ').slice(0,MAXP);
  }
  function composeQty(items){var t=items.reduce(function(s,i){return s+clamp(i.qty)},0);return 'Total: '+t+' item'}
  window.ailRfq={items:read,composeProduct:composeProduct,composeQty:composeQty,max:MAX,
    clear:function(){write([]);document.dispatchEvent(new CustomEvent('ail:rfq-change'))}};

  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
  var tick=function(){window.ailFeel&&window.ailFeel.tick&&window.ailFeel.tick()};

  class AilIsland extends HTMLElement{
    connectedCallback(){
      this.state='compact';this.items=read();
      var root=this.root=el('section','ail-island');
      root.setAttribute('role','region');root.setAttribute('aria-label','Daftar permintaan penawaran (RFQ)');
      root.dataset.state='compact';root.hidden=!this.items.length;
      var pill=this.pill=el('button','ail-island__pill');pill.type='button';
      pill.setAttribute('aria-expanded','false');pill.setAttribute('aria-controls','ail-island-body');
      this.count=el('span','ail-island__count','0');this.count.setAttribute('aria-live','polite');
      pill.append(this.count,el('span','ail-island__label',' item RFQ'));
      var body=this.body=el('div','ail-island__body');body.id='ail-island-body';body.hidden=true;
      this.list=el('ul','ail-island__list');this.note=el('p','ail-island__note');
      var send=this.send=el('a','ail-island__send','Lanjut ke formulir RFQ');send.href='/contact.html#quotation-form';
      var clr=el('button','ail-island__clear','Kosongkan');clr.type='button';
      body.append(this.list,this.note,el('div','ail-island__actions'));
      body.lastChild.append(send,clr);root.append(pill,body);this.append(root);
      pill.addEventListener('click',()=>this.set(this.state==='expanded'?'compact':'expanded'));
      clr.addEventListener('click',()=>{tick();window.ailRfq.clear()});
      this.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.state==='expanded'){this.set('compact');pill.focus()}});
      this._add=e=>this.add(e.detail);this._chg=()=>{this.items=read();this.render()};
      addEventListener('ail:rfq-add',this._add);document.addEventListener('ail:rfq-change',this._chg);
      addEventListener('storage',e=>{if(e.key===KEY)this._chg()});
      this.render();
    }
    disconnectedCallback(){removeEventListener('ail:rfq-add',this._add);document.removeEventListener('ail:rfq-change',this._chg)}
    set(s){
      this.state=s;this.root.dataset.state=s;
      this.pill.setAttribute('aria-expanded',String(s==='expanded'));this.body.hidden=s!=='expanded';
    }
    add(d){
      if(!d||!d.name)return;
      this.items=read();var f=this.items.find(i=>i.id===(d.id||d.name));
      if(f){f.qty=clamp(f.qty+1)}
      else if(this.items.length>=MAX){this.flash('Maksimal '+MAX+' item per permintaan.');return}
      else this.items.push({id:d.id||d.name,name:String(d.name).slice(0,160),qty:1});
      write(this.items);tick();this.render();this.pop();
    }
    flash(msg){this.root.hidden=false;this.note.textContent=msg;this.set('expanded')}
    pop(){
      this.root.hidden=false;this.root.classList.remove('is-pop');void this.root.offsetWidth;this.root.classList.add('is-pop');
      this.set('active');clearTimeout(this._t);
      this._t=setTimeout(()=>{if(this.state==='active')this.set('compact')},1600);
    }
    render(){
      var n=this.items.length;this.root.hidden=!n;
      this.count.textContent=this.items.reduce((s,i)=>s+clamp(i.qty),0);
      if(!n&&this.state==='expanded')this.set('compact');
      this.list.replaceChildren(...this.items.map((it,k)=>{
        var li=el('li','ail-island__item'),nm=el('span','ail-island__name',it.name);
        var dec=el('button','ail-island__step','−');dec.type='button';dec.setAttribute('aria-label','Kurangi jumlah '+it.name);
        var q=el('span','ail-island__qty',String(clamp(it.qty)));
        var inc=el('button','ail-island__step','+');inc.type='button';inc.setAttribute('aria-label','Tambah jumlah '+it.name);
        var rm=el('button','ail-island__step ail-island__rm','×');rm.type='button';rm.setAttribute('aria-label','Hapus '+it.name);
        var upd=fn=>()=>{var a=read();fn(a,k);write(a);this.items=a;tick();this.render()};
        dec.addEventListener('click',upd((a,i)=>{if(a[i]){a[i].qty=clamp(a[i].qty-1)}}));
        inc.addEventListener('click',upd((a,i)=>{if(a[i]){a[i].qty=clamp(a[i].qty+1)}}));
        rm.addEventListener('click',upd((a,i)=>{a.splice(i,1)}));
        li.append(nm,dec,q,inc,rm);return li;
      }));
      this.note.textContent=n?composeQty(this.items)+' · '+n+' dari '+MAX+' produk':'';
    }
  }
  if(!customElements.get('ail-island'))customElements.define('ail-island',AilIsland);

  /* Contact page: prefill the form from the RFQ list (unless a ?product= link already set it) */
  function prefill(){
    var p=document.getElementById('quoteProduct'),form=p&&p.closest('form');if(!p||!form)return;
    var items=read();
    if(items.length&&!p.value){
      p.value=composeProduct(items);var q=form.querySelector('[name="qty"]');if(q&&!q.value)q.value=composeQty(items);
    }
    form.addEventListener('reset',function(){window.ailRfq.clear()});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',prefill);else prefill();
})();
