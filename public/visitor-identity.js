(()=>{
  'use strict';
  const KEY='ail_identity_prompt_v2';
  const getSession=()=>localStorage.getItem('ail_session_id');
  const post=async(data)=>{const r=await fetch('/api/visitors/identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,session_id:getSession()})});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||'Gagal menyimpan foto.');return r.json();};
  const permission=(data)=>fetch('/api/visitors/permissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...data,session_id:getSession(),page:location.pathname}),keepalive:true}).catch(()=>{});
  function ui(){
    if(!getSession()||sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY,'1');
    const wrap=document.createElement('div'); wrap.id='ailIdentityCenter';
    wrap.innerHTML=`<div class="aic-backdrop"><div class="aic-card" role="dialog" aria-modal="true" aria-labelledby="aic-title">
      <button class="aic-close" id="aicClose" aria-label="Tutup">×</button>
      <div class="aic-eyebrow">VISITOR PHOTO CONSENT</div>
      <h2 id="aic-title">Foto pengunjung AIL LABS</h2>
      <p class="aic-copy">Tujuan: identifikasi pengunjung internal agar tim AIL LABS dapat memahami dan menindaklanjuti interaksi pengunjung. Kamera <b>tidak akan diaktifkan sebelum persetujuan eksplisit</b>.</p>
      <div class="aic-policy"><b>Masa simpan:</b> maksimal 90 hari sejak foto disimpan. <b>Yang dapat melihat:</b> admin AIL LABS yang terautentikasi. <b>Hak Anda:</b> Anda dapat meminta penghapusan foto.</div>
      <label class="aic-consent"><input id="aicConsent" type="checkbox"> <span>Saya setuju foto wajah saya diambil dan disimpan untuk tujuan tersebut.</span></label>
      <button class="aic-btn aic-primary" id="aicCamera" disabled>Izinkan Kamera</button>
      <video id="aicVideo" autoplay playsinline muted></video><canvas id="aicCanvas" hidden></canvas>
      <button class="aic-btn aic-capture" id="aicCapture" hidden>Ambil Foto & Simpan</button>
      <div class="aic-status" id="aicStatus">Persetujuan belum diberikan.</div>
      <button class="aic-skip" id="aicSkip">Lanjut tanpa foto</button>
    </div></div>`;
    document.body.appendChild(wrap);
    const css=document.createElement('style'); css.textContent=`#ailIdentityCenter{position:fixed;inset:0;z-index:99999;font-family:Inter,system-ui,sans-serif}.aic-backdrop{min-height:100%;display:grid;place-items:center;padding:18px;background:rgba(5,30,31,.62);backdrop-filter:blur(10px)}.aic-card{position:relative;width:min(520px,100%);padding:26px;border-radius:24px;background:#fff;color:#082f32;box-shadow:0 30px 90px rgba(0,0,0,.25)}.aic-close{position:absolute;right:15px;top:12px;border:0;background:transparent;font-size:27px;color:#6c7f7d;cursor:pointer}.aic-eyebrow{font-size:10px;font-weight:900;letter-spacing:.18em;color:#0aa7b5}.aic-card h2{margin:9px 35px 10px 0;font-size:27px;line-height:1.05}.aic-copy,.aic-policy{color:#607474;font-size:13px;line-height:1.65}.aic-policy{margin:14px 0;padding:12px;border-radius:14px;background:#f3f8f7;font-size:12px}.aic-consent{display:flex;gap:9px;align-items:flex-start;margin:18px 0;padding:12px;border-radius:14px;background:#f3f8f7;font-size:12px;line-height:1.5}.aic-consent input{margin-top:3px}.aic-btn{width:100%;border:0;border-radius:12px;padding:12px 13px;font-weight:800;cursor:pointer}.aic-primary{background:#082f32;color:#fff}.aic-primary:disabled{opacity:.45;cursor:not-allowed}.aic-capture{margin-top:9px;background:#f07b4f;color:#fff}.aic-skip{width:100%;margin-top:13px;border:0;background:transparent;color:#78908e;font-size:11px;cursor:pointer}.aic-status{margin-top:13px;color:#607474;font-size:11px}.aic-card video{display:none;width:100%;margin-top:14px;max-height:280px;object-fit:cover;border-radius:16px;background:#082f32}`;
    document.head.appendChild(css);
    let stream=null,cam='not-requested';
    const video=wrap.querySelector('#aicVideo'), status=wrap.querySelector('#aicStatus'), consent=wrap.querySelector('#aicConsent'), camera=wrap.querySelector('#aicCamera');
    const close=()=>{if(stream)stream.getTracks().forEach(t=>t.stop());wrap.remove();};
    consent.onchange=()=>{camera.disabled=!consent.checked;status.textContent=consent.checked?'Persetujuan diberikan. Anda dapat mengaktifkan kamera.':'Persetujuan belum diberikan.';};
    wrap.querySelector('#aicClose').onclick=close; wrap.querySelector('#aicSkip').onclick=close;
    camera.onclick=async()=>{
      if(!consent.checked){status.textContent='Persetujuan wajib diberikan sebelum kamera diaktifkan.';return;}
      if(!navigator.mediaDevices?.getUserMedia){cam='unsupported';status.textContent='Kamera tidak tersedia di perangkat ini.';return;}
      camera.disabled=true;
      try{
        stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
        cam='granted'; permission({camera_status:'granted',consent:true}); video.srcObject=stream; video.style.display='block';
        wrap.querySelector('#aicCapture').hidden=false; status.textContent='Kamera aktif. Foto belum disimpan.';
      }catch(e){
        cam=e.name==='NotAllowedError'?'denied':'not-available';
        permission({camera_status:cam}); status.textContent='Kamera tidak diaktifkan.';
        camera.disabled=false;
      }
    };
    wrap.querySelector('#aicCapture').onclick=()=>{
      if(!consent.checked||cam!=='granted'){status.textContent='Persetujuan dan kamera wajib aktif sebelum foto diambil.';return;}
      const c=wrap.querySelector('#aicCanvas'),w=video.videoWidth||640,h=video.videoHeight||480,scale=Math.min(640/Math.max(w,h),1);
      c.width=Math.round(w*scale);c.height=Math.round(h*scale);c.getContext('2d').drawImage(video,0,0,c.width,c.height);
      const data=c.toDataURL('image/jpeg',.65);
      if(data.length>300000){status.textContent='Foto terlalu besar. Silakan coba lagi.';return;}
      post({camera_permission:'granted',consent:true,photo_data:data}).then(()=>{status.textContent='Foto tersimpan dengan persetujuan Anda.';setTimeout(close,900);}).catch(()=>{status.textContent='Foto gagal disimpan. Tidak ada konfirmasi penyimpanan.';});
      setTimeout(close,900);
    };
  }
  window.addEventListener('load',()=>setTimeout(ui,900));
})();