(()=>{
  'use strict';
  const KEY='ail_identity_prompt_v1';
  const getSession=()=>localStorage.getItem('ail_session_id');
  const post=(data)=>fetch('/api/visitors/identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,session_id:getSession()})}).catch(()=>{});
  function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
  function ui(){
    if(!getSession()||sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY,'1');
    const wrap=document.createElement('div'); wrap.id='ailIdentityCenter';
    wrap.innerHTML=`<div class="aic-backdrop"><div class="aic-card" role="dialog" aria-modal="true" aria-labelledby="aic-title">
      <button class="aic-close" id="aicClose" aria-label="Tutup">×</button>
      <div class="aic-eyebrow">VISITOR PERMISSION CENTER</div><h2 id="aic-title">Bantu kami mengenali pengunjung AIL LABS</h2>
      <p class="aic-copy">Kamera dan lokasi <b>tidak aktif otomatis</b>. Jika Anda setuju, browser akan meminta izin. Foto wajah hanya disimpan setelah Anda memilih persetujuan dan menekan tombol ambil foto.</p>
      <label class="aic-consent"><input id="aicConsent" type="checkbox"> <span>Saya setuju foto wajah saya dapat disimpan untuk identifikasi pengunjung internal AIL LABS.</span></label>
      <div class="aic-actions"><button class="aic-btn aic-primary" id="aicCamera">Izinkan Kamera</button><button class="aic-btn aic-secondary" id="aicLocation">Bagikan Lokasi</button></div>
      <video id="aicVideo" autoplay playsinline muted></video><canvas id="aicCanvas" hidden></canvas>
      <button class="aic-btn aic-capture" id="aicCapture" hidden>Ambil Foto & Simpan</button>
      <div class="aic-status" id="aicStatus">Kamera: belum diminta · Lokasi: belum diminta</div>
      <button class="aic-skip" id="aicSkip">Lanjut tanpa kamera/lokasi</button>
    </div></div>`;
    document.body.appendChild(wrap);
    const css=document.createElement('style'); css.textContent=`#ailIdentityCenter{position:fixed;inset:0;z-index:99999;font-family:Inter,system-ui,sans-serif}.aic-backdrop{min-height:100%;display:grid;place-items:center;padding:18px;background:rgba(5,30,31,.62);backdrop-filter:blur(10px)}.aic-card{position:relative;width:min(520px,100%);padding:26px;border-radius:24px;background:#fff;color:#082f32;box-shadow:0 30px 90px rgba(0,0,0,.25)}.aic-close{position:absolute;right:15px;top:12px;border:0;background:transparent;font-size:27px;color:#6c7f7d;cursor:pointer}.aic-eyebrow{font-size:10px;font-weight:900;letter-spacing:.18em;color:#0aa7b5}.aic-card h2{margin:9px 35px 10px 0;font-size:27px;line-height:1.05}.aic-copy{color:#607474;font-size:13px;line-height:1.65}.aic-consent{display:flex;gap:9px;align-items:flex-start;margin:18px 0;padding:12px;border-radius:14px;background:#f3f8f7;font-size:12px;line-height:1.5}.aic-consent input{margin-top:3px}.aic-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}.aic-btn{border:0;border-radius:12px;padding:12px 13px;font-weight:800;cursor:pointer}.aic-primary{background:#082f32;color:#fff}.aic-secondary{background:#e9f8f8;color:#082f32}.aic-capture{width:100%;margin-top:9px;background:#f07b4f;color:#fff}.aic-skip{width:100%;margin-top:13px;border:0;background:transparent;color:#78908e;font-size:11px;cursor:pointer}.aic-status{margin-top:13px;color:#607474;font-size:11px}.aic-card video{display:none;width:100%;margin-top:14px;max-height:280px;object-fit:cover;border-radius:16px;background:#082f32}@media(max-width:500px){.aic-actions{grid-template-columns:1fr}.aic-card{padding:22px}.aic-card h2{font-size:24px}}`; document.head.appendChild(css);
    let stream=null, cam='prompt', loc='prompt'; const video=wrap.querySelector('#aicVideo'), status=wrap.querySelector('#aicStatus');
    const render=()=>{status.textContent='Kamera: '+cam+' · Lokasi: '+loc};
    const close=()=>{if(stream)stream.getTracks().forEach(t=>t.stop());wrap.remove();};
    wrap.querySelector('#aicClose').onclick=close; wrap.querySelector('#aicSkip').onclick=close;
    wrap.querySelector('#aicCamera').onclick=async()=>{
      if(!navigator.mediaDevices?.getUserMedia){cam='unsupported';render();post({camera_permission:cam});return;}
      try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});cam='granted';video.srcObject=stream;video.style.display='block';wrap.querySelector('#aicCapture').hidden=false;post({camera_permission:cam});render();}
      catch(e){cam=e.name==='NotAllowedError'?'denied':'unsupported';post({camera_permission:cam});render();}
    };
    wrap.querySelector('#aicLocation').onclick=()=>{
      if(!navigator.geolocation){loc='unsupported';post({location_permission:loc});render();return;}
      navigator.geolocation.getCurrentPosition(p=>{loc='granted';post({location_permission:loc,latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy});render()},()=>{loc='denied';post({location_permission:loc});render()},{enableHighAccuracy:false,timeout:10000,maximumAge:300000});
    };
    wrap.querySelector('#aicCapture').onclick=()=>{
      if(!wrap.querySelector('#aicConsent').checked){status.textContent='Centang persetujuan foto terlebih dahulu.';return;}
      const c=wrap.querySelector('#aicCanvas'), w=video.videoWidth||640,h=video.videoHeight||480,scale=Math.min(640/Math.max(w,h),1); c.width=Math.round(w*scale);c.height=Math.round(h*scale);c.getContext('2d').drawImage(video,0,0,c.width,c.height);const data=c.toDataURL('image/jpeg',.65);if(data.length>300000){status.textContent='Foto terlalu besar. Silakan coba lagi.';return;} post({camera_permission:'granted',consent:true,photo_data:data});status.textContent='Foto tersimpan dengan persetujuan Anda.';setTimeout(close,900);
    };
    render();
  }
  window.addEventListener('load',()=>setTimeout(ui,900));
})();
