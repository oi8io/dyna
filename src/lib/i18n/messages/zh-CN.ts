import type { GenerationPhase } from "@/lib/generation-events";

/**
 * The reference dictionary. Its shape defines `Dictionary`, so every other
 * locale is checked against it at compile time and a missing key is a type
 * error rather than a blank label in production.
 *
 * Values that need a number or a date are functions, not templates with
 * placeholders: no format string to parse at runtime, and the argument types
 * are checked at the call site.
 */
export const zhCN = {
  common: {
    loading: "加载中…",
    save: "保存",
    unknownAccount: "未知账户",
    remixable: "可 Remix",
    playOnly: "仅试玩",
    language: "语言",
  },

  nav: {
    gallery: "作品",
    how: "怎么用",
    workbench: "进入工作台",
    signIn: "登录",
    projects: "作品",
    published: "已发布",
    usage: "额度与用量",
    newProject: "新建作品",
    recent: "最近",
    collapse: "收起侧栏",
    expand: "展开侧栏",
  },

  metadata: {
    title: "Dyna Studio — 一句话，做成一个能玩的东西",
    description:
      "描述你的想法，Dyna Studio 生成真实的前端工程并完成构建，立刻打开来玩、接着改，然后分享链接。",
    login: "登录",
    published: "已发布",
    usage: "额度与用量",
    work: "作品",
  },

  home: {
    headlineTop: "把脑子里的想法，",
    headlineBottom: "做成一个能玩的东西",
    subtitle:
      "写一句话，Dyna 生成真实的前端工程并完成构建，你可以立刻打开来玩、接着改，然后把链接发给任何人。",
    promptLabel: "描述你想创建的作品",
    promptHint: "轻量 2D 单人游戏 · 无需上传素材",
    start: "开始制作",
    examples: [
      "做一个霓虹风格的打砖块，加入连击和粒子效果",
      "生成一个 2048，但数字是不同等级的行星",
      "做一个反应力小游戏：躲开红色方块，坚持 30 秒",
    ],
    galleryTitle: "大家做的东西",
    gallerySubtitle: "点开就能玩，作者开放的作品可以 Remix 成你自己的",
    howTitle: "它是怎么工作的",
    steps: [
      {
        title: "描述你想要的东西",
        text: "用日常语言写清玩法或画面，不需要懂任何技术名词。",
      },
      {
        title: "拿到一份真实工程",
        text: "生成的是完整的 React / TypeScript 源码，通过类型检查和生产构建才算数。",
      },
      {
        title: "边玩边改，然后分享",
        text: "生成完直接上手玩，不满意就接着说，满意了发布成一条链接。",
      },
    ],
    enterWorkbench: "进入我的工作台",
    signInToStart: "登录后开始",
  },

  login: {
    title: "登录后开始创作",
    subtitle: "作品、对话、源码和可运行版本都会保存在你的账户里。",
    footnote: "登录后作品会存在你的账户里",
    google: "使用 Google 账号登录",
    orEmail: "或使用邮箱",
    sendLink: "发送登录链接",
    linkSent: "登录链接已发送，请检查邮箱（也可能在垃圾邮件中）。",
  },

  gallery: {
    empty: "还没有人发布作品。做一个，然后点发布，它就会出现在这里。",
    remix: "Remix 这个作品",
    remixing: "正在复制…",
  },

  projects: {
    title: "我的作品",
    subtitle: "未发布的作品完全私有，只有你能看到。",
    emptyTitle: "还是一片空白",
    emptyText: "描述玩法、视觉风格和胜负条件，Dyna 会生成第一个能跑的版本。",
    emptyAction: "开始第一个作品",
  },

  newProject: {
    title: "你想做点什么？",
    subtitle:
      "一句话就够。描述越具体，第一版越接近你的想法；之后还能继续对话修改。",
    placeholder: "一句话描述玩法、风格和规则……",
    opening: "正在打开工作台…",
    openingShort: "正在打开…",
    start: "开始制作",
    examples: [
      "做一个像素风太空射击游戏，击落陨石会积累连击倍率",
      "生成一个双人同屏的霓虹贪吃蛇，支持 WASD 和方向键",
      "做一个治愈系接水果游戏，60 秒计时并记录最高分",
    ],
    reassurance: [
      {
        title: "改坏了也不怕",
        text: "改砸了不会覆盖上一个能玩的版本，随时可以退回去。",
      },
      {
        title: "先玩再改",
        text: "生成完就能直接上手玩，不满意就接着说，改到顺眼为止。",
      },
    ],
  },

  artifacts: {
    title: "已发布",
    subtitle:
      "发出去的链接永久有效，之后怎么改都不会影响它。首页只展示每个作品最新的那一版。",
    edit: "编辑",
    open: "打开",
    emptyTitle: "还没有发布过东西",
    emptyText: "作品在发布之前完全私有，不会出现在任何公共列表里。",
    emptyAction: "去我的作品",
  },

  usage: {
    title: "额度与用量",
    liveNote: "当前会真实调用模型并扣除额度。停下来向你提问的那一轮不计费。",
    demoNote:
      "当前是零成本演示模式：生成走固定示例工程，不调用模型，也不扣额度。",
    createCredits: "新建额度",
    editCredits: "修改额度",
    recordedRuns: "已记录的生成",
    recentRuns: "最近的生成",
    kindCreate: "新建",
    kindEdit: "修改",
    charged: "扣 1 次额度",
    notCharged: "未扣额度",
    tokens: (count: number) => `${count} tokens`,
    empty: "还没有计费记录。演示模式下的生成不会写入这里。",
  },

  account: {
    settings: "账户与设置",
    displayName: "昵称",
    displayNamePlaceholder: "还没设置",
    saveDisplayName: "保存昵称",
    editDisplayName: "修改昵称",
    cancelDisplayName: "取消",
    displayNameNote: "昵称会显示在你公开发布的作品上。",
    createCredits: "新建额度",
    editCredits: "修改额度",
    signOut: "退出登录",
    remaining: (count: number) => `剩 ${count}`,
  },

  play: {
    publishedOn: (date: string) => `发布于 ${date}`,
    yourWork: "你的作品",
    keepEditing: "继续编辑",
    frameTitle: (title: string) => `${title} 公开试玩`,
    notRemixable: "作者没有开放这个作品，所以它可以玩，但不能 Remix 成你自己的。",
  },

  publish: {
    publicPage: "公开页面",
    publish: "发布",
    publishCurrent: "发布当前版本",
    allowRemix: "允许别人 Remix 成自己的作品",
    publishedNote: "发出去的链接永久有效；取消勾选后，之前发出去的也一起收回。",
    unpublishedNote: "不发布就没人看得到。",
  },

  preview: {
    title: "预览",
    reload: "重新载入预览",
    fullscreen: "全屏预览",
    frameTitle: (title: string) => `${title} 预览`,
    crashed: "游戏跑起来出错了，画面可能是空的。",
    blank: "画面是空的——代码跑通了，但什么都没画出来。",
    fixIt: "让它修一下",
    unknownError: "未知错误",
    /** Sent to the model, so it is written in the user's language on purpose. */
    fixCrashPrompt: (detail: string) =>
      `画面没出来，控制台报错：${detail}。请修好它。`,
    fixBlankPrompt: "画面是空的，什么都没渲染出来。请检查并修好。",
  },

  builder: {
    runnable: "可运行",
    noRunnableVersion: "没有可运行版本",
    fakeProvider: "Fake demo",
    liveProvider: "DeepSeek live",
    safetyNote: "改砸了不要紧，上一个能玩的版本一直留着。",
    conversation: "对话",
    messageCount: (count: number) => `${count} 条`,
    assumptionsIntro: "以下几点我自己定了，不合适就直接说：",
    processing: "正在处理…",
    reconnecting: "连接断了，正在重连——生成还在继续",
    thinking: (chars: number) => `已推理 ${chars} 字`,
    editPlaceholder: "接着说，比如：球速再快一点，加个暂停键…",
    createPlaceholder: "描述你想要的玩法…",
    send: "发送",
    tabPreview: "预览",
    tabCode: "代码",
    tabConsole: "运行信息",
    generating: "正在生成",
    noVersionTitle: "这个作品还没有可运行的版本",
    noVersionAfterFailure:
      "上一次生成没有完成。原始需求和对话都保留着，修好之后可以直接重试，失败的那次不会重复扣额度。",
    noVersionYet: "还没有生成过。在左侧描述你想要的东西就可以开始。",
    failureDetail: "详细报错",
    retrying: "正在重试…",
    retryOriginal: "用原始需求重新生成",
    changedThisTurn: "本次改动",
    projectFiles: "项目文件",
    noFileYet: "还没有文件",
    waitingForAgent: "等待 Agent 开始写第一个文件…",
    chars: (count: number) => `${count} chars`,
    statVersion: "版本",
    statVersionValue: (version: number) => `v${version} runnable`,
    statNoVersion: "无",
    statFiles: "文件",
    statFilesValue: (count: number) => `${count} 个已保存`,
    statProvider: "生成器",
    requestInFlight: "请求进行中",
    noBuildLog: "当前版本没有保存构建日志。",
  },

  clarify: {
    note: "有几处不确定，先问清楚再动手，这一轮不消耗额度。",
    submit: "按这些回答继续",
  },

  phases: {
    reserving: "正在确认额度",
    planning: "正在理解需求",
    writing: "正在写代码",
    building: "正在打包",
    repairing: "出了点问题，正在修",
    saving: "正在保存",
  },

  /**
   * Shown instead of the plain phase label when a stage was inherited from an
   * earlier attempt. Only the stages that can actually be resumed appear, so
   * the lookup is partial by design.
   */
  resumedPhases: {
    planning: "沿用上次的计划",
    writing: "沿用已写好的文件",
  } as Partial<Record<GenerationPhase, string>>,

  errors: {
    unknown: "发生了未知错误。",
    invalid_request: "请求参数无效。",
    not_authenticated: "请先登录。",

    prompt_too_short: "请用至少 8 个字描述你想做的游戏。",
    project_create_failed:
      "项目创建失败。请确认 Supabase 迁移已执行，并检查服务配置。",
    project_not_found: "项目不存在。",
    invalid_project_id: "作品参数无效。",

    display_name_too_long: "昵称最多 40 个字符。",
    profile_save_failed: "保存失败，请重试。",

    no_publishable_version: "作品尚未生成可发布版本。",
    artifact_missing: "预览产物不存在。",
    publish_failed: "发布失败，请重试。",
    visibility_update_failed: "更新失败，请重试。",
    not_published: "这个作品还没有发布过。",

    invalid_slug: "作品链接无效。",
    remix_source_private: "作者没有公开这个作品的源码，无法 Remix。",
    remix_source_not_remixable: "这个作品还没有可运行的版本。",
    remix_rate_limited: "Remix 太频繁了，请稍后再试。",
    remix_failed: "Remix 失败，请稍后重试。",

    run_finished: "这次生成已经结束，刷新页面查看结果。",
    connection_lost: "连接已断开，刷新页面查看最新结果。",

    generation_start_failed: "无法开始生成，请稍后重试。",
    generation_failed: "生成失败，请稍后重试。",
    generation_disabled: "生成能力暂未开放。",
    global_budget_exhausted: "今日公共生成预算已用完。",
    create_credit_exhausted: "你的新建游戏额度已用完。",
    edit_credit_exhausted: "你的修改额度已用完。",
    rate_limit_exceeded: "请求过于频繁，请一分钟后再试。",
    generation_in_progress: "已有生成任务正在进行。",
    snapshot_unreadable: "上一个版本的源码快照损坏，无法在其基础上修改。",
    plan_timed_out: "理解需求这一步超时了。稍后再试一次通常就好。",
    step_timed_out: "这一步超时了，稍后重试。",
    plan_named_no_files: "计划没有指出要改哪些文件。",
  },
};
