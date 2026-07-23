# Chrome setup

1. Run `npm install` and `npm run build`.
2. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
3. Select `extension/dist`—not the source directory.
4. Pin the extension if desired, open its side panel, configure Supabase, and sign in.
5. Accept the requested site-access permission. The extension needs **On all sites** access so extraction works on job postings without a prompt for each origin.

After source changes, rebuild, click **Reload** on the extension card, and refresh any job page being tested.
