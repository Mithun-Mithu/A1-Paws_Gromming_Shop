const API=import.meta.env.VITE_API_URL||'http://localhost:5000/api';
export async function api(path,options={}){const token=localStorage.getItem('a1token');const res=await fetch(API+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...options.headers}});const data=await res.json().catch(()=>({}));if(!res.ok){const error=new Error(data.message||'Request failed');error.status=res.status;throw error;}return data;}
export {API};
