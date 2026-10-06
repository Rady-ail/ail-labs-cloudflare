export const LEAD_STATUSES=["New","Contacted","Qualified","Proposal","Won","Lost"];
export const RFQ_STATUSES=["Draft","Sent","Negotiation","Approved","Ordered","Cancelled","Lost"];
export const transitions={lead:{New:["Contacted","Lost"],Contacted:["Qualified","Lost"],Qualified:["Proposal","Lost"],Proposal:["Won","Lost"],Won:[],Lost:[]},rfq:{Draft:["Sent","Cancelled","Lost"],Sent:["Negotiation","Approved","Cancelled","Lost"],Negotiation:["Approved","Cancelled","Lost"],Approved:["Ordered","Cancelled"],Ordered:[],Cancelled:[],Lost:[]}};
export const points={catalog_view:5,product_view:10,catalog_download:15,inquiry:30,contact_verified:20,quotation_request:40};
export function canTransition(type,from,to){return Boolean(transitions[type]?.[from]?.includes(to));}
export function leadTier(score){return score>=70?"HOT":score>=40?"WARM":"COLD";}
export function scoreLead(events=[]){return Math.min(100,[...new Set(events.map(e=>e.type))].reduce((n,t)=>n+(points[t]||0),0));}
export function clean(v,max=500){return String(v??"").replace(/[\u0000-\u001F\u007F]/g,"").trim().slice(0,max);}
export function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||""));}
export function validPhone(v){return /^\+?[1-9]\d{7,14}$/.test(String(v||""));}
