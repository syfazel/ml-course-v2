# اسکیمای دیتابیس دورهٔ ML در گیت (پیشنهاد ۴)

<div dir="rtl">

## این فایل چیست

`schema.sql` مرجعِ **بازسازی از صفر** اسکیمای زندهٔ پروژهٔ Supabase
`ml-course-v2` است — فقط ساختار، بدون هیچ ردیف داده. وقتی ساخته شد، با این
دستور ساخته شده است (اسکریپت `scripts/dump-schema.sh`):

```bash
SUPABASE_DB_PASSWORD='<db password>' bash scripts/dump-schema.sh
```

رمز فقط از متغیر محیطی خوانده می‌شود و هرگز در فایل، چت یا لاگ نمی‌آید؛
همان راز ورک‌فلوی بکاپ (`SUPABASE_DB_PASSWORD`) است — گرفتن دامپ وابسته به
پیشنهاد ۱ است.

## قاعدهٔ تغییر

این فایل **منبع اعمال تغییر نیست**؛ مرجع بازسازی است. تغییر بعدی اسکیما فقط
با مایگریشن در گیت انجام می‌شود، زیر `supabase/migrations/` با شمارهٔ
ادامه‌دار **۰۰۳** به بعد. مایگریشن‌های ۰۰۱ و ۰۰۲
(`001_studio_tickets.sql`، `002_grants.sql`) در ریپوی پایلوت
(`jarvis-studio-pilot/supabase/migrations/`) می‌مانند، چون بلیط‌ها را
گیت‌وی مصرف می‌کند.

## محتوای مورد انتظار دامپ

**باید شامل باشد:**

- هر ۱۲ جدول اسکیمای `public` (با ستون‌ها، قیدها، ایندکس‌ها):
  `members`، `day_progress`، `quiz_answers`، `mistakes`، `events`،
  `audit_logs`، `lab_notebooks`، `quiz_answer_keys`، `studio_tickets`،
  `lab_reviews`، `settings`، `teach_backs`
- هر ۶ تابع: `submit_quiz_attempt` و `verify_studio_ticket` (دو RPC) +
  سه کمکی RLS (`is_teacher`، `is_student`، `current_user_role`) + یک
  trigger (`log_audit_event`)
- همهٔ `CREATE POLICY`ها (RLS) و همهٔ `GRANT`ها — GRANTها بخشی از مدل
  دسترسی‌اند و نگه داشته می‌شوند.

**نباید شامل باشد:**

- هیچ `COPY` یا `INSERT` داده‌ای، هیچ رمز/کلیدی، هیچ‌چیز از `auth.users`
  (با `--schema=public` خودبه‌خود بیرون است).

## راستی‌آزمایی

اجرای `schema.sql` روی یک Postgres خالی باید بدون خطا هر ۱۲ جدول و هر ۶ تابع
را بسازد. این چک را می‌توان با ورک‌فلوی `restore-test.yml` ترکیب کرد
(همان جاب، بعد از restore دامپ).

</div>
