-- Permitir que admins vejam todos os perfis
create policy "Admins can view all profiles"
on public.profiles
for select
to authenticated
using (has_role(auth.uid(), 'admin'));