-- Prevent application roles from moving a global baseline into a local workspace.
-- Both old and new ownership matter on UPDATE; DELETE checks the old row.
CREATE OR REPLACE FUNCTION public.workloom_fence_baseline_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user IN ('workloom_app', 'workloom_gateway') THEN
    IF TG_OP <> 'INSERT' AND OLD.workspace_id = '*' THEN
      RAISE EXCEPTION 'Global baseline mutation requires the administrative owner channel'
        USING ERRCODE = '42501';
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.workspace_id = '*' THEN
      RAISE EXCEPTION 'Global baseline creation requires the administrative owner channel'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- Global revocation is an administrative kill switch. An application credential
-- or a caller-supplied member identifier must never grant global authority.
ALTER FUNCTION public.skill_revoke(text, text, text) SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.skill_revoke(text, text, text)
  FROM PUBLIC, workloom_app, workloom_gateway;
REVOKE INSERT, UPDATE, DELETE ON public.skill_revocations
  FROM workloom_app, workloom_gateway;
