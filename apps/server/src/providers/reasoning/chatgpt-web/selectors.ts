/**
 * Layered, semantic selectors for ChatGPT Web (chatgpt.com).
 * Prioritizes accessibility roles, stable ARIA labels, and data-testids over transient CSS class names.
 */

export const SELECTORS = {
  // Input composer
  composer: [
    "#prompt-textarea",
    "div[contenteditable='true'][id*='prompt']",
    "div[contenteditable='true'][tabindex='0']",
    "textarea[tabindex='0']",
    "textarea[data-id='root']",
    "div[data-placeholder]",
    "textarea",
  ],

  // Send action button
  sendButton: [
    "button[data-testid='send-button']",
    "button[aria-label*='Send prompt']",
    "button[aria-label*='Send message']",
    "button[aria-label*='Send']",
    "button[aria-label*='Submit']",
  ],

  // Stop generation button
  stopButton: [
    "button[data-testid='stop-button']",
    "button[aria-label*='Stop generating']",
    "button[aria-label*='Stop']",
    "button:has-text('Stop generating')",
  ],

  // File upload input
  fileInput: [
    "input[type='file']",
    "input[type='file'][tabindex='-1']",
    "input[type='file'][multiple]",
  ],

  // Attachment chip / upload completion marker in composer
  attachmentChip: [
    "[data-testid*='attachment']",
    "[data-testid*='file']",
    "[aria-label*='Remove attachment']",
    "div:has(> button[aria-label*='Remove'])",
  ],

  // User messages
  userMessage: [
    "[data-message-author-role='user']",
    "article:has([data-message-author-role='user'])",
    "div[data-testid*='conversation-turn']:has([data-message-author-role='user'])",
    ".user-turn",
  ],

  // Assistant messages
  assistantMessage: [
    "[data-message-author-role='assistant']",
    "article:has([data-message-author-role='assistant'])",
    "div[data-testid*='conversation-turn']:has([data-message-author-role='assistant'])",
    ".agent-turn",
  ],

  // Authentication indicators (unauthenticated)
  loginButton: [
    "a[href*='/auth/login']",
    "button[data-testid='login-button']",
    "button:has-text('Log in')",
    "a:has-text('Log in')",
    "button:has-text('Sign up')",
  ],

  // Authenticated user profile / workspace marker
  userProfile: [
    "button[data-testid='profile-button']",
    "button[aria-label*='User profile']",
    "button[aria-label*='Open profile']",
    "button[aria-label*='Open user menu']",
    "nav[aria-label*='Chat history']",
  ],

  // Challenge / CAPTCHA indicators
  challenge: [
    "iframe[src*='challenges.cloudflare.com']",
    "#challenge-running",
    "text='Verify you are human'",
    "text='Checking your browser'",
    "text='Just a moment...'",
  ],

  // Page error banners
  errorBanner: [
    "[role='alert']",
    ".text-token-text-error",
    "div:has-text('An error occurred')",
    "div:has-text('Something went wrong')",
    "div:has-text('Too many requests')",
  ],

  // New chat button
  newChatButton: [
    "a[href='/']",
    "button[aria-label*='New chat']",
    "button:has-text('New chat')",
    "a[data-testid*='new-chat']",
  ],
};
