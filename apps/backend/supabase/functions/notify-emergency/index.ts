import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { createEmergencyHandler } from './handler.ts'
const url=Deno.env.get('SUPABASE_URL') ?? ''
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
Deno.serve(createEmergencyHandler({
  apiKey:Deno.env.get('RESEND_API_KEY'),from:Deno.env.get('RESEND_FROM_EMAIL'),fetch,
  authenticate:async token=>{const {data,error}=await admin.auth.getUser(token);return error ? null : data.user?.id ?? null},
  event:async (userId,eventId)=>{const {data,error}=await admin.from('acoustic_event_logs').select('*').eq('id',eventId).eq('user_id',userId).maybeSingle();if(error)throw error;return data},
  contacts:async userId=>{const {data,error}=await admin.from('emergency_contacts').select('id,name,email').eq('user_id',userId).eq('is_active',true);if(error)throw error;return data ?? []},
  queued:async (event,contact)=>{
    const {data,error}=await admin.rpc('claim_emergency_dispatch',{p_event_id:event.id,p_contact_id:contact.id,p_user_id:event.user_id})
    if(error)throw error
    return data
  },
  mark:async (id,status,payload,errorMessage)=>{const {error}=await admin.from('notification_dispatch_logs').update({dispatch_type:'RESEND',status,payload,error_message:errorMessage,sent_at:new Date().toISOString()}).eq('id',id);if(error)throw error},
}))
