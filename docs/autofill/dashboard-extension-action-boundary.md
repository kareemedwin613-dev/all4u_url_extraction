# Dashboard and extension action boundary

The dashboard manages Application records, assignments, status, URLs, and reporting. It does not display **Load Resume** or **Autofill** buttons.

Appliers start those browser-page operations from **My Applications** in the Chrome extension. This avoids duplicate controls and keeps tab access, Resume bytes, field detection, Resume attachment, and Autofill results inside the browser extension boundary.

The authenticated backend remains responsible for authorizing and creating short-lived Application extension sessions. Removing the dashboard buttons does not weaken backend authorization or change private Resume Storage access.
