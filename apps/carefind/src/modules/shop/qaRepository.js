// Q&A — shop_product_qa with localStorage fallback (fully functional offline)
import { supabase } from '../../config/supabaseClient'
const LS_KEY = 'carefind_shop_qa_v1'
function lsLoad(){ try { return JSON.parse(localStorage.getItem(LS_KEY)||'{}')} catch { return {}} }
function lsSave(m){ localStorage.setItem(LS_KEY, JSON.stringify(m)) }

export function createQaRepository(client=supabase){
  return {
    async list(ecommerceProductId){
      try {
        const { data, error } = await client.from('shop_product_qa').select('id,question,answer,asker_id,answerer_id,created_at,answered_at').eq('ecommerce_product_id', ecommerceProductId).order('created_at',{ascending:false})
        if (!error && data) return data
      } catch {}
      const m=lsLoad(); return (m[ecommerceProductId]||[]).slice().sort((a,b)=> new Date(b.created_at)-new Date(a.created_at))
    },
    async ask(ecommerceProductId, question){
      const { data: { user } } = await client.auth.getUser()
      const asker = user?.id || 'anon'
      try {
        const { data, error } = await client.from('shop_product_qa').insert({ ecommerce_product_id:ecommerceProductId, question:question.trim(), asker_id: asker }).select('id').maybeSingle()
        if (!error) return data
      } catch {}
      const m=lsLoad(); const list=m[ecommerceProductId]||[]; const row={ id:`ls_${Date.now()}`, ecommerce_product_id:ecommerceProductId, question:question.trim(), answer:null, asker_id:asker, created_at: new Date().toISOString() }
      list.push(row); m[ecommerceProductId]=list; lsSave(m); return row
    },
    async answer(id, answer, ecommerceProductId){
      try {
        const { data: { user } } = await client.auth.getUser()
        const { error } = await client.from('shop_product_qa').update({ answer: answer.trim(), answerer_id: user?.id, answered_at: new Date().toISOString() }).eq('id', id)
        if (!error) return true
      } catch {}
      // local fallback — update
      if (ecommerceProductId){
        const m=lsLoad(); const list=m[ecommerceProductId]||[]; const idx=list.findIndex(r=>r.id===id); if(idx>=0){ list[idx].answer=answer.trim(); list[idx].answered_at=new Date().toISOString(); lsSave(m); return true }
      } else {
        const m=lsLoad(); for(const k of Object.keys(m)){ const idx=m[k].findIndex(r=>r.id===id); if(idx>=0){ m[k][idx].answer=answer.trim(); m[k][idx].answered_at=new Date().toISOString(); lsSave(m); return true }}
      }
      return false
    },
    async remove(id, ecommerceProductId){
      try { const { error } = await client.from('shop_product_qa').delete().eq('id', id); if(!error) return true } catch {}
      const m=lsLoad()
      if (ecommerceProductId && m[ecommerceProductId]) m[ecommerceProductId]=m[ecommerceProductId].filter(r=>r.id!==id)
      else for(const k of Object.keys(m)) m[k]=m[k].filter(r=>r.id!==id)
      lsSave(m); return true
    }
  }
}
export const qaRepository = createQaRepository()
