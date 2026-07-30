import type { WorkspaceState } from "./types";
import { defaultPlatforms } from "./platforms";

export const demoState: WorkspaceState = {
  version: 1,
  platforms: defaultPlatforms,
  contentRows: [
    { id: "content_1", platform: "小红书", account: "灵珠", title: "台风巴威来袭！灵珠避险保命指南", metricType: "曝光量", exposure: 3986, exit: null, five: null, engage: 12.7, likes: 14, comments: 0, saves: 13, shares: 3, complete: null, followers: 1, basis: "内容累计表现", period: "7月20日—7月26日" },
    { id: "content_2", platform: "小红书", account: "灵珠", title: "认知觉醒：刷到这条，别再错过", metricType: "曝光量", exposure: 1121, exit: 46.4, five: 26.5, engage: 15.6, likes: 76, comments: 0, saves: 34, shares: 4, complete: 3, followers: 12, basis: "内容累计表现", period: "7月20日—7月26日" },
    { id: "content_3", platform: "小红书", account: "灵珠", title: "美团失散多年的丑弟弟出现了", metricType: "曝光量", exposure: 175, exit: 64.4, five: 17.3, engage: 9, likes: 3, comments: 2, saves: 0, shares: 1, complete: 0, followers: 3, basis: "内容累计表现", period: "7月20日—7月26日" },
    { id: "content_4", platform: "小红书", account: "闻科学姐", title: "当网络爆火的魔性五子棋遇上灵珠", metricType: "曝光量", exposure: 518, exit: 45.6, five: 31.4, engage: 10.2, likes: 19, comments: 0, saves: 1, shares: 0, complete: 4.1, followers: 2, basis: "内容累计表现", period: "7月20日—7月26日" },
    { id: "content_5", platform: "抖音", account: "AI观察站", title: "普通人如何把 AI 变成私人面试考官", metricType: "播放量", exposure: 24300, exit: 33.3, five: 38.2, engage: 8.4, likes: 882, comments: 46, saves: 932, shares: 127, complete: 12.4, followers: 84, basis: "内容累计表现", period: "7月20日—7月26日" },
  ],
  members: [
    { id: "m1", name: "姜姗", username: "leader-demo", role: "leader", status: "active", initials: "姜", color: "#173f3a", joinedAt: "2026-04-08" },
    { id: "m2", name: "林小满", username: "intern-demo", role: "intern", status: "active", initials: "林", color: "#d88c5a", joinedAt: "2026-05-12" },
    { id: "m3", name: "陈屿", username: "intern-chen", role: "intern", status: "active", initials: "陈", color: "#6389a8", joinedAt: "2026-06-03" },
    { id: "m4", name: "周语", username: "intern-zhou", role: "intern", status: "active", initials: "周", color: "#8a6f9e", joinedAt: "2026-06-18" },
    { id: "m5", name: "谢可欣", username: "intern-xie", role: "intern", status: "pending", initials: "谢", color: "#be765f", note: "负责短视频剪辑与抖音账号运营" },
  ],
  tasks: [
    { id: "t1", title: "整理本周小红书内容数据并提交审核", assignee: "林小满", priority: "重要", status: "进行中", due: "今天 17:30", dueAt: "2026-07-28T17:30:00+08:00", project: "小红书 · 灵珠", createdAt: "10:12" },
    { id: "t2", title: "完成台风热点选题二次剪辑", assignee: "陈屿", priority: "紧急", status: "已逾期", due: "今天 14:00", dueAt: "2026-07-28T14:00:00+08:00", project: "视频号 · 科技情报局", createdAt: "昨天" },
    { id: "t3", title: "核对抖音 7.20—7.26 播放数据", assignee: "周语", priority: "普通", status: "待开始", due: "明天 16:00", dueAt: "2026-07-29T16:00:00+08:00", project: "抖音 · AI观察站", createdAt: "11:06" },
    { id: "t4", title: "补充上周周报中的转化复盘", assignee: "林小满", priority: "普通", status: "已完成", due: "今天 12:00", dueAt: "2026-07-28T12:00:00+08:00", project: "团队周报", createdAt: "周一" },
    { id: "t5", title: "输出 3 个下周可执行的选题方向", assignee: "陈屿", priority: "重要", status: "进行中", due: "周五 18:00", dueAt: "2026-07-31T18:00:00+08:00", project: "内容策划", createdAt: "周二" },
  ],
  reports: [
    { id: "r1", memberId: "m2", memberName: "林小满", status: "已提交", progress: 100, updatedAt: "今天 15:42", completed: "完成 6 篇小红书笔记发布，整理灵珠账号周数据；跟进台风热点内容。", result: "总曝光 12.8 万，互动率 11.6%，新增粉丝 86。", blockers: "部分历史内容缺少发布时间，需要补录。", next: "继续测试高收藏率的实用清单类选题。" },
    { id: "r2", memberId: "m3", memberName: "陈屿", status: "草稿", progress: 72, updatedAt: "今天 14:18", completed: "完成视频号剪辑和热点选题搜集。", result: "视频号本周累计播放 4.7 万。", blockers: "热点内容素材到位较晚。", next: "建立热点素材快速响应清单。" },
    { id: "r3", memberId: "m4", memberName: "周语", status: "待修改", progress: 88, updatedAt: "昨天 18:32", completed: "抖音账号数据复盘，完成 4 条口播稿。", result: "平均 5 秒完播率提升 4.2%。", blockers: "互动率计算口径需统一。", next: "验证两种不同开场结构。", review: "补充两条表现最好内容的具体数据，并说明提升原因。" },
  ],
  imports: [
    { id: "i1", filename: "小红书数据_7.20-7.26.xlsx", uploader: "林小满", period: "7月20日—7月26日", basis: "内容累计表现", metricType: "自动识别", rows: 26, warnings: 2, detectedPlatforms: ["小红书"], unmatchedPlatforms: [], status: "待审核", createdAt: "今天 15:28" },
    { id: "i2", filename: "抖音周增量_7.13-7.19.csv", uploader: "周语", period: "7月13日—7月19日", basis: "周期新增量", metricType: "自动识别", rows: 18, warnings: 0, detectedPlatforms: ["抖音"], unmatchedPlatforms: [], status: "已批准", createdAt: "7月20日" },
  ],
  notifications: [
    { id: "n1", title: "任务已经逾期", detail: "陈屿负责的「台风热点选题二次剪辑」已超过 DDL。", type: "task", time: "22 分钟前", read: false },
    { id: "n2", title: "新的数据导入待审核", detail: "林小满提交了 26 条小红书内容数据，其中 2 条需要确认。", type: "data", time: "35 分钟前", read: false },
    { id: "n3", title: "周报已提交", detail: "林小满提交了本周周报，等待你的点评。", type: "report", time: "今天 15:42", read: false },
    { id: "n4", title: "新的入组申请", detail: "谢可欣申请加入「内容增长组」。", type: "member", time: "今天 11:16", read: true },
  ],
};
