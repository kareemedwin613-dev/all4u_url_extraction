# Backend API v0.7.4

The bulk workflow is `React -> NestJS JWT/role guards -> user-scoped Supabase client -> authorized RPC -> RLS-protected tables`.

`ApplicationBatchesModule` owns DTO validation, mapping, timeouts, throttles, safe errors, count logging, and OpenAPI metadata. Migration `202607270020_v0_7_4_bulk_backend_api.sql` adds durable idempotency and bounded batch list/detail/result RPCs while preserving set-based preview and creation.

Normal requests use only the publishable/anon key plus the verified caller token. There is no service-role client.
