(()=>{
  'use strict';
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const badge=(v)=>v==='granted'?'<span class="pill on">Granted</span>':v==='denied'?'<span class="pill off">Denied</span>':'<span class="pill warn">'+esc(v||'Belum')+'</span>';
  window.loadVisitors=async function(){
    try{
      const data=await api('/visitors/identity-monitor');
      document.getElementById('liveCountLabel').textContent=data.count+' visitor record 24 jam terakhir';
      const tbody=document.getElementById('activeVisitorsBody');
      if(!data.visitors?.length){tbody.innerHTML='<tr><td colspan="8" class="empty">Belum ada data visitor.</td></tr>';return;}
      tbody.innerHTML=data.visitors.map(v=>{
        const entry=new Date(v.entry_time).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
        const sec=Math.max(0,Math.floor((Date.now()-new Date(v.entry_time).getTime())/1000)); const mins=Math.floor(sec/60), secs=sec%60;
        const photo=v.identity_photo_data?'<img src="'+esc(v.identity_photo_data)+'" alt="Foto visitor" style="width:46px;height:46px;object-fit:cover;border-radius:10px;border:1px solid #dce9e7;cursor:pointer" onclick="window.open(\\''+esc(v.identity_photo_data)+"\\',\\'_blank\\')">":"<span class=\"muted\">Belum</span>";
        const coords=v.location_lat!=null&&v.location_lng!=null?v.location_lat.toFixed(5)+', '+v.location_lng.toFixed(5):'-';
        return '<tr><td class="muted">'+esc(v.page_visited||'/')+'</td><td>'+entry+'</td><td>'+mins+'m '+secs+'s</td><td>'+badge(v.camera_permission)+'</td><td>'+photo+'</td><td>'+badge(v.location_permission)+'</td><td><small>'+esc(coords)+'</small></td><td><small>'+esc(v.session_id)+'</small></td></tr>';
      }).join('');
    }catch(err){document.getElementById('liveCountLabel').textContent='Gagal memuat monitor identitas.';}
  };
  const oldSwitch=window.switchTab; if(oldSwitch) window.switchTab=function(tab){oldSwitch(tab);if(tab==='pengunjung')window.loadVisitors();};
  setTimeout(()=>{if(document.getElementById('panel-pengunjung')?.classList.contains('active'))window.loadVisitors();},1200);
})();
