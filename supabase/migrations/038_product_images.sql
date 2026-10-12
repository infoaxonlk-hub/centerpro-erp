begin;
-- Optional product photos, private and restricted to the existing organization.
alter table public.products add column if not exists image_path text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-images','product-images',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
drop policy if exists product_images_read on storage.objects;
create policy product_images_read on storage.objects for select to authenticated using (
 bucket_id='product-images' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.organization_id::text=(storage.foldername(name))[1])
);
drop policy if exists product_images_insert on storage.objects;
create policy product_images_insert on storage.objects for insert to authenticated with check (
 bucket_id='product-images' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.organization_id::text=(storage.foldername(name))[1])
 and public.has_permission('masters') and public.has_permission('product_edit')
);
drop policy if exists product_images_delete on storage.objects;
create policy product_images_delete on storage.objects for delete to authenticated using (
 bucket_id='product-images' and exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active and p.organization_id::text=(storage.foldername(name))[1])
 and public.has_permission('masters') and public.has_permission('product_edit')
);

commit;
