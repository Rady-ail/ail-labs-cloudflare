const express=require('express'),http=require('node:http'),router=require('../routes/productPhoto');
const {test}=require('node:test');
test('photo route diagnostic',async t=>{
 const bucket={put:async()=>({}),head:async()=>({size:8,httpMetadata:{contentType:'image/jpeg'}}),get:async()=>null};
 const app=express();app.use((q,s,n)=>{q.session={isAdmin:true};n()});app.use(express.json({limit:'2mb'}));app.locals.productImagesBucket=bucket;app.use('/api/products',router);
 const server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const fd=new FormData();fd.append('file',new Blob([Buffer.from('ffd8ff000122ffd9','hex')],{type:'image/jpeg'}),'x.jpg');
 const res=await fetch('http://127.0.0.1:'+server.address().port+'/api/products/photo-upload',{method:'POST',body:fd});
 console.log('PHOTO_DIAGNOSTIC',res.status,await res.text());
});
