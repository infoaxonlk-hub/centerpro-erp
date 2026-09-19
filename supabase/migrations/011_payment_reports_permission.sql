-- Give existing payment/cash users access to the new report module.
update public.profiles
set permissions=array_append(permissions,'payment_reports')
where is_active
  and ('cash'=any(permissions) or role in ('super_admin','admin'))
  and not ('payment_reports'=any(permissions));
