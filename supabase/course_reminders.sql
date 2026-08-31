CREATE TABLE public.course_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  enrollment_id UUID REFERENCES public.course_enrollments(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  reminder_type VARCHAR(30) DEFAULT 'completion',
  message TEXT,
  is_sent BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ,
  snoozed_until TIMESTAMPTZ,
  snoozed_count INT DEFAULT 0,
  admin_banner_id UUID REFERENCES public.admin_banners(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.course_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own reminders" ON public.course_reminders
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own reminders" ON public.course_reminders
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role full access" ON public.course_reminders
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX idx_course_reminders_user_id ON public.course_reminders(user_id);
CREATE INDEX idx_course_reminders_enrollment_id ON public.course_reminders(enrollment_id);
CREATE INDEX idx_course_reminders_course_id ON public.course_reminders(course_id);
CREATE INDEX idx_course_reminders_snoozed_until ON public.course_reminders(snoozed_until);
CREATE INDEX idx_course_reminders_is_sent ON public.course_reminders(is_sent);
