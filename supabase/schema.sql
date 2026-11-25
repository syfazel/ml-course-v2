--
-- PostgreSQL database dump
--

\restrict 9RkYeXCILtR2KlaGgxF92KRVcamcHSszoX1TZAWIMtxbaH6bHAR4BQqI1ajwE2b

-- Dumped from database version 17.12
-- Dumped by pg_dump version 17.12 (Debian 17.12-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: current_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select role
  from public.members
  where auth_id = auth.uid()
  limit 1;
$$;


--
-- Name: is_student(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_student() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.members
    where auth_id = auth.uid()
      and role = 'student'
  );
$$;


--
-- Name: is_teacher(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_teacher() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
    from public.members
    where auth_id = auth.uid()
      and role = 'teacher'
  );
$$;


--
-- Name: log_audit_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_audit_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row jsonb;
  v_target_id text;
  v_actor_id uuid := auth.uid();
  v_actor_role text;
begin
  -- جلوگیری از حلقه بی‌نهایت در صورت فراخوانی روی INSERT جدول audit_logs
  if TG_TABLE_NAME = 'audit_logs' and TG_OP = 'INSERT' then
    return null;
  end if;

  v_row := case
    when TG_OP = 'DELETE' then to_jsonb(OLD)
    else to_jsonb(NEW)
  end;

  v_target_id := v_row ->> 'id';

  if v_actor_id is not null then
    v_actor_role := coalesce(public.current_user_role(), 'authenticated');
  else
    v_actor_role := current_user;
  end if;

  insert into public.audit_logs (
    actor_id,
    actor_role,
    action,
    target_table,
    target_id,
    meta
  ) values (
    v_actor_id,
    v_actor_role,
    'trg_' || lower(TG_OP),
    TG_TABLE_NAME,
    v_target_id,
    jsonb_build_object(
      'op', TG_OP,
      'source', 'trigger',
      'unit_code', v_row ->> 'unit_code',
      'quiz_code', v_row ->> 'quiz_code',
      'lab_code', v_row ->> 'lab_code'
    )
  );

  return null;
end;
$$;


--
-- Name: submit_quiz_attempt(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_quiz_attempt(p_quiz_code text, p_answers jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_total int := 0;
  v_correct int := 0;
  v_attempt int := 1;
  v_score numeric(6,3);
  v_passed boolean;
  v_rec record;
  v_selected int;
  v_attempt_id uuid;
begin
  if not public.is_student() then
    raise exception 'فقط شاگرد می‌تواند آزمون را ثبت کند.';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    raise exception 'ساختار پاسخ‌ها باید آرایه JSON باشد.';
  end if;

  select count(*) into v_total
  from public.quiz_answer_keys
  where quiz_code = p_quiz_code;

  if v_total = 0 then
    raise exception 'کلید آزمون یافت نشد: %', p_quiz_code;
  end if;

  select coalesce(max(attempt_no), 0) + 1 into v_attempt
  from public.quiz_answers
  where user_id = v_uid and quiz_code = p_quiz_code;

  for v_rec in
    select question_index, correct_option, concept_tag
    from public.quiz_answer_keys
    where quiz_code = p_quiz_code
    order by question_index
  loop
    v_selected := (p_answers ->> (v_rec.question_index - 1))::int;
    if v_selected is not null and v_selected = v_rec.correct_option then
      v_correct := v_correct + 1;
    else
      insert into public.mistakes (user_id, quiz_code, question_index, selected_option, concept_tag)
      values (v_uid, p_quiz_code, v_rec.question_index, coalesce(v_selected, -1), v_rec.concept_tag);
    end if;
  end loop;

  v_score := round((v_correct::numeric * 100.0) / v_total::numeric, 3);
  v_passed := (v_score >= 60.0);

  insert into public.quiz_answers (
    user_id, quiz_code, attempt_no, answers, correct_count, total_questions, score_percent, passed_gate
  ) values (
    v_uid, p_quiz_code, v_attempt, p_answers, v_correct, v_total, v_score, v_passed
  ) returning id into v_attempt_id;

  insert into public.audit_logs (actor_id, actor_role, action, target_table, target_id, meta)
  values (
    v_uid, 'student', 'quiz_submitted', 'quiz_answers', v_attempt_id::text,
    jsonb_build_object('quiz_code', p_quiz_code, 'score_percent', v_score, 'passed_gate', v_passed)
  );

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'attempt_no', v_attempt,
    'correct_count', v_correct,
    'total_questions', v_total,
    'score_percent', v_score,
    'passed_gate', v_passed
  );
end;
$$;


--
-- Name: verify_studio_ticket(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_studio_ticket(p_ticket_hash text) RETURNS TABLE(valid boolean, user_id uuid, role text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row public.studio_tickets%rowtype;
begin
  update public.studio_tickets
     set used_at = now()
   where ticket_hash = p_ticket_hash
     and used_at is null
     and expires_at > now()
  returning * into v_row;

  if found then
    return query select true, v_row.user_id, v_row.role;
  else
    return query select false, null::uuid, null::text;
  end if;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid,
    actor_role text,
    action text NOT NULL,
    target_table text,
    target_id text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: day_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    unit_code text NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    completed_steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    score_exact numeric(6,3),
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT day_progress_status_check CHECK ((status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'completed'::text])))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    unit_code text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lab_notebooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lab_notebooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    lab_code text NOT NULL,
    cells jsonb DEFAULT '[]'::jsonb NOT NULL,
    storage_path text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lab_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lab_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notebook_id uuid NOT NULL,
    student_id uuid NOT NULL,
    teacher_id uuid NOT NULL,
    status text DEFAULT 'reviewed'::text NOT NULL,
    feedback text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_reviews_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'needs_revision'::text])))
);


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    auth_id uuid NOT NULL,
    role text NOT NULL,
    display_name text NOT NULL,
    username text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT members_role_check CHECK ((role = ANY (ARRAY['teacher'::text, 'student'::text])))
);


