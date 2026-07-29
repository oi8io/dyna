import type { Dictionary } from "@/lib/i18n/dictionary";

/**
 * English copy. Typed against the reference dictionary, so a key that is added
 * to `zh-CN` and forgotten here fails the type check rather than rendering
 * blank.
 */
export const en: Dictionary = {
  common: {
    loading: "Loading…",
    save: "Save",
    unknownAccount: "Unknown account",
    remixable: "Remixable",
    playOnly: "Play only",
    language: "Language",
  },

  nav: {
    gallery: "Gallery",
    how: "How it works",
    workbench: "Open workbench",
    signIn: "Sign in",
    projects: "Projects",
    published: "Published",
    usage: "Credits & usage",
    newProject: "New project",
    recent: "Recent",
    collapse: "Collapse sidebar",
    expand: "Expand sidebar",
  },

  metadata: {
    title: "Dyna Studio — describe it, then play it",
    description:
      "Describe your idea and Dyna Studio writes a real frontend project and builds it. Play it immediately, keep changing it, then share the link.",
    login: "Sign in",
    published: "Published",
    usage: "Credits & usage",
    work: "Work",
  },

  home: {
    headlineTop: "Turn the idea in your head",
    headlineBottom: "into something you can play",
    subtitle:
      "Write one sentence. Dyna produces a real frontend project and builds it, so you can play it right away, keep changing it, and send the link to anyone.",
    promptLabel: "Describe what you want to build",
    promptHint: "Lightweight 2D single-player games · no assets to upload",
    start: "Start building",
    examples: [
      "A neon breakout game with combo multipliers and particle effects",
      "2048, but the numbers are planets of increasing size",
      "A reflex game: dodge the red squares and survive 30 seconds",
    ],
    galleryTitle: "What people have made",
    gallerySubtitle:
      "Open one to play it. Anything the author opened up can be remixed into your own.",
    howTitle: "How it works",
    steps: [
      {
        title: "Describe what you want",
        text: "Plain language about the gameplay or the look. No technical terms needed.",
      },
      {
        title: "Get a real project",
        text: "You get complete React / TypeScript source. It only counts once it passes type checking and a production build.",
      },
      {
        title: "Play, adjust, share",
        text: "Play it the moment it's done. Not right? Just say so. Happy with it? Publish it as a link.",
      },
    ],
    enterWorkbench: "Open my workbench",
    signInToStart: "Sign in to start",
  },

  login: {
    title: "Sign in to start building",
    subtitle:
      "Your projects, conversations, source and runnable versions all live in your account.",
    footnote: "Your work is saved to your account once you sign in",
    google: "Sign in with Google",
    orEmail: "or use email",
    sendLink: "Send sign-in link",
    linkSent: "Sign-in link sent. Check your inbox, and your spam folder.",
  },

  gallery: {
    empty:
      "Nobody has published anything yet. Make something, hit publish, and it shows up here.",
    remix: "Remix this",
    remixing: "Copying…",
  },

  projects: {
    title: "My projects",
    subtitle: "Unpublished projects are entirely private. Only you can see them.",
    emptyTitle: "Nothing here yet",
    emptyText:
      "Describe the gameplay, the look and the win condition, and Dyna will build the first runnable version.",
    emptyAction: "Start your first project",
  },

  newProject: {
    title: "What do you want to make?",
    subtitle:
      "One sentence is enough. The more specific you are, the closer the first version lands — and you can keep refining it in conversation afterwards.",
    placeholder: "Describe the gameplay, the style and the rules…",
    opening: "Opening the workbench…",
    openingShort: "Opening…",
    start: "Start building",
    examples: [
      "A pixel-art space shooter where destroying asteroids builds a combo multiplier",
      "A two-player neon snake on one screen, WASD and arrow keys",
      "A calming fruit-catching game with a 60-second timer and a high score",
    ],
    reassurance: [
      {
        title: "Breaking it is fine",
        text: "A bad change never overwrites the last version that worked. You can always go back.",
      },
      {
        title: "Play first, then adjust",
        text: "Play it as soon as it's built. Not right? Say so, and keep going until it is.",
      },
    ],
  },

  artifacts: {
    title: "Published",
    subtitle:
      "A link you've shared works forever, no matter what you change afterwards. The home page only shows the newest version of each project.",
    edit: "Edit",
    open: "Open",
    earlierLink: "Earlier link",
    emptyTitle: "Nothing published yet",
    emptyText:
      "Projects are entirely private until you publish them. They appear in no public listing.",
    emptyAction: "Go to my projects",
  },

  usage: {
    title: "Credits & usage",
    liveNote:
      "Generation calls the real model and spends credits. A turn that stops to ask you a question is not charged.",
    demoNote:
      "Zero-cost demo mode: generation returns a fixed sample project. No model call, no credits spent.",
    createCredits: "Create credits",
    editCredits: "Edit credits",
    recordedRuns: "Recorded runs",
    recentRuns: "Recent runs",
    kindCreate: "Create",
    kindEdit: "Edit",
    charged: "1 credit charged",
    notCharged: "not charged",
    tokens: (count: number) => `${count} tokens`,
    empty: "No billing records yet. Demo-mode runs are not written here.",
  },

  account: {
    settings: "Account & settings",
    displayName: "Display name",
    displayNamePlaceholder: "Not set",
    saveDisplayName: "Save display name",
    editDisplayName: "Edit display name",
    cancelDisplayName: "Cancel",
    displayNameNote: "Your display name appears on the work you publish.",
    createCredits: "Create credits",
    editCredits: "Edit credits",
    signOut: "Sign out",
    remaining: (count: number) => `${count} left`,
  },

  play: {
    publishedOn: (date: string) => `Published ${date}`,
    yourWork: "Yours",
    keepEditing: "Keep editing",
    frameTitle: (title: string) => `${title}, published`,
    notRemixable:
      "The author kept this one closed, so you can play it but not remix it into your own.",
  },

  publish: {
    publicPage: "Public page",
    publish: "Publish",
    publishCurrent: "Publish current version",
    publishing: "Publishing…",
    upToDate: "Up to date",
    upToDateHint:
      "This version is already published. Change something and you can publish again.",
    publishedJustNow: "Published",
    /** The switch's own label; the full sentence is its tooltip. */
    remix: "Remix",
    allowRemix: "Let others remix this into their own project",
    publishedNote:
      "A shared link works forever. Unchecking this also revokes remix rights on links you already shared.",
    unpublishedNote: "Nobody can see it until you publish.",
  },

  preview: {
    title: "Preview",
    reload: "Reload preview",
    fullscreen: "Fullscreen preview",
    frameTitle: (title: string) => `${title} preview`,
    crashed: "The game threw an error while running. The canvas may be blank.",
    blank: "The canvas is blank — the code ran, but nothing was drawn.",
    fixIt: "Ask it to fix this",
    unknownError: "Unknown error",
    fixCrashPrompt: (detail: string) =>
      `Nothing rendered and the console reported: ${detail}. Please fix it.`,
    fixBlankPrompt: "The canvas is blank; nothing rendered. Please find and fix it.",
  },

  builder: {
    runnable: "Runnable",
    noRunnableVersion: "No runnable version",
    fakeProvider: "Fake demo",
    liveProvider: "DeepSeek live",
    safetyNote: "Break it freely — the last version that worked is still there.",
    conversation: "Conversation",
    messageCount: (count: number) => `${count} messages`,
    assumptionsIntro: "I decided these myself. Say so if any of them are wrong:",
    processing: "Working…",
    reconnecting: "Connection dropped, reconnecting — the run is still going",
    thinking: (chars: number) => `${chars} chars of reasoning`,
    editPlaceholder: "Keep going — e.g. make the ball faster, add a pause key…",
    createPlaceholder: "Describe the gameplay you want…",
    send: "Send",
    tabPreview: "Preview",
    tabCode: "Code",
    tabConsole: "Console",
    generating: "Generating",
    reloadPage: "Reload",
    noVersionTitle: "This project has no runnable version",
    noVersionAfterFailure:
      "The last run did not finish. Your original request and the conversation are both kept, so you can retry once it's sorted — the failed attempt is not charged twice.",
    noVersionYet:
      "Nothing has been generated yet. Describe what you want on the left to start.",
    failureDetail: "Error detail",
    retrying: "Retrying…",
    retryOriginal: "Rebuild from the original request",
    changedThisTurn: "Changed this turn",
    projectFiles: "Project files",
    noFileYet: "No file yet",
    waitingForAgent: "Waiting for the agent to open the first file…",
    chars: (count: number) => `${count} chars`,
    statVersion: "Version",
    statVersionValue: (version: number) => `v${version} runnable`,
    statNoVersion: "none",
    statFiles: "Files",
    statFilesValue: (count: number) => `${count} saved`,
    statProvider: "Provider",
    requestInFlight: "Request in flight",
    noBuildLog: "This version has no stored build log.",
  },

  clarify: {
    note: "A few things are unclear, so I'm asking before building. This turn costs no credits.",
    submit: "Continue with these answers",
  },

  phases: {
    reserving: "Reserving credit",
    planning: "Understanding the request",
    writing: "Writing code",
    building: "Bundling",
    repairing: "Something broke, fixing it",
    saving: "Saving",
  },

  resumedPhases: {
    planning: "Reusing the previous plan",
    writing: "Reusing the files already written",
  },

  errors: {
    unknown: "Something went wrong.",
    invalid_request: "Invalid request.",
    not_authenticated: "Please sign in first.",

    prompt_too_short: "Describe the game you want in at least 8 characters.",
    project_create_failed:
      "Could not create the project. Check that the Supabase migrations have run and that the service is configured.",
    project_not_found: "Project not found.",
    invalid_project_id: "Invalid project reference.",

    display_name_too_long: "A display name can be at most 40 characters.",
    profile_save_failed: "Could not save. Please try again.",

    no_publishable_version: "This project has no runnable version to publish yet.",
    artifact_missing: "The preview artifact is missing.",
    publish_failed: "Publishing failed. Please try again.",
    visibility_update_failed: "Update failed. Please try again.",
    not_published: "This project has never been published.",

    invalid_slug: "Invalid work link.",
    remix_source_private:
      "The author did not open this work's source, so it cannot be remixed.",
    remix_source_not_remixable: "This work has no runnable version yet.",
    remix_rate_limited: "Too many remixes. Please try again shortly.",
    remix_failed: "Remix failed. Please try again.",

    // Shown inside the conversation next to a reload button, so neither of
    // these has to say "reload the page" itself.
    run_finished: "This run has already finished.",
    connection_lost: "The connection dropped. The result is on the server.",

    generation_start_failed: "Could not start generation. Please try again shortly.",
    generation_failed: "Generation failed. Please try again shortly.",
    generation_disabled: "Generation is not enabled yet.",
    global_budget_exhausted: "Today's shared generation budget is used up.",
    create_credit_exhausted: "You are out of create credits.",
    edit_credit_exhausted: "You are out of edit credits.",
    rate_limit_exceeded: "Too many requests. Please try again in a minute.",
    generation_in_progress: "A generation is already running for this project.",
    snapshot_unreadable:
      "The previous version's source snapshot is corrupt, so it cannot be edited further.",
    plan_timed_out:
      "Understanding the request timed out. Trying again usually works.",
    step_timed_out: "This step timed out. Please try again shortly.",
    plan_named_no_files: "The plan did not name any files to change.",
  },
};
