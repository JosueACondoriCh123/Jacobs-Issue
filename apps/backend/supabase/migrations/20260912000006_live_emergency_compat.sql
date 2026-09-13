-- Additive compatibility for both the legacy event queue and migration 005.
-- No table/row deletion. Existing incident logs remain available as legacy data.
BEGIN;
ALTER TABLE public.notification_dispatch_logs
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.acoustic_event_logs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.emergency_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatch_type text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS recipient text,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS dispatch_key text;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='notification_dispatch_logs' AND column_name='incident_id') THEN
    UPDATE public.notification_dispatch_logs n SET user_id=COALESCE(n.user_id,i.user_id), payload=COALESCE(n.payload_summary,n.payload), sent_at=COALESCE(n.dispatched_at,n.sent_at)
    FROM public.acoustic_incidents i WHERE n.incident_id=i.id;
  END IF;
END $$;
UPDATE public.notification_dispatch_logs n SET recipient=COALESCE(n.recipient,c.email),user_id=COALESCE(n.user_id,c.user_id)
FROM public.emergency_contacts c WHERE n.contact_id=c.id;
CREATE UNIQUE INDEX IF NOT EXISTS live_dispatch_key_unique ON public.notification_dispatch_logs(dispatch_key);
CREATE INDEX IF NOT EXISTS live_dispatch_user_sent ON public.notification_dispatch_logs(user_id,sent_at DESC);
CREATE INDEX IF NOT EXISTS live_dispatch_event_recipient ON public.notification_dispatch_logs(event_id,recipient);

-- Audit writes are server-only: clients cannot forge RESEND/SENT acknowledgments.
ALTER TABLE public.notification_dispatch_logs ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='notification_dispatch_logs' LOOP
    EXECUTE format('DROP POLICY %I ON public.notification_dispatch_logs',p.policyname);
  END LOOP;
END $$;
CREATE POLICY "Read own actual dispatches" ON public.notification_dispatch_logs FOR SELECT TO authenticated USING ((SELECT auth.uid())=user_id);
REVOKE ALL ON public.notification_dispatch_logs FROM anon,authenticated;
GRANT SELECT ON public.notification_dispatch_logs TO authenticated;
GRANT ALL ON public.notification_dispatch_logs TO service_role;
GRANT SELECT,INSERT ON public.acoustic_event_logs TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.emergency_contacts TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_critical_acoustic_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.risk_level='CRITICAL' AND NEW.confidence>0.80 AND NEW.user_id IS NOT NULL THEN
    INSERT INTO public.notification_dispatch_logs(event_id,user_id,contact_id,dispatch_type,recipient,status,payload,dispatch_key)
    SELECT NEW.id,NEW.user_id,c.id,'RESEND',c.email,'PENDING',jsonb_build_object('contact_id',c.id,'sound_label',NEW.sound_label),NEW.id::text||':'||c.id::text
    FROM public.emergency_contacts c WHERE c.user_id=NEW.user_id AND c.is_active=true
    ON CONFLICT(dispatch_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_critical_acoustic_event() FROM PUBLIC,anon,authenticated;

-- Serializes queue creation per event and adopts pre-existing pending rows.
CREATE OR REPLACE FUNCTION public.claim_emergency_dispatch(p_event_id uuid,p_contact_id uuid,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.acoustic_event_logs; c public.emergency_contacts; n public.notification_dispatch_logs; k text;
BEGIN
  SELECT * INTO e FROM public.acoustic_event_logs WHERE id=p_event_id AND user_id=p_user_id AND risk_level='CRITICAL' AND confidence>0.80 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owned classified critical event required'; END IF;
  SELECT * INTO c FROM public.emergency_contacts WHERE id=p_contact_id AND user_id=p_user_id AND is_active=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Owned active contact required'; END IF;
  k:=e.id::text||':'||c.id::text;
  SELECT * INTO n FROM public.notification_dispatch_logs
  WHERE dispatch_key=k OR (event_id=e.id AND user_id=e.user_id AND recipient=c.email AND dispatch_key IS NULL)
  ORDER BY (dispatch_key=k) DESC NULLS LAST, (status::text='SENT' AND dispatch_type='RESEND') DESC, sent_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.notification_dispatch_logs SET dispatch_key=k,contact_id=c.id WHERE id=n.id RETURNING * INTO n;
  ELSE
    INSERT INTO public.notification_dispatch_logs(event_id,user_id,contact_id,dispatch_type,recipient,status,payload,dispatch_key)
    VALUES(e.id,e.user_id,c.id,'RESEND',c.email,'PENDING',jsonb_build_object('contact_id',c.id),k) RETURNING * INTO n;
  END IF;
  RETURN to_jsonb(n);
END $$;
REVOKE ALL ON FUNCTION public.claim_emergency_dispatch(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_emergency_dispatch(uuid,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
