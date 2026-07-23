# Security model

Supabase Auth JWTs and RLS are the authorization boundary. The extension stores only the standard project URL, a public client key, matching preferences, and the persisted user session in `chrome.storage.local`. It never accepts a service-role key or database password.

Every private table enables RLS and restricts rows to `auth.uid()`. Queue policies and triggers verify ownership of both referenced records. Resume buckets are private, and Storage policies restrict the first object-path segment to the authenticated user ID. Original uploads use unique paths and never overwrite.

Job-page scripts receive no Supabase configuration, token, resume, or database record. Extraction runs only after a user action. Arbitrary website access is optional; Supabase access is limited to standard `*.supabase.co` projects. Runtime code is locally bundled, and untrusted text is rendered through text nodes.

Do not log or share session tokens, full resumes, full JDs, private object paths, client error payloads, or browser storage exports. A publishable/anon key is expected in a public client; RLS must remain enabled. If a privileged key is exposed, rotate it immediately and inspect project logs.
