export const MESSAGE_TYPES = Object.freeze({
  EXTRACT_CURRENT_JOB: "EXTRACT_CURRENT_JOB",
  EXTRACT_SELECTED_TEXT: "EXTRACT_SELECTED_TEXT",
  GET_ACTIVE_TAB: "GET_ACTIVE_TAB"
});

export const USER_MESSAGES = Object.freeze({
  UNSUPPORTED_PAGE: "Chrome does not allow this extension to read the current page. Open a normal job-posting webpage and try again.",
  SELECTION_EMPTY: "No meaningful text is selected. Highlight the job description on the page and try again.",
  LOW_CONFIDENCE: "The extension could not confidently identify all job fields. Review the highlighted fields before saving.",
  CONFIGURATION_MISSING: "Supabase is not configured. Open Settings and add the project URL and publishable key.",
  DUPLICATE: "This job URL is already saved in Supabase.",
  NETWORK_ERROR: "The extension could not reach Supabase. Check your connection and project status."
});
