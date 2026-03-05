export const SITE = {
  website: "https://deepcity.github.io/",
  author: "Deepcity",
  profile: "https://github.com/Deepcity",
  desc: "Deepcity 的个人博客 — 系统、算法与 AI 领域的学习笔记与论文阅读。",
  title: "Deepcity's Blog",
  ogImage: "og-default.png",
  lightAndDarkMode: true,
  postPerIndex: 5,
  postPerPage: 8,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true,
  editPost: {
    enabled: true,
    text: "在 GitHub 上编辑",
    url: "https://github.com/Deepcity/deepcity.github.io/edit/main/",
  },
  dynamicOgImage: true,
  dir: "ltr",
  lang: "zh-CN",
  timezone: "Asia/Shanghai",
} as const;