--
-- Name: mistakes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mistakes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    quiz_code text NOT NULL,
    question_index integer NOT NULL,
    selected_option integer NOT NULL,
    concept_tag text,
    reviewed boolean DEFAULT false NOT NULL,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: quiz_answer_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_answer_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quiz_code text NOT NULL,
    question_index integer NOT NULL,
    correct_option integer NOT NULL,
    concept_tag text,
    teacher_note text,
    explanations jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quiz_answer_keys_correct_option_check CHECK (((correct_option >= 0) AND (correct_option <= 3))),
    CONSTRAINT quiz_answer_keys_question_index_check CHECK ((question_index >= 1))
);


--
-- Name: quiz_answers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quiz_answers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    quiz_code text NOT NULL,
    attempt_no integer DEFAULT 1 NOT NULL,
    answers jsonb NOT NULL,
    correct_count integer DEFAULT 0 NOT NULL,
    total_questions integer NOT NULL,
    score_percent numeric(6,3) NOT NULL,
    passed_gate boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT quiz_answers_attempt_no_check CHECK ((attempt_no >= 1)),
    CONSTRAINT quiz_answers_total_questions_check CHECK ((total_questions > 0))
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope text NOT NULL,
    user_id uuid,
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT settings_check CHECK ((((scope = 'global'::text) AND (user_id IS NULL)) OR ((scope = 'personal'::text) AND (user_id IS NOT NULL)))),
    CONSTRAINT settings_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'personal'::text])))
);


--
-- Name: studio_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.studio_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_hash text NOT NULL,
    user_id uuid NOT NULL,
    user_email text NOT NULL,
    role text NOT NULL,
    codespace_name text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT studio_tickets_role_check CHECK ((role = ANY (ARRAY['teacher'::text, 'student'::text])))
);


--
-- Name: teach_backs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teach_backs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    unit_code text NOT NULL,
    content text NOT NULL,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: day_progress day_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_progress
    ADD CONSTRAINT day_progress_pkey PRIMARY KEY (id);


--
-- Name: day_progress day_progress_user_id_unit_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_progress
    ADD CONSTRAINT day_progress_user_id_unit_code_key UNIQUE (user_id, unit_code);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: lab_notebooks lab_notebooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_notebooks
    ADD CONSTRAINT lab_notebooks_pkey PRIMARY KEY (id);


