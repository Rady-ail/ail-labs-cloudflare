(()=>{
  const sessionId=()=>localStorage.getItem('ail_session_id')||'';
  const post=async(path,body)=>{try{await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({session_id:sessionId(),page:location.pathname},body)),keepalive:true});}catch(e){console.error('[visitor-permissions]',e);}};
  const state={camera:'not-requested',location:'not-requested',redirecting:false};
  function back(){if(state.redirecting)return;state.redirecting=true;setTimeout(()=>{if(history.length>1)history.back();else if(document.referrer){try{const u=new URL(document.referrer);if(u.origin===location.origin){location.replace(document.referrer);return;}}catch(e){}}location.replace('/');},350);}
  function mount(){if(document.getElementById('ailPermissionCenter'))return;const wrap=document.createElement('section');wrap.id='ailPermissionCenter';wrap.className='ail-permission-center';wrap.innerHTML='<button id="ailAccessBtn" type="button" class="ail-access-btn" aria-label="Aktifkan akses browser">Aktifkan akses</button>';const main=document.querySelector('main');(main||document.body).appendChild(wrap);document.getElementById('ailAccessBtn').onclick=start;}
  async function audit(body){await post('/api/visitors/human-verification',body);}
  async function verifyHuman(stream){
    const started=Date.now();
    await audit({status:'checking',camera_status:'granted',check_method:'local-face-detector',liveness_status:'not-checked',started_at:new Date(started).toISOString()});
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.autoplay=true;video.srcObject=stream;video.style.cssText='position:fixed;left:-9999px;width:160px;height:120px;opacity:0;pointer-events:none';document.body.appendChild(video);
    try{
      await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('camera-frame-timeout')),1500);video.onloadedmetadata=()=>{clearTimeout(t);resolve();};});
      await video.play();
      if(!('FaceDetector' in window)){await audit({status:'unsupported',camera_status:'granted',check_method:'local-face-detector',human_verified:false,frame_check:false,liveness_status:'not-checked',started_at:new Date(started).toISOString(),completed_at:new Date().toISOString(),duration_ms:Date.now()-started,failure_reason:'Browser tidak menyediakan FaceDetector lokal.'});return false;}
      const detector=new FaceDetector({fastMode:true,maxDetectedFaces:1});
      const deadline=Date.now()+3000;let detected=false;
      while(Date.now()<deadline){try{const faces=await detector.detect(video);if(faces.length){detected=true;break;}}catch(e){}await new Promise(r=>setTimeout(r,180));}
      const ended=Date.now();
      await audit({status:detected?'verified':'failed',camera_status:'granted',check_method:'local-face-detector',human_verified:detected,frame_check:true,liveness_status:'basic-pass',started_at:new Date(started).toISOString(),completed_at:new Date(ended).toISOString(),duration_ms:ended-started,failure_reason:detected?null:'Wajah tidak terdeteksi selama pemeriksaan singkat.'});
      return detected;
    }catch(e){
      await audit({status:'failed',camera_status:'granted',check_method:'local-face-detector',human_verified:false,frame_check:false,liveness_status:'basic-fail',started_at:new Date(started).toISOString(),completed_at:new Date().toISOString(),duration_ms:Date.now()-started,failure_reason:'Kamera tidak menghasilkan frame yang dapat diperiksa.'});return false;
    }finally{video.pause();video.srcObject=null;video.remove();}
  }
  async function start(){const b=document.getElementById('ailAccessBtn');if(!b)return;b.disabled=true;
    const started=Date.now();await audit({status:'started',camera_status:'not-requested',check_method:'local-face-detector',liveness_status:'not-checked',started_at:new Date(started).toISOString()});
    const locationTask=new Promise(resolve=>{if(!navigator.geolocation){state.location='unsupported';resolve();return;}navigator.geolocation.getCurrentPosition(async p=>{state.location='granted';await post('/api/visitors/permissions',{location_status:'granted',camera_status:state.camera,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy});resolve();},async e=>{state.location=e&&e.code===1?'denied':'not-available';await post('/api/visitors/permissions',{location_status:state.location,camera_status:state.camera});resolve();},{enableHighAccuracy:false,maximumAge:300000,timeout:10000});});
    let stream=null;
    try{
      if(!navigator.mediaDevices?.getUserMedia){state.camera='unsupported';await post('/api/visitors/permissions',{camera_status:state.camera,location_status:state.location});await audit({status:'unsupported',camera_status:state.camera,check_method:'local-face-detector',human_verified:false,liveness_status:'not-checked',started_at:new Date(started).toISOString(),completed_at:new Date().toISOString(),duration_ms:Date.now()-started,failure_reason:'Browser tidak mendukung kamera.'});}
      else{stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});state.camera='granted';await post('/api/visitors/permissions',{camera_status:'granted',location_status:state.location});await audit({status:'camera-granted',camera_status:'granted',check_method:'local-face-detector',liveness_status:'not-checked',started_at:new Date(started).toISOString()});const ok=await verifyHuman(stream);if(!ok){stream.getTracks().forEach(t=>t.stop());if(state.location==='denied'){back();return;}b.disabled=false;b.textContent='Coba lagi';return;}}
    }catch(e){state.camera=e.name==='NotAllowedError'?'denied':'not-available';await post('/api/visitors/permissions',{camera_status:state.camera,location_status:state.location});await audit({status:state.camera==='denied'?'camera-denied':'failed',camera_status:state.camera,check_method:'local-face-detector',human_verified:false,liveness_status:'not-checked',started_at:new Date(started).toISOString(),completed_at:new Date().toISOString(),duration_ms:Date.now()-started,failure_reason:e.name==='NotAllowedError'?'Izin kamera ditolak.':'Kamera tidak tersedia.'});if(state.camera==='denied'||state.location==='denied'){back();return;}b.disabled=false;b.textContent='Coba lagi';return;
    }finally{if(stream)stream.getTracks().forEach(t=>t.stop());}
    await Promise.all([locationTask]);if(state.location==='denied'||state.camera==='denied'){back();return;}b.disabled=false;b.textContent='Akses & verifikasi aktif';
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();