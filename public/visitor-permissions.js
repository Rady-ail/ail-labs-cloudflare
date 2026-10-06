(()=>{
  const sessionId=()=>localStorage.getItem('ail_session_id')||'';
  const api=async(path,body)=>{try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),keepalive:true});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request gagal');return d;}catch(e){console.error('[visitor-permissions]',e);return null;}};
  const state={camera:'not-requested',location:'not-requested',stream:null,photo:null,redirecting:false};
  function returnToPreviousPage(){if(state.redirecting)return;state.redirecting=true;stopCamera();setTimeout(()=>{if(history.length>1){history.back();}else if(document.referrer){try{const u=new URL(document.referrer);if(u.origin===location.origin){location.replace(document.referrer);return;}}catch(e){}}location.replace('/');},350);}
  function mount(){
    if(document.getElementById('ailPermissionCenter'))return;
    const wrap=document.createElement('section'); wrap.id='ailPermissionCenter'; wrap.className='ail-permission-center';
    wrap.innerHTML='<div class="ail-permission-card"><div><span class="ail-permission-eyebrow">VISITOR PRIVACY CENTER</span><h2>Bagikan lokasi atau foto Anda secara sukarela</h2><p>AIL LABS hanya meminta akses setelah Anda memilih Izinkan. Kamera tidak aktif diam-diam dan foto tidak diambil tanpa tindakan Anda.</p></div><div class="ail-permission-actions"><button type="button" id="ailLocationBtn">📍 Izinkan lokasi</button><button type="button" id="ailCameraBtn">📷 Izinkan kamera</button><button type="button" id="ailSelfieBtn" class="primary">Ambil foto profil</button></div><div id="ailPermissionStatus" class="ail-permission-status">Lokasi: Belum diminta · Kamera: Belum diminta</div><video id="ailCameraPreview" playsinline muted style="display:none"></video><div id="ailSelfieActions" style="display:none"><button type="button" id="ailCaptureBtn" class="primary">Ambil foto</button><button type="button" id="ailCancelCamera">Tutup kamera</button></div><canvas id="ailSelfieCanvas" hidden></canvas><img id="ailSelfiePreview" alt="Pratinjau foto profil" style="display:none"></div>';
    const anchor=document.querySelector('main'); if(anchor) anchor.appendChild(wrap); else document.body.appendChild(wrap);
    document.getElementById('ailLocationBtn').onclick=requestLocation;
    document.getElementById('ailCameraBtn').onclick=requestCamera;
    document.getElementById('ailSelfieBtn').onclick=requestSelfie;
    document.getElementById('ailCaptureBtn').onclick=captureSelfie;
    document.getElementById('ailCancelCamera').onclick=stopCamera;
    updateStatus();
  }
  function statusText(){document.getElementById('ailPermissionStatus').textContent='Lokasi: '+label(state.location)+' · Kamera: '+label(state.camera)+(state.photo?' · Foto profil: Tersimpan':'');}
  const label=s=>({granted:'Diizinkan',denied:'Ditolak',prompt:'Menunggu izin','not-requested':'Belum diminta',unsupported:'Tidak didukung'}[s]||s);
  async function query(name){try{return (await navigator.permissions.query({name})).state;}catch(e){return 'unsupported';}}
  async function updateStatus(){state.location=await query('geolocation');state.camera=await query('camera');statusText();await api('/api/visitors/permissions',{session_id:sessionId(),camera_status:state.camera,location_status:state.location,page:location.pathname});}
  async function requestLocation(){
    if(!navigator.geolocation)return; navigator.geolocation.getCurrentPosition(async p=>{state.location='granted';statusText();await api('/api/visitors/permissions',{session_id:sessionId(),location_status:'granted',camera_status:state.camera,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,page:location.pathname});},async(err)=>{state.location=err&&err.code===1?'denied':'not-available';statusText();await api('/api/visitors/permissions',{session_id:sessionId(),location_status:state.location,camera_status:state.camera,page:location.pathname});if(state.location==='denied')returnToPreviousPage();},{enableHighAccuracy:false,maximumAge:300000,timeout:10000});}
  async function requestCamera(){
    if(!navigator.mediaDevices?.getUserMedia){state.camera='unsupported';statusText();return;}
    try{const s=await navigator.mediaDevices.getUserMedia({video:true,audio:false});state.camera='granted';s.getTracks().forEach(t=>t.stop());state.stream=null;statusText();await api('/api/visitors/permissions',{session_id:sessionId(),camera_status:'granted',location_status:state.location,page:location.pathname});}
    catch(e){state.camera=e.name==='NotAllowedError'?'denied':'not-available';statusText();await api('/api/visitors/permissions',{session_id:sessionId(),camera_status:state.camera,location_status:state.location,page:location.pathname});if(state.camera==='denied')returnToPreviousPage();}
  }
  async function requestSelfie(){
    if(!navigator.mediaDevices?.getUserMedia)return;
    try{state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});state.camera='granted';const v=document.getElementById('ailCameraPreview');v.srcObject=state.stream;v.style.display='block';await v.play();document.getElementById('ailSelfieActions').style.display='flex';statusText();await api('/api/visitors/permissions',{session_id:sessionId(),camera_status:'granted',location_status:state.location,page:location.pathname});}
    catch(e){state.camera=e.name==='NotAllowedError'?'denied':'not-available';statusText();await api('/api/visitors/permissions',{session_id:sessionId(),camera_status:state.camera,location_status:state.location,page:location.pathname});if(state.camera==='denied')returnToPreviousPage();}
  }
  async function captureSelfie(){
    const v=document.getElementById('ailCameraPreview'),c=document.getElementById('ailSelfieCanvas'); if(!state.stream||!v.videoWidth)return;
    const max=640, scale=Math.min(1,max/v.videoWidth);c.width=Math.round(v.videoWidth*scale);c.height=Math.round(v.videoHeight*scale);c.getContext('2d').drawImage(v,0,0,c.width,c.height);const data=c.toDataURL('image/jpeg',.62);document.getElementById('ailSelfiePreview').src=data;document.getElementById('ailSelfiePreview').style.display='block';const saved=await api('/api/visitors/identity',{session_id:sessionId(),photo_data:data,consent:true,page:location.pathname});if(!saved?.ok){state.photo=false;statusText();alert('Foto belum tersimpan. Silakan coba lagi.');return;}state.photo=true;stopCamera();statusText();}
  function stopCamera(){if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}const v=document.getElementById('ailCameraPreview');if(v){v.pause();v.srcObject=null;v.style.display='none';}const a=document.getElementById('ailSelfieActions');if(a)a.style.display='none';}
  window.addEventListener('beforeunload',stopCamera); if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();