(() => {\n  if (location.pathname === '/compliance.html') return;
  const KEY='ail_verified_lead_token_v1', SESSION_KEY='ail_session_id';
  const getSessionId=()=>localStorage.getItem(SESSION_KEY)||'', token=()=>localStorage.getItem(KEY)||'';
  const style=document.createElement('style'); style.textContent=`
  #ailLeadGate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(4,25,27,.72);backdrop-filter:blur(14px);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  #ailLeadGate .ail-card{width:min(560px,100%);max-height:calc(100vh - 36px);overflow:auto;background:#fff;border:1px solid rgba(10,167,181,.18);border-radius:26px;box-shadow:0 30px 100px rgba(0,0,0,.24);padding:28px;color:#082f32}
  #ailLeadGate .ail-brand{font-weight:900;letter-spacing:.14em;color:#0aa7b5;font-size:11px} #ailLeadGate h2{margin:9px 0 8px;font-size:clamp(25px,6vw,36px);line-height:1.04;letter-spacing:-.05em}
  #ailLeadGate p{margin:0;color:#607474;font-size:13px;line-height:1.65} #ailLeadGate .ail-grid{display:grid;gap:11px;margin-top:20px}
  #ailLeadGate label{font-size:11px;font-weight:800;color:#365958} #ailLeadGate input{display:block;width:100%;margin-top:5px;padding:13px 14px;border:1px solid #dce9e7;border-radius:12px;font:inherit;font-size:14px;outline:none}
  #ailLeadGate input:focus{border-color:#0aa7b5;box-shadow:0 0 0 3px rgba(10,167,181,.12)} #ailLeadGate button{width:100%;border:0;border-radius:12px;padding:14px;background:#082f32;color:#fff;font-weight:800;cursor:pointer}
  #ailLeadGate button:disabled{opacity:.55;cursor:not-allowed} #ailLeadGate .ail-note{margin-top:13px;font-size:10px;color:#78908e}
  #ailLeadGate .ail-check{display:flex;gap:9px;align-items:flex-start;margin-top:13px;font-size:10px;line-height:1.5;color:#607474}
  #ailLeadGate .ail-check input{width:17px;height:17px;margin:0;flex:0 0 auto} #ailLeadGate .ail-error{min-height:18px;margin-top:10px;color:#b42318;font-size:11px;font-weight:700}
  #ailLeadGate .ail-step{display:none}.ail-step.active{display:block} body.ail-lead-locked{overflow:hidden}`; document.head.appendChild(style);
  function build(){
    if(document.getElementById('ailLeadGate'))return;
    const wrap=document.createElement('div'); wrap.id='ailLeadGate';
    wrap.innerHTML=`<div class="ail-card" role="dialog" aria-modal="true" aria-labelledby="ailLeadTitle">
      <div class="ail-brand">AIL LABS · B2B ACCESS</div><h2 id="ailLeadTitle">Verifikasi kontak untuk melanjutkan.</h2>
      <p>Akses website AIL LABS memerlukan data kontak B2B yang dapat dihubungi. Email diverifikasi dengan kode sekali pakai sebelum akses diberikan.</p>
      <div class="ail-step active"><div class="ail-grid">
        <label>Nama lengkap<input id="ailName" autocomplete="name" maxlength="120" required></label>
        <label>Perusahaan / Institusi<input id="ailCompany" autocomplete="organization" maxlength="160" required></label><label>Jenis bisnis<select id="ailBusiness"><option value="">Pilih</option><option>Clinic</option><option>Doctor</option><option>Distributor</option><option>Importer</option><option>Manufacturer</option><option>Aesthetic professional</option><option>Other</option></select></label>
        <label>Email bisnis<input id="ailEmail" type="email" autocomplete="email" maxlength="180" required></label>
        <label>No. telepon / WhatsApp<input id="ailPhone" inputmode="tel" autocomplete="tel" placeholder="+628123456789" maxlength="20" required></label>
      </div>
      <label class="ail-check"><input id="ailConsent" type="checkbox"><span>Saya setuju AIL LABS memproses data ini untuk verifikasi identitas kontak, komunikasi bisnis, dan keamanan website. Lihat <a href="/compliance.html" target="_blank" rel="noopener">compliance</a>.</span></label>
      <label class="ail-check"><input id="ailMarketing" type="checkbox"><span>Saya bersedia menerima informasi produk/promosi AIL LABS. (Opsional)</span></label>
      <div class="ail-error" id="ailError"></div><button id="ailSend" type="button">Kirim kode verifikasi email</button>
      <div class="ail-note">Email wajib diverifikasi. Nomor telepon divalidasi format; kepemilikan nomor belum diverifikasi.</div></div>
      <div class="ail-step"><p>Kode 6 digit telah dikirim ke <strong id="ailEmailPreview"></strong>. Berlaku 10 menit.</p>
        <div class="ail-grid"><label>Kode verifikasi<input id="ailOtp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></label></div>
        <div class="ail-error" id="ailError2"></div><button id="ailVerify" type="button">Verifikasi & buka website</button>
        <button id="ailBack" type="button" style="margin-top:8px;background:#eaf4f3;color:#082f32">Kembali</button></div></div>`;
    document.body.appendChild(wrap); document.body.classList.add('ail-lead-locked');
    const $=id=>document.getElementById(id), steps=()=>wrap.querySelectorAll('.ail-step'), show=n=>steps().forEach((x,i)=>x.classList.toggle('active',i===n)), err=(id,msg)=>$(id).textContent=msg||'';
    $('ailSend').onclick=async()=>{
      const name=$('ailName').value.trim(),company=$('ailCompany').value.trim(),businessType=$('ailBusiness').value,email=$('ailEmail').value.trim().toLowerCase(),phone=$('ailPhone').value.trim();
      if(!name||!company||!businessType||!email||!phone||!$('ailConsent').checked){err('ailError','Lengkapi data dan centang persetujuan pemrosesan data.');return}
      $('ailSend').disabled=true;err('ailError','Mengirim kode verifikasi…');
      try{const r=await fetch('/api/leads/request-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,company,business_type:businessType,email,phone,session_id:getSessionId(),landing_page:location.pathname+location.search,lead_source:new URLSearchParams(location.search).get('utm_source')||(document.referrer?'referral':'direct'),utm_source:new URLSearchParams(location.search).get('utm_source')||'',utm_medium:new URLSearchParams(location.search).get('utm_medium')||'',utm_campaign:new URLSearchParams(location.search).get('utm_campaign')||'',consent:true,marketing_consent:$('ailMarketing').checked})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok)throw new Error(d.error||'Kode verifikasi gagal dikirim.');$('ailEmailPreview').textContent=email;err('ailError','Kode terkirim. Cek inbox/spam.');show(1)}catch(e){err('ailError',e.message||'Terjadi kesalahan.')}finally{$('ailSend').disabled=false}
    };
    $('ailVerify').onclick=async()=>{
      const name=$('ailName').value.trim(),company=$('ailCompany').value.trim(),businessType=$('ailBusiness').value,email=$('ailEmail').value.trim().toLowerCase(),phone=$('ailPhone').value.trim(),otp=$('ailOtp').value.trim();
      $('ailVerify').disabled=true;err('ailError2','Memverifikasi…');
      try{const r=await fetch('/api/leads/verify-otp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,company,business_type:businessType,email,phone,otp,session_id:getSessionId(),landing_page:location.pathname+location.search,lead_source:new URLSearchParams(location.search).get('utm_source')||'direct',utm_source:new URLSearchParams(location.search).get('utm_source')||'',utm_medium:new URLSearchParams(location.search).get('utm_medium')||'',utm_campaign:new URLSearchParams(location.search).get('utm_campaign')||'',consent:$('ailConsent').checked,marketing_consent:$('ailMarketing').checked})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.ok||!d.token)throw new Error(d.error||'Verifikasi gagal.');localStorage.setItem(KEY,d.token);wrap.remove();document.body.classList.remove('ail-lead-locked')}catch(e){err('ailError2',e.message||'Verifikasi gagal.')}finally{$('ailVerify').disabled=false}
    };
    $('ailBack').onclick=()=>{err('ailError2','');show(0)};
  }
  async function check(){try{const t=token();if(t){const r=await fetch('/api/leads/status',{headers:{'X-Lead-Token':t},cache:'no-store'});const d=await r.json().catch(()=>({}));if(d.verified)return;localStorage.removeItem(KEY)}}catch(e){}build()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',check,{once:true});else check();
})();