-- Raise the request limit without replacing deployed lifecycle logic or grants.
-- This does not change statement timeouts or make batch preparation asynchronous.
do $$
declare target text; definition text;
begin
  foreach target in array array['public.create_tailoring_batch_v21(uuid[],text)',
                               'public.create_tailoring_batch_v32(uuid[],text)'] loop
    definition := pg_get_functiondef(target::regprocedure);
    if position('not between 1 and 500' in definition)>0
       and position('Select between 1 and 500 Applications.' in definition)>0 then
      definition := replace(definition,'not between 1 and 500','not between 1 and 1000');
      definition := replace(definition,'Select between 1 and 500 Applications.','Select between 1 and 1000 Applications.');
      execute definition;
    elsif position('not between 1 and 1000' in definition)=0
       or position('Select between 1 and 1000 Applications.' in definition)=0 then
      raise exception 'Unexpected tailoring batch limit definition: %',target;
    end if;
  end loop;
end $$;
