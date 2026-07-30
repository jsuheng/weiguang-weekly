export type ViewKey =
  | "overview"
  | "analytics"
  | "reports"
  | "tasks"
  | "notifications"
  | "members"
  | "settings";

export type Member = {
  id: string;
  name: string;
  role: "leader" | "intern";
  status: "active" | "pending" | "left";
  username?: string;
  initials: string;
  color: string;
  joinedAt?: string;
  note?: string;
};

export type Task = {
  id: string;
  title: string;
  assignee: string;
  priority: "普通" | "重要" | "紧急";
  status: "待开始" | "进行中" | "已完成" | "已逾期" | "待转交";
  due: string;
  dueAt?: string;
  project: string;
  createdAt: string;
};

export type Report = {
  id: string;
  memberId: string;
  memberName: string;
  status: "草稿" | "已提交" | "待修改" | "已点评" | "迟交";
  progress: number;
  updatedAt: string;
  completed: string;
  result: string;
  blockers: string;
  next: string;
  review?: string;
};

export type ImportBatch = {
  id: string;
  filename: string;
  uploader: string;
  period: string;
  basis: "内容累计表现" | "周期新增量";
  metricType: "自动识别" | "曝光量" | "播放量";
  rows: number;
  warnings: number;
  detectedPlatforms?: string[];
  unmatchedPlatforms?: string[];
  status: "待审核" | "已批准" | "已拒绝" | "已撤销";
  createdAt: string;
};

export type PlatformDefinition = {
  id: string;
  name: string;
  aliases: string[];
  domains: string[];
  metricType: "曝光量" | "播放量";
  color: string;
  active: boolean;
  system?: boolean;
};

export type ContentDataRow = {
  id: string;
  batchId?: string;
  platform: string;
  account: string;
  title: string;
  link?: string | null;
  metricType: "曝光量" | "播放量";
  exposure: number;
  exit: number | null;
  five: number | null;
  engage: number;
  likes: number;
  comments: number;
  saves: number;
  shares: number;
  complete: number | null;
  followers: number;
  basis?: ImportBatch["basis"];
  period?: string;
};

export type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  type: "task" | "report" | "member" | "data";
  time: string;
  read: boolean;
};

export type WorkspaceState = {
  version: number;
  platforms: PlatformDefinition[];
  contentRows: ContentDataRow[];
  members: Member[];
  tasks: Task[];
  reports: Report[];
  imports: ImportBatch[];
  notifications: NotificationItem[];
};