--
-- Name: lab_reviews lab_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_reviews
    ADD CONSTRAINT lab_reviews_pkey PRIMARY KEY (id);


--
-- Name: members members_auth_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_auth_id_key UNIQUE (auth_id);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);


--
-- Name: mistakes mistakes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mistakes
    ADD CONSTRAINT mistakes_pkey PRIMARY KEY (id);


--
-- Name: quiz_answer_keys quiz_answer_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answer_keys
    ADD CONSTRAINT quiz_answer_keys_pkey PRIMARY KEY (id);


--
-- Name: quiz_answer_keys quiz_answer_keys_quiz_code_question_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answer_keys
    ADD CONSTRAINT quiz_answer_keys_quiz_code_question_index_key UNIQUE (quiz_code, question_index);


--
-- Name: quiz_answers quiz_answers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers
    ADD CONSTRAINT quiz_answers_pkey PRIMARY KEY (id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: settings settings_scope_user_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_scope_user_id_key_key UNIQUE (scope, user_id, key);


--
-- Name: studio_tickets studio_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_tickets
    ADD CONSTRAINT studio_tickets_pkey PRIMARY KEY (id);


--
-- Name: studio_tickets studio_tickets_ticket_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.studio_tickets
    ADD CONSTRAINT studio_tickets_ticket_hash_key UNIQUE (ticket_hash);


--
-- Name: teach_backs teach_backs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teach_backs
    ADD CONSTRAINT teach_backs_pkey PRIMARY KEY (id);


--
-- Name: studio_tickets_expires_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX studio_tickets_expires_at_idx ON public.studio_tickets USING btree (expires_at);


--
-- Name: audit_logs trg_audit_audit_logs_tamper; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_audit_logs_tamper AFTER DELETE OR UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: day_progress trg_audit_day_progress; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_day_progress AFTER INSERT OR DELETE OR UPDATE ON public.day_progress FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: events trg_audit_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_events AFTER INSERT OR DELETE OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: lab_notebooks trg_audit_lab_notebooks; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_lab_notebooks AFTER INSERT OR DELETE OR UPDATE ON public.lab_notebooks FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: lab_reviews trg_audit_lab_reviews; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_lab_reviews AFTER INSERT OR DELETE OR UPDATE ON public.lab_reviews FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: members trg_audit_members; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_members AFTER INSERT OR DELETE OR UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: mistakes trg_audit_mistakes; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_mistakes AFTER INSERT OR DELETE OR UPDATE ON public.mistakes FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: quiz_answer_keys trg_audit_quiz_answer_keys; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_quiz_answer_keys AFTER INSERT OR DELETE OR UPDATE ON public.quiz_answer_keys FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: quiz_answers trg_audit_quiz_answers; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_quiz_answers AFTER INSERT OR DELETE OR UPDATE ON public.quiz_answers FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: settings trg_audit_settings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_settings AFTER INSERT OR DELETE OR UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: teach_backs trg_audit_teach_backs; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_teach_backs AFTER INSERT OR DELETE OR UPDATE ON public.teach_backs FOR EACH ROW EXECUTE FUNCTION public.log_audit_event();


--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: day_progress day_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_progress
    ADD CONSTRAINT day_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: events events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: lab_notebooks lab_notebooks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_notebooks
    ADD CONSTRAINT lab_notebooks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: lab_reviews lab_reviews_notebook_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_reviews
    ADD CONSTRAINT lab_reviews_notebook_id_fkey FOREIGN KEY (notebook_id) REFERENCES public.lab_notebooks(id) ON DELETE CASCADE;


--
-- Name: lab_reviews lab_reviews_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_reviews
    ADD CONSTRAINT lab_reviews_student_id_fkey FOREIGN KEY (student_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: lab_reviews lab_reviews_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lab_reviews
    ADD CONSTRAINT lab_reviews_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: members members_auth_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_auth_id_fkey FOREIGN KEY (auth_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mistakes mistakes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mistakes
    ADD CONSTRAINT mistakes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: quiz_answers quiz_answers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quiz_answers
    ADD CONSTRAINT quiz_answers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: settings settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: teach_backs teach_backs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teach_backs
    ADD CONSTRAINT teach_backs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: day_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.day_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: lab_notebooks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lab_notebooks ENABLE ROW LEVEL SECURITY;

--
-- Name: lab_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lab_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

--
-- Name: mistakes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mistakes ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs ml audit_logs select teacher; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml audit_logs select teacher" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_teacher());


--
-- Name: day_progress ml day_progress insert student; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml day_progress insert student" ON public.day_progress FOR INSERT TO authenticated WITH CHECK ((public.is_student() AND (user_id = auth.uid())));


--
-- Name: day_progress ml day_progress select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml day_progress select" ON public.day_progress FOR SELECT TO authenticated USING ((public.is_teacher() OR (user_id = auth.uid())));


--
-- Name: day_progress ml day_progress update student; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml day_progress update student" ON public.day_progress FOR UPDATE TO authenticated USING ((public.is_student() AND (user_id = auth.uid()))) WITH CHECK ((public.is_student() AND (user_id = auth.uid())));


--
-- Name: events ml events insert student; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml events insert student" ON public.events FOR INSERT TO authenticated WITH CHECK ((public.is_student() AND (user_id = auth.uid())));


--
-- Name: events ml events select teacher; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml events select teacher" ON public.events FOR SELECT TO authenticated USING (public.is_teacher());


--
-- Name: lab_notebooks ml lab_notebooks insert student; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml lab_notebooks insert student" ON public.lab_notebooks FOR INSERT TO authenticated WITH CHECK ((public.is_student() AND (user_id = auth.uid())));


--
-- Name: lab_notebooks ml lab_notebooks select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml lab_notebooks select" ON public.lab_notebooks FOR SELECT TO authenticated USING ((public.is_teacher() OR (user_id = auth.uid())));


--
-- Name: lab_notebooks ml lab_notebooks update student; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml lab_notebooks update student" ON public.lab_notebooks FOR UPDATE TO authenticated USING ((public.is_student() AND (user_id = auth.uid()))) WITH CHECK ((public.is_student() AND (user_id = auth.uid())));


--
-- Name: lab_reviews ml lab_reviews insert teacher; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml lab_reviews insert teacher" ON public.lab_reviews FOR INSERT TO authenticated WITH CHECK ((public.is_teacher() AND (teacher_id = auth.uid())));


--
-- Name: lab_reviews ml lab_reviews select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml lab_reviews select" ON public.lab_reviews FOR SELECT TO authenticated USING ((public.is_teacher() OR (student_id = auth.uid())));


--
-- Name: lab_reviews ml lab_reviews update teacher; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml lab_reviews update teacher" ON public.lab_reviews FOR UPDATE TO authenticated USING ((public.is_teacher() AND (teacher_id = auth.uid()))) WITH CHECK ((public.is_teacher() AND (teacher_id = auth.uid())));


--
-- Name: members ml members select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml members select" ON public.members FOR SELECT TO authenticated USING ((public.is_teacher() OR (auth_id = auth.uid())));


--
-- Name: members ml members update own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml members update own" ON public.members FOR UPDATE TO authenticated USING ((auth_id = auth.uid())) WITH CHECK (((auth_id = auth.uid()) AND (role = public.current_user_role())));


--
-- Name: mistakes ml mistakes select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml mistakes select" ON public.mistakes FOR SELECT TO authenticated USING ((public.is_teacher() OR (user_id = auth.uid())));


--
-- Name: mistakes ml mistakes update student; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml mistakes update student" ON public.mistakes FOR UPDATE TO authenticated USING ((public.is_student() AND (user_id = auth.uid()))) WITH CHECK ((public.is_student() AND (user_id = auth.uid())));


--
-- Name: quiz_answers ml quiz_answers select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml quiz_answers select" ON public.quiz_answers FOR SELECT TO authenticated USING ((public.is_teacher() OR (user_id = auth.uid())));


--
-- Name: quiz_answer_keys ml quiz_keys teacher all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml quiz_keys teacher all" ON public.quiz_answer_keys TO authenticated USING (public.is_teacher()) WITH CHECK (public.is_teacher());


--
-- Name: settings ml settings insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml settings insert" ON public.settings FOR INSERT TO authenticated WITH CHECK (((public.is_teacher() AND ((scope = 'global'::text) OR (user_id = auth.uid()))) OR (public.is_student() AND (scope = 'personal'::text) AND (user_id = auth.uid()))));


--
-- Name: settings ml settings select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml settings select" ON public.settings FOR SELECT TO authenticated USING ((public.is_teacher() OR (scope = 'global'::text) OR (user_id = auth.uid())));


--
-- Name: settings ml settings update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml settings update" ON public.settings FOR UPDATE TO authenticated USING (((public.is_teacher() AND ((scope = 'global'::text) OR (user_id = auth.uid()))) OR (public.is_student() AND (scope = 'personal'::text) AND (user_id = auth.uid())))) WITH CHECK (((public.is_teacher() AND ((scope = 'global'::text) OR (user_id = auth.uid()))) OR (public.is_student() AND (scope = 'personal'::text) AND (user_id = auth.uid()))));


--
-- Name: teach_backs ml teach_backs insert student; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml teach_backs insert student" ON public.teach_backs FOR INSERT TO authenticated WITH CHECK ((public.is_student() AND (user_id = auth.uid())));


--
-- Name: teach_backs ml teach_backs select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml teach_backs select" ON public.teach_backs FOR SELECT TO authenticated USING ((public.is_teacher() OR (user_id = auth.uid())));


--
-- Name: teach_backs ml teach_backs update student; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "ml teach_backs update student" ON public.teach_backs FOR UPDATE TO authenticated USING ((public.is_student() AND (user_id = auth.uid()))) WITH CHECK ((public.is_student() AND (user_id = auth.uid())));


--
-- Name: quiz_answer_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quiz_answer_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: quiz_answers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quiz_answers ENABLE ROW LEVEL SECURITY;

--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: studio_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.studio_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: teach_backs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teach_backs ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION current_user_role(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
GRANT ALL ON FUNCTION public.current_user_role() TO authenticated;


--
-- Name: FUNCTION is_student(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_student() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_student() TO authenticated;


--
-- Name: FUNCTION is_teacher(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_teacher() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_teacher() TO authenticated;


--
-- Name: FUNCTION log_audit_event(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_audit_event() FROM PUBLIC;


--
-- Name: FUNCTION submit_quiz_attempt(p_quiz_code text, p_answers jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_quiz_attempt(p_quiz_code text, p_answers jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_quiz_attempt(p_quiz_code text, p_answers jsonb) TO authenticated;


--
-- Name: FUNCTION verify_studio_ticket(p_ticket_hash text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.verify_studio_ticket(p_ticket_hash text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.verify_studio_ticket(p_ticket_hash text) TO anon;
GRANT ALL ON FUNCTION public.verify_studio_ticket(p_ticket_hash text) TO authenticated;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.audit_logs TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.audit_logs TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE day_progress; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.day_progress TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.day_progress TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.day_progress TO service_role;


--
-- Name: TABLE events; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.events TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.events TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.events TO service_role;


--
-- Name: TABLE lab_notebooks; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lab_notebooks TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lab_notebooks TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lab_notebooks TO service_role;


--
-- Name: TABLE lab_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lab_reviews TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lab_reviews TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.lab_reviews TO service_role;


--
-- Name: TABLE members; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.members TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.members TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.members TO service_role;


--
-- Name: TABLE mistakes; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.mistakes TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.mistakes TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.mistakes TO service_role;


--
-- Name: TABLE quiz_answer_keys; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.quiz_answer_keys TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.quiz_answer_keys TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.quiz_answer_keys TO service_role;


--
-- Name: TABLE quiz_answers; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.quiz_answers TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.quiz_answers TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.quiz_answers TO service_role;


--
-- Name: TABLE settings; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.settings TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.settings TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.settings TO service_role;


--
-- Name: TABLE studio_tickets; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.studio_tickets TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.studio_tickets TO authenticated;
GRANT ALL ON TABLE public.studio_tickets TO service_role;


--
-- Name: TABLE teach_backs; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.teach_backs TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.teach_backs TO authenticated;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.teach_backs TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict 9RkYeXCILtR2KlaGgxF92KRVcamcHSszoX1TZAWIMtxbaH6bHAR4BQqI1ajwE2b

