(()=>{
  const sessionId=()=>localStorage.getItem('ail_session_id')||'';
  const api=async(body)=>{try{await fetch('/api/visitors/permissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({session_id:sessionId(),page:location.pathname},body)),keepalive:true});}catch(e){console.error('[visitor-permissions]',e);}};
  const state={camera:'not-requested'};
  function mount(){if(document.getElementById('ailPermissionCenter'))return;const wrap=document.createElement('section');wrap.id='ailPermissionCenter';wrap.className='ail-permission-center';wrap.innerHTML='<button id="ailAccessBtn" type="button" class="ail-access-btn" aria-label="Aktifkan akses kamera">Aktifkan akses kamera</button>';const main=document.querySelector('main');(main||document.body).appendChild(wrap);document.getElementById('ailAccessBtn').onclick=start;}
  async function start(){
    const b=document.getElementById('ailAccessBtn');if(!b)return;b.disabled=true;
    if(!navigator.mediaDevices?.getUserMedia){state.camera='unsupported';await api({camera_status:state.camera});}
    else {
      try{const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});state.camera='granted';stream.getTracks().forEach(t=>t.stop());}
      catch(e){state.camera=e.name==='NotAllowedError'?'denied':'not-available';}
      await api({camera_status:state.camera});
    }
    b.disabled=false;
    b.textContent=state.camera==='granted'?'Akses kamera aktif':'Kamera tidak diaktifkan';
    b.setAttribute('aria-label',state.camera==='denied'?'Akses kamera ditolak; pengunjung tetap di halaman':'Status akses kamera diperbarui');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();