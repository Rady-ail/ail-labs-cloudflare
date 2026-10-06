(()=>{
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const api=async p=>{const r=await fetch('/api'+p,{credentials:'include'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Gagal memuat monitor');return d};
 function mount(){
  const panel=document.getElementById('panel-pengunjung'),root=document.getElementById('visitorUnifiedPanel');
  if(!panel||!root)return;
  root.innerHTML='<div class="glass" style="padding:22px;border-radius:24px"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap"><div><div class="eyebrow">CONSENT-BASED VISITOR MONITOR</div><h2 style="margin:5px 0">Visitor Monitor</h2><div class="muted">Analytics tetap aktif. GPS dihentikan. Foto tidak dimuat otomatis.</div></div><button class="btn btn-secondary" id="visitorMonitorRefresh">↻ Refresh</button></div><div class="table-wrap" style="overflow:auto;margin-top:16px"><table><thead><tr><th>Waktu</th><th>Session</th><th>Halaman</th><th>Kamera</th><th>Foto</th><th>Aksi</th></tr></thead><tbody id="visitorMonitorBody"><tr><td colspan="6" class="empty">Memuat...</td></tr></tbody></table></div><div id="visitorPhotoViewer" hidden style="margin-top:18px"></div></div>';
  const body=document.getElementById('visitorMonitorBody'),viewer=document.getElementById('visitorPhotoViewer');
  const load=async()=>{
   try{
    const d=await api('/visitors/permission-monitor?limit=200');
    const rows=d.visitors||[];
    body.innerHTML=rows.length?rows.map(x=>'<tr><td class="muted">'+esc(new Date(x.updated_at||x.consent_at||Date.now()).toLocaleString('id-ID'))+'</td><td>'+esc(x.session_id)+'</td><td>'+esc(x.page||'/')+'</td><td>'+esc(x.camera_status||'—')+'</td><td>'+((x.has_photo)?'Tersedia':'—')+'</td><td>'+((x.has_photo)?'<button class="btn btn-secondary visitor-photo-btn" data-session="'+esc(x.session_id)+'">Lihat foto</button>':'—')+'</td></tr>').join(''):'<tr><td colspan="6" class="empty">Belum ada data consent/foto.</td></tr>';
   }catch(e){body.innerHTML='<tr><td colspan="6" class="empty">'+esc(e.message)+'</td></tr>';}
  };
  window.loadVisitors=load;
  root.querySelector('#visitorMonitorRefresh').onclick=load;
  body.addEventListener('click',async e=>{
   const b=e.target.closest('.visitor-photo-btn');if(!b)return;
   b.disabled=true;
   try{
    const d=await api('/visitors/identity/photo/'+encodeURIComponent(b.dataset.session));
    viewer.hidden=false;
    viewer.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px"><strong>Foto pengunjung</strong><button class="btn btn-secondary" id="visitorPhotoClose">Tutup</button></div><img src="'+esc(d.photo_data)+'" alt="Foto pengunjung — sesi '+esc(d.session_id)+'" style="display:block;max-width:min(360px,100%);max-height:420px;object-fit:contain;border-radius:16px;border:1px solid rgba(222,232,232,.25)">';
    viewer.querySelector('#visitorPhotoClose').onclick=()=>{viewer.hidden=true;viewer.innerHTML='';};
   }catch(e){viewer.hidden=false;viewer.innerHTML='<div class="muted">'+esc(e.message)+'</div>';}
   finally{b.disabled=false;}
  });
  load();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();