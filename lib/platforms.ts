import type { PlatformDefinition } from "./types";

export const defaultPlatforms: PlatformDefinition[] = [
  { id: "platform_xiaohongshu", name: "小红书", aliases: ["XHS", "RedNote", "红书"], domains: ["xiaohongshu.com", "xhslink.com"], metricType: "曝光量", color: "#d84c45", active: true, system: true },
  { id: "platform_douyin", name: "抖音", aliases: ["Douyin", "抖音短视频"], domains: ["douyin.com"], metricType: "播放量", color: "#161616", active: true, system: true },
  { id: "platform_kuaishou", name: "快手", aliases: ["Kuaishou", "KS"], domains: ["kuaishou.com", "chenzhongtech.com"], metricType: "播放量", color: "#f1a33c", active: true, system: true },
  { id: "platform_weixin_channels", name: "视频号", aliases: ["微信视频号", "WeChat Channels"], domains: ["channels.weixin.qq.com", "weixin.qq.com"], metricType: "播放量", color: "#2a9d62", active: true, system: true },
];

export function normalizePlatformKey(value: string) {
  return value.trim().replace(/[\s_-]+/g, "").toLocaleLowerCase("zh-CN");
}

export function mergePlatformDefaults(platforms?: PlatformDefinition[]) {
  if (!platforms?.length) return defaultPlatforms.map((platform) => ({ ...platform, aliases: [...platform.aliases], domains: [...platform.domains] }));
  const knownIds = new Set(platforms.map((platform) => platform.id));
  return [
    ...platforms.map((platform) => ({ ...platform, aliases: platform.aliases || [], domains: platform.domains || [], active: platform.active !== false })),
    ...defaultPlatforms.filter((platform) => !knownIds.has(platform.id)).map((platform) => ({ ...platform, aliases: [...platform.aliases], domains: [...platform.domains] })),
  ];
}
