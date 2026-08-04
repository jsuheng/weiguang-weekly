"use client";

import { useEffect, useRef, useState } from "react";
import { demoState } from "../lib/demo-data";
import type { ContentDataRow, ImportBatch, Member, PlatformDefinition, Report, Task, ViewKey, WorkspaceState } from "../lib/types";

type SessionView = {
  user: { id: string; username: string; displayName: string; mustChangePassword: boolean };
  activeMembership: null | { id: string; groupId: string; groupName: string; role: "leader" | "intern"; status: "active" };
  memberships: Array<{ id: string; groupId: string; groupName: string; role: "leader" | "intern"; status: "active" | "pending" | "left" | "rejected" }>;
};

const nav: { key: ViewKey; label: string; mark: string }[] = [
  { key: "overview", label: "工作台", mark: "⌂" },
  { key: "analytics", label: "账号数据", mark: "↗" },
  { key: "reports", label: "团队周报", mark: "▤" },
  { key: "tasks", label: "每日任务", mark: "✓" },
  { key: "notifications", label: "通知中心", mark: "◉" },
  { key: "members", label: "成员管理", mark: "人" },
  { key: "settings", label: "小组设置", mark: "⚙" },
];

const internNav: { key: ViewKey; label: string; mark: string }[] = [
  { key: "overview", label: "我的工作台", mark: "⌂" },
  { key: "tasks", label: "我的任务", mark: "✓" },
  { key: "reports", label: "我的周报", mark: "▤" },
  { key: "analytics", label: "账号数据", mark: "↗" },
  { key: "notifications", label: "通知中心", mark: "◉" },
];

const platformRows = [
  { platform: "小红书", account: "灵珠", title: "台风巴威来袭！灵珠避险保命指南", exposure: 3986, exit: null, five: null, engage: 12.7, likes: 14, comments: 0, saves: 13, shares: 3, complete: null, followers: 1 },
  { platform: "小红书", account: "灵珠", title: "认知觉醒：刷到这条，别再错过", exposure: 1121, exit: 46.4, five: 26.5, engage: 15.6, likes: 76, comments: 0, saves: 34, shares: 4, complete: 3, followers: 12 },
  { platform: "小红书", account: "灵珠", title: "美团失散多年的丑弟弟出现了", exposure: 175, exit: 64.4, five: 17.3, engage: 9, likes: 3, comments: 2, saves: 0, shares: 1, complete: 0, followers: 3 },
  { platform: "小红书", account: "闻科学姐", title: "当网络爆火的魔性五子棋遇上灵珠", exposure: 518, exit: 45.6, five: 31.4, engage: 10.2, likes: 19, comments: 0, saves: 1, shares: 0, complete: 4.1, followers: 2 },
  { platform: "抖音", account: "AI观察站", title: "普通人如何把 AI 变成私人面试考官", exposure: 24300, exit: 33.3, five: 38.2, engage: 8.4, likes: 882, comments: 46, saves: 932, shares: 127, complete: 12.4, followers: 84 },
];

const trend = [34, 42, 38, 54, 48, 63, 58, 76, 71, 84, 78, 92];

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: value > 9999 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatWeekRange(date: Date) {
  const day = date.getDay();
  const monday = new Date(date);
  monday.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${fmt(monday)}—${fmt(sunday)}`;
}

function formatToday(date: Date) {
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${weekdays[date.getDay()]}`;
}

function formatGreeting(date: Date, name: string) {
  const hour = date.getHours();
  const word = hour < 12 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  return `${word}，${name}`;
}

function computeWeeklyExposure(rows: { exposure: number }[]) {
  // 简化：将数据均分为最多12周展示
  if (!rows.length) return [];
  const weeks = Math.min(12, rows.length);
  const perWeek = Math.ceil(rows.length / weeks);
  const result: number[] = [];
  for (let i = 0; i < weeks; i++) {
    const slice = rows.slice(i * perWeek, (i + 1) * perWeek);
    result.push(slice.reduce((sum, r) => sum + r.exposure, 0));
  }
  return result;
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-label="Weekly Report">
      <small>Weekly</small>
      <b>Report</b>
    </span>
  );
}

function Avatar({ member, small = false }: { member: Pick<Member, "initials" | "color" | "name">; small?: boolean }) {
  return <span className={`avatar ${small ? "small" : ""}`} style={{ background: member.color }} title={member.name}>{member.initials}</span>;
}

function EmptyMetric() {
  return <span className="metric-empty">暂无数据</span>;
}

async function uploadImportBatch(batch: ImportBatch, file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("basis", batch.basis);
  form.append("metricType", batch.metricType);
  form.append("period", batch.period);
  const response = await fetch("/api/imports", { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "文件上传失败");
  return data as { batch: ImportBatch; state: WorkspaceState };
}

type ServerNotification = {
  id: string;
  title: string;
  detail: string;
  kind: string;
  createdAt: string;
  readAt: string | null;
};

function useServerNotifications() {
  const [items, setItems] = useState<ServerNotification[]>([]);
  useEffect(() => {
    fetch("/api/notifications").then(async (response) => response.ok ? response.json() : { notifications: [] }).then((data) => setItems(data.notifications || [])).catch(() => undefined);
  }, []);
  const mark = async (id?: string) => {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : { all: true }) });
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => !id || item.id === id ? { ...item, readAt: now } : item));
  };
  return { items, mark };
}

function AppLoading() {
  return <div className="auth-screen"><div className="auth-card loading-card"><BrandMark /><h1>正在进入工作空间</h1><p>正在验证登录状态与小组权限…</p><span className="auth-loader" /></div></div>;
}

function PasswordLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const login = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/password/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "登录失败");
      window.location.assign("/");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败");
      setBusy(false);
    }
  };
  return <div className="auth-screen">
    <section className="auth-card">
      <div className="auth-brand"><BrandMark /><div><strong>周报</strong><span>运营协作中心</span></div></div>
      <div className="auth-copy"><StatusPill tone="teal">公司内网</StatusPill><h1>账号密码登录</h1><p>请输入 Leader 分配的内部账号。首次登录需要修改临时密码。</p></div>
      <label>用户名<input autoFocus value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} autoComplete="username" placeholder="例如：intern-lin" /></label>
      <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="请输入密码" onKeyDown={(event) => event.key === "Enter" && void login()} /></label>
      <button className="primary auth-submit" disabled={busy || username.trim().length < 3 || !password} onClick={login}>{busy ? "正在登录…" : "登录"}</button>
      {message && <p className="auth-message">{message}</p>}
      <p className="auth-agreement">本系统仅限公司内部使用。账号停用或忘记密码请联系 Leader；Leader 账号由运维协助重置。</p>
    </section>
    <aside className="auth-aside"><StatusPill tone="teal">多人协作</StatusPill><h2>一个内网地址，进入对应工作角色</h2><p>系统根据服务端成员关系自动识别 Leader 或实习生权限，不能通过修改网址切换职位。</p><ul><li>账号由 Leader 统一管理</li><li>任务与周报按成员授权</li><li>所有关键操作留存审计记录</li></ul></aside>
  </div>;
}

function PasswordChange({ session, forced = false, onClose }: { session: SessionView; forced?: boolean; onClose?: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (newPassword !== confirmPassword) {
      setMessage("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/password/change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "操作失败");
      if (forced) window.location.reload();
      else {
        setMessage("密码已修改");
        window.setTimeout(() => onClose?.(), 800);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  const card = <section className="auth-card onboarding-card">
      <div className="auth-brand"><BrandMark /><div><strong>{forced ? "首次登录，请修改密码" : "修改登录密码"}</strong><span>{session.user.username}</span></div></div>
      <p className="password-guidance">新密码至少 10 位，并同时包含字母和数字。修改后其他设备上的登录会话将失效。</p>
      <label>当前密码<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
      <label>新密码<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" /></label>
      <label>再次输入新密码<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
      <button className="primary auth-submit" disabled={busy || !currentPassword || newPassword.length < 10 || !confirmPassword} onClick={submit}>{busy ? "正在保存…" : "保存新密码"}</button>
      {!forced && <button className="secondary auth-submit" onClick={onClose}>取消</button>}
      {message && <p className={`auth-message ${message === "密码已修改" ? "success" : ""}`}>{message}</p>}
    </section>
  return forced ? <div className="auth-screen onboarding-screen">{card}</div> : <div className="modal-backdrop">{card}</div>;
}

function NoWorkspace({ session }: { session: SessionView }) {
  return <div className="auth-screen onboarding-screen"><section className="auth-card onboarding-card">
    <div className="auth-brand"><BrandMark /><div><strong>欢迎，{session.user.displayName}</strong><span>{session.user.username}</span></div></div>
    <h1>账号尚未分配工作空间</h1>
    <p className="password-guidance">内部版不开放自助注册或申请加入。请联系 Leader 为该账号分配小组和职位。</p>
    <button className="secondary auth-submit" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/"); }}>退出登录</button>
  </section></div>;
}

function WorkspaceSwitcher({ session }: { session: SessionView }) {
  const [open, setOpen] = useState(false);
  const activeMemberships = session.memberships.filter((item) => item.status === "active");
  const switchTo = async (groupId: string) => {
    if (groupId === session.activeMembership?.groupId) {
      setOpen(false);
      return;
    }
    const response = await fetch("/api/auth/switch-workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId }) });
    if (response.ok) window.location.assign("/");
  };
  return <div className="workspace-switch-wrap">
    <button className="group-switcher" type="button" onClick={() => setOpen((value) => !value)}>
      <span className="group-avatar">{session.activeMembership?.groupName.slice(0, 1)}</span>
      <span><b>{session.activeMembership?.groupName}</b><small>{session.activeMembership?.role === "leader" ? "Leader" : "实习生"} 工作空间</small></span>
      <i>⌄</i>
    </button>
    {open && <div className="workspace-menu">{activeMemberships.map((item) => <button key={item.id} onClick={() => switchTo(item.groupId)} className={item.groupId === session.activeMembership?.groupId ? "active" : ""}><span>{item.groupName.slice(0, 1)}</span><div><b>{item.groupName}</b><small>{item.role === "leader" ? "Leader" : "实习生"}</small></div>{item.groupId === session.activeMembership?.groupId && <i>✓</i>}</button>)}</div>}
  </div>;
}

export default function WorkspaceApp() {
  const [view, setView] = useState<ViewKey>("overview");
  const [auth, setAuth] = useState<SessionView | null | undefined>(undefined);
  const [state, setState] = useState<WorkspaceState>(demoState);
  const stateRef = useRef(state);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [taskModal, setTaskModal] = useState(false);
  const [importModal, setImportModal] = useState(false);
  const [reportModal, setReportModal] = useState<Report | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const role = auth?.activeMembership?.role || "leader";

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const requestedRole = new URLSearchParams(window.location.search).get("role");
        if (["localhost", "127.0.0.1"].includes(window.location.hostname) && (requestedRole === "leader" || requestedRole === "intern")) {
          await fetch("/api/dev/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: requestedRole }),
          });
        }
        const sessionResponse = await fetch("/api/auth/session");
        if (!sessionResponse.ok) {
          if (!cancelled) setAuth(null);
          return;
        }
        const sessionData = await sessionResponse.json() as SessionView;
        if (!cancelled) setAuth(sessionData);

        // 首次登录必须先修改临时密码，不要请求工作区（后端会拒绝未改密用户）
        if (sessionData.user.mustChangePassword) {
          return;
        }

        if (sessionData.activeMembership) {
          const workspaceResponse = await fetch("/api/workspace");
          const workspaceData = await workspaceResponse.json();
          if (!workspaceResponse.ok) {
            const error = new Error(workspaceData.error || "工作区加载失败") as Error & { status: number };
            error.status = workspaceResponse.status;
            throw error;
          }
          if (!cancelled && workspaceData.state) setState(workspaceData.state);
        }
      } catch (error) {
        // 仅当会话明确失效（401）时才清空登录状态
        // 403（需改密/无权限）和 5xx（服务错误）保留登录身份
        if (!cancelled && (error as { status?: number }).status === 401) {
          setAuth(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void initialize();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  };

  const mutate = async (next: WorkspaceState, action: string) => {
    const previous = stateRef.current;
    setState(next);
    setSaving(true);
    try {
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next, action }),
      });
      const data = await response.json();
      if (response.status === 409 && data.state) {
        setState(data.state);
        notify("另一位成员刚刚更新了数据，已载入最新版本");
      } else if (response.status === 401) {
        setAuth(null);
        throw new Error("登录状态已过期");
      } else if (!response.ok) {
        throw new Error(data.error || "保存失败");
      } else {
        setState(data.state);
        notify(`${action} · 已保存`);
      }
    } catch (error) {
      setState(previous);
      notify(error instanceof Error ? error.message : "保存失败，请稍后重试");
    } finally {
      setSaving(false);
    }
  };

  const reviewImport = async (batchId: string, action: "approve" | "reject") => {
    setSaving(true);
    try {
      const response = await fetch("/api/imports", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId, action }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "审核失败");
      if (!data.state) throw new Error("审核完成，但没有读取到最新工作区");
      setState(data.state);
      notify(action === "approve" ? "批准数据导入 · 已同步至正式看板" : "拒绝数据导入 · 已保存");
    } catch (error) {
      notify(error instanceof Error ? error.message : "审核失败，请稍后重试");
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const unread = state.notifications.filter((item) => !item.read).length;
  const pendingMembers = state.members.filter((member) => member.status === "pending").length;
  const currentMember = state.members.find((member) => member.name === auth?.user.displayName) || {
    id: auth?.activeMembership?.id || "current-user",
    name: auth?.user.displayName || "当前用户",
    role,
    status: "active" as const,
    username: auth?.user.username,
    initials: auth?.user.displayName?.slice(0, 1) || "用",
    color: role === "leader" ? "#173f3a" : "#d88c5a",
  };

  if (auth === undefined || loading) return <AppLoading />;
  if (auth === null) return <PasswordLogin />;
  if (auth.user.mustChangePassword) return <PasswordChange session={auth} forced />;
  if (!auth.activeMembership) return <NoWorkspace session={auth} />;

  if (role === "intern") {
    return <InternWorkspace state={state} session={auth} member={currentMember} loading={loading} saving={saving} onMutate={mutate} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div><strong>周报</strong><span>运营协作中心</span></div>
        </div>
        <WorkspaceSwitcher session={auth} />
        <nav>
          <p className="nav-label">工作空间</p>
          {nav.slice(0, 4).map((item) => (
            <button key={item.key} className={view === item.key ? "active" : ""} onClick={() => setView(item.key)}>
              <span className="nav-mark">{item.mark}</span>{item.label}
              {item.key === "tasks" && <em>{state.tasks.filter((task) => task.status === "已逾期").length}</em>}
            </button>
          ))}
          <p className="nav-label">团队管理</p>
          {nav.slice(4).map((item) => (
            <button key={item.key} className={view === item.key ? "active" : ""} onClick={() => setView(item.key)}>
              <span className="nav-mark">{item.mark}</span>{item.label}
              {item.key === "notifications" && unread > 0 && <em>{unread}</em>}
              {item.key === "members" && pendingMembers > 0 && <em className="amber">{pendingMembers}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="work-dot" />
          <div><b>工作时间内</b><small>10:00—19:00</small></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="mobile-brand"><BrandMark /> 周报</div>
          <label className="search"><span>⌕</span><input aria-label="搜索" placeholder="搜索任务、成员或内容" /></label>
          <div className="top-actions">
            <span className="save-state">{saving ? "正在保存…" : loading ? "正在同步…" : "云端已同步"}</span>
            <button className="icon-button" aria-label="通知" onClick={() => setView("notifications")}>◉{unread > 0 && <i>{unread}</i>}</button>
            <button className="profile" onClick={() => setProfileOpen((open) => !open)}>
              <Avatar member={currentMember} />
              <span><b>{auth.user.displayName}</b><small>Leader</small></span>
              <i>⌄</i>
            </button>
            {profileOpen && (
              <div className="profile-menu">
                <b>{auth.user.displayName}</b><span>内部账号 · {auth.user.username}</span>
                <button onClick={() => { setPasswordModal(true); setProfileOpen(false); }}>修改登录密码</button>
                <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/"); }}>退出登录</button>
              </div>
            )}
          </div>
        </header>

        <div className="content">
          {view === "overview" && <Overview state={state} userName={auth.user.displayName} onView={setView} onTask={() => setTaskModal(true)} onImport={() => setImportModal(true)} />}
          {view === "analytics" && <Analytics state={state} onImport={() => setImportModal(true)} onMutate={mutate} onReviewImport={reviewImport} />}
          {view === "reports" && <Reports state={state} onOpen={setReportModal} onMutate={mutate} />}
          {view === "tasks" && <Tasks state={state} onCreate={() => setTaskModal(true)} onMutate={mutate} />}
          {view === "notifications" && <Notifications state={state} onMutate={mutate} />}
          {view === "members" && <Members state={state} />}
          {view === "settings" && <Settings onPasswordChange={() => setPasswordModal(true)} />}
        </div>
      </main>

      {taskModal && <TaskModal state={state} onClose={() => setTaskModal(false)} onSave={(task) => { mutate({ ...stateRef.current, tasks: [task, ...stateRef.current.tasks] }, "发布新任务"); setTaskModal(false); }} />}
      {importModal && <ImportModal platforms={state.platforms} uploader={auth.user.displayName} onClose={() => setImportModal(false)} onSave={async (batch, file) => { const result = await uploadImportBatch(batch, file); setState(result.state); const matched = result.batch.detectedPlatforms?.join("、") || "待确认平台"; const unmatched = result.batch.unmatchedPlatforms?.length ? `；${result.batch.unmatchedPlatforms.join("、")}待匹配` : ""; notify(`已识别 ${result.batch.rows} 条数据 · ${matched}${unmatched}`); setImportModal(false); }} />}
      {reportModal && <ReportModal report={reportModal} onClose={() => setReportModal(null)} onSave={(updated) => { mutate({ ...stateRef.current, reports: stateRef.current.reports.map((report) => report.id === updated.id ? updated : report) }, updated.status === "已点评" ? "完成周报点评" : "保存周报"); setReportModal(null); }} />}
      {passwordModal && <PasswordChange session={auth} onClose={() => setPasswordModal(false)} />}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function InternWorkspace({ state, session, member, loading, saving, onMutate }: { state: WorkspaceState; session: SessionView; member: Member; loading: boolean; saving: boolean; onMutate: (next: WorkspaceState, action: string) => void }) {
  const [view, setView] = useState<ViewKey>("overview");
  const [importModal, setImportModal] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordModal, setPasswordModal] = useState(false);
  const myTasks = state.tasks.filter((task) => task.assignee === member.name);
  const myReport = state.reports.find((report) => report.memberId === member.id);
  const myImports = state.imports.filter((batch) => batch.uploader === member.name);
  const unread = 3;

  return (
    <div className="app-shell intern-shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div><strong>周报</strong><span>运营协作中心</span></div>
        </div>
        <WorkspaceSwitcher session={session} />
        <nav>
          <p className="nav-label">个人工作空间</p>
          {internNav.map((item) => (
            <button key={item.key} className={view === item.key ? "active" : ""} onClick={() => setView(item.key)}>
              <span className="nav-mark">{item.mark}</span>{item.label}
              {item.key === "tasks" && myTasks.filter((task) => task.status !== "已完成").length > 0 && <em>{myTasks.filter((task) => task.status !== "已完成").length}</em>}
              {item.key === "notifications" && <em>{unread}</em>}
            </button>
          ))}
        </nav>
        <div className="intern-permission">
          <span>实习生权限</span>
          <p>可填写周报、更新本人任务、导入运营数据；管理操作仅 Leader 可用。</p>
        </div>
        <div className="sidebar-foot">
          <span className="work-dot" />
          <div><b>工作时间内</b><small>10:00—19:00</small></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="mobile-brand"><BrandMark /> 周报</div>
          <label className="search"><span>⌕</span><input aria-label="搜索" placeholder="搜索我的任务或内容" /></label>
          <div className="top-actions">
            <StatusPill tone="teal">实习生视角</StatusPill>
            <span className="save-state">{saving ? "正在保存…" : loading ? "正在同步…" : "云端已同步"}</span>
            <button className="icon-button" aria-label="通知" onClick={() => setView("notifications")}>◉<i>{unread}</i></button>
            <button className="profile" onClick={() => setProfileOpen((open) => !open)}>
              <Avatar member={member} />
              <span><b>{member.name}</b><small>实习生</small></span>
              <i>⌄</i>
            </button>
            {profileOpen && (
              <div className="profile-menu">
                <b>{member.name}</b><span>内部账号 · {session.user.username}</span>
                <p className="profile-role-note">实习生工作权限</p>
                <button onClick={() => { setPasswordModal(true); setProfileOpen(false); }}>修改登录密码</button>
                <button onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/"); }}>退出登录</button>
              </div>
            )}
          </div>
        </header>

        <div className="content">
          {view === "overview" && <InternOverview state={state} member={member} tasks={myTasks} report={myReport} onView={setView} onImport={() => setImportModal(true)} />}
          {view === "tasks" && <InternTasks state={state} member={member} tasks={myTasks} onMutate={onMutate} />}
          {view === "reports" && myReport && <InternReport state={state} report={myReport} onMutate={onMutate} />}
          {view === "analytics" && <InternAnalytics state={state} imports={myImports} member={member} onImport={() => setImportModal(true)} />}
          {view === "notifications" && <InternNotifications />}
        </div>
      </main>

      {importModal && <ImportModal platforms={state.platforms} uploader={member.name} onClose={() => setImportModal(false)} onSave={async (batch, file) => { const result = await uploadImportBatch(batch, file); window.location.reload(); void result; }} />}
      {passwordModal && <PasswordChange session={session} onClose={() => setPasswordModal(false)} />}
    </div>
  );
}

function InternOverview({ state, member, tasks, report, onView, onImport }: { state: WorkspaceState; member: Member; tasks: Task[]; report?: Report; onView: (view: ViewKey) => void; onImport: () => void }) {
  const completed = tasks.filter((task) => task.status === "已完成").length;
  const openTasks = tasks.filter((task) => task.status !== "已完成");
  return <>
    <PageTitle eyebrow={formatToday(new Date())} title={`${formatGreeting(new Date(), member.name)}`} description={`你有 ${openTasks.length} 项待办任务，本周周报已完成 ${report?.progress || 0}%。`} actions={<button className="secondary" onClick={onImport}>导入运营数据</button>} />
    <section className="hero-grid">
      <article className="hero-card intern-hero">
        <div className="hero-copy"><StatusPill tone="teal">本周个人进度</StatusPill><h2>任务推进有序，<br />记得补充本周复盘</h2><p>你负责的灵珠账号本周累计曝光 <b>12.8 万</b>，已有一批数据等待 Leader 审核。</p><button onClick={() => onView("reports")}>继续填写周报 <span>→</span></button></div>
        <div className="personal-progress">
          <span>周报完成度</span><strong>{report?.progress || 0}%</strong>
          <div className="progress-track"><i style={{ width: `${report?.progress || 0}%` }} /></div>
          <small>{report?.status === "已提交" ? "已提交，等待 Leader 点评" : "周五 19:00 前提交"}</small>
        </div>
      </article>
      <article className="deadline-card">
        <div className="deadline-top"><span>周报截止</span><StatusPill tone="amber">周五 19:00</StatusPill></div>
        <div className="deadline-count"><strong>4</strong><span>天</span><strong>01</strong><span>小时</span></div>
        <div className="progress-track"><i style={{ width: "48%" }} /></div>
        <div className="deadline-foot"><span>下次提醒</span><b>周五 10:00</b></div>
      </article>
    </section>
    <section className="kpi-grid">
      {[
        ["我的任务", String(tasks.length), `${completed} 项已完成`, "blue"],
        ["待完成", String(openTasks.length), "按 DDL 排序", "orange"],
        ["周报进度", `${report?.progress || 0}%`, report?.status || "草稿", "teal"],
        ["本周导入", String(state.imports.filter((batch) => batch.uploader === member.name).length), "待 Leader 审核", "purple"],
      ].map(([label, value, note, tone]) => <article className="kpi-card" key={label}><span className={`kpi-icon ${tone}`}>{label.slice(0, 1)}</span><div><p>{label}</p><strong>{value}</strong><small>{note}</small></div></article>)}
    </section>
    <section className="dashboard-grid">
      <article className="panel task-panel">
        <div className="panel-head"><div><h3>我的任务</h3><span>{completed}/{tasks.length} 已完成</span></div><button onClick={() => onView("tasks")}>查看全部 →</button></div>
        <div className="mini-progress"><i style={{ width: `${tasks.length ? completed / tasks.length * 100 : 0}%` }} /></div>
        <div className="task-list">{tasks.map((task) => <div className="task-row" key={task.id}><span className={`check ${task.status === "已完成" ? "done" : ""}`}>{task.status === "已完成" ? "✓" : ""}</span><div><b>{task.title}</b><small>{task.project}</small></div><span className={task.status === "已逾期" ? "due overdue" : "due"}>{task.due}</span></div>)}</div>
      </article>
      <article className="panel intern-next">
        <div className="panel-head"><div><h3>接下来</h3><span>按优先级安排</span></div></div>
        <div className="attention-list">
          <button onClick={() => onView("tasks")}><span className="attention-icon amber">任</span><div><b>今天 17:30 前完成数据整理</b><small>重要 · 小红书「灵珠」</small></div><i>→</i></button>
          <button onClick={() => onView("reports")}><span className="attention-icon blue">报</span><div><b>补充本周复盘与下周计划</b><small>周报截止：周五 19:00</small></div><i>→</i></button>
          <button onClick={onImport}><span className="attention-icon violet">数</span><div><b>导入本周运营数据</b><small>提交后由 Leader 审核</small></div><i>→</i></button>
        </div>
      </article>
    </section>
  </>;
}

function InternTasks({ state, member, tasks, onMutate }: { state: WorkspaceState; member: Member; tasks: Task[]; onMutate: (next: WorkspaceState, action: string) => void }) {
  const [filter, setFilter] = useState("全部");
  const filtered = filter === "全部" ? tasks : tasks.filter((task) => task.status === filter);
  const toggle = (id: string) => onMutate({ ...state, tasks: state.tasks.map((task) => task.id === id ? { ...task, status: task.status === "已完成" ? "进行中" : "已完成" } : task) }, "更新本人任务状态");
  return <>
    <PageTitle eyebrow={`个人任务 · ${member.name}`} title="我的任务" description="你只能更新分配给自己的任务；任务发布、转交和 DDL 修改由 Leader 完成。" />
    <section className="task-stats">{[["全部任务", tasks.length], ["进行中", tasks.filter((task) => task.status === "进行中").length], ["已完成", tasks.filter((task) => task.status === "已完成").length], ["已逾期", tasks.filter((task) => task.status === "已逾期").length]].map(([label, value], index) => <article key={String(label)} className={index === 3 ? "danger" : ""}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <div className="task-toolbar"><div className="segmented">{["全部", "待开始", "进行中", "已完成", "已逾期"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><div><button>按 DDL 排序</button></div></div>
    <article className="panel table-panel task-table"><table><thead><tr><th>完成</th><th>任务</th><th>所属账号 / 项目</th><th>优先级</th><th>状态</th><th>DDL</th></tr></thead><tbody>{filtered.map((task) => <tr key={task.id}><td><button className={`check large ${task.status === "已完成" ? "done" : ""}`} onClick={() => toggle(task.id)}>{task.status === "已完成" ? "✓" : ""}</button></td><td><strong>{task.title}</strong><small>Leader 发布 · {task.createdAt}</small></td><td>{task.project}</td><td><StatusPill tone={task.priority === "紧急" ? "red" : task.priority === "重要" ? "amber" : "neutral"}>{task.priority}</StatusPill></td><td><StatusPill tone={task.status === "已完成" ? "teal" : task.status === "已逾期" ? "red" : "neutral"}>{task.status}</StatusPill></td><td className={task.status === "已逾期" ? "overdue-text" : ""}>{task.due}</td></tr>)}</tbody></table></article>
  </>;
}

function InternReport({ state, report, onMutate }: { state: WorkspaceState; report: Report; onMutate: (next: WorkspaceState, action: string) => void }) {
  const [completed, setCompleted] = useState(report.completed);
  const [result, setResult] = useState(report.result);
  const [blockers, setBlockers] = useState(report.blockers);
  const [next, setNext] = useState(report.next);
  const save = (submit: boolean) => onMutate({ ...state, reports: state.reports.map((item) => item.id === report.id ? { ...item, completed, result, blockers, next, progress: submit ? 100 : 88, status: submit ? "已提交" : "草稿", updatedAt: "刚刚" } : item) }, submit ? "提交本周周报" : "保存周报草稿");
  return <>
    <PageTitle eyebrow={`我的周报 · ${formatWeekRange(new Date())}`} title="本周周报" description="内容会自动保存；提交后 Leader 可点评或退回修改。" actions={<><button className="secondary" onClick={() => save(false)}>保存草稿</button><button className="primary" onClick={() => save(true)}>提交周报</button></>} />
    <div className="report-editor-layout">
      <article className="panel report-editor">
        <div className="editor-status"><div><StatusPill tone={report.status === "已提交" ? "teal" : report.status === "待修改" ? "amber" : "neutral"}>{report.status}</StatusPill><span>更新于 {report.updatedAt}</span></div><strong>{report.progress}%</strong></div>
        <label>本周完成事项<textarea value={completed} onChange={(event) => setCompleted(event.target.value)} rows={5} /></label>
        <label>关键成果与账号数据<textarea value={result} onChange={(event) => setResult(event.target.value)} rows={4} /></label>
        <label>遇到的问题<textarea value={blockers} onChange={(event) => setBlockers(event.target.value)} rows={4} /></label>
        <label>下周计划<textarea value={next} onChange={(event) => setNext(event.target.value)} rows={4} /></label>
        <label>需要 Leader 协助事项<textarea placeholder="如暂无可填写“无”" rows={3} /></label>
        <label>本周复盘<textarea placeholder="总结本周做得好的地方、可改进点和方法沉淀" rows={4} /></label>
      </article>
      <aside className="report-side">
        <article className="panel deadline-mini"><span>提交截止</span><strong>周五 19:00</strong><p>距截止还有 4 天 01 小时</p></article>
        {report.review && <article className="panel leader-feedback"><StatusPill tone="amber">Leader 点评</StatusPill><h3>请按建议补充</h3><p>{report.review}</p></article>}
        <article className="panel linked-tasks"><h3>关联任务</h3>{state.tasks.filter((task) => task.assignee === report.memberName).map((task) => <p key={task.id}><span className={`check ${task.status === "已完成" ? "done" : ""}`}>{task.status === "已完成" ? "✓" : ""}</span><b>{task.title}</b></p>)}</article>
      </aside>
    </div>
  </>;
}

function InternAnalytics({ state, imports, member, onImport }: { state: WorkspaceState; imports: ImportBatch[]; member: Member; onImport: () => void }) {
  // 从实习生导入记录中识别其负责的账号
  const myAccountNames = new Set(imports.flatMap(batch =>
    state.contentRows.filter(row => row.batchId === batch.id).map(row => row.account)
  ));
  // 如果识别不到账号，展示全部已批准数据
  const myRows = myAccountNames.size > 0
    ? state.contentRows.filter(row => myAccountNames.has(row.account))
    : state.contentRows;
  const uniqueAccounts = [...new Set(myRows.map(row => row.account))];
  const totalExposure = myRows.reduce((sum, row) => sum + row.exposure, 0);
  const totalInteractions = myRows.reduce((sum, row) => sum + row.likes + row.comments + row.saves + row.shares, 0);
  const totalFollowers = myRows.reduce((sum, row) => sum + row.followers, 0);
  const weightedEngage = totalExposure > 0
    ? (myRows.reduce((sum, row) => sum + row.engage * row.exposure, 0) / totalExposure).toFixed(1)
    : "—";
  // 按周汇总曝光量用于趋势图
  const weeklyExposure = computeWeeklyExposure(myRows);
  const maxWeekly = Math.max(1, ...weeklyExposure);

  return <>
    <PageTitle eyebrow={`账号数据 · ${formatWeekRange(new Date())}`} title="运营数据" description="查看团队已批准数据，或提交你负责的运营数据等待 Leader 审核。" actions={<button className="primary" onClick={onImport}>＋ 导入数据</button>} />
    <div className="notice-line"><span>i</span><p>实习生导入的数据不会直接进入正式看板，必须通过 Leader 审核。</p></div>
    <section className="analytics-kpis">
      {[
        ["负责账号", String(uniqueAccounts.length), uniqueAccounts.slice(0, 2).join(" / ") || member.name],
        ["内容条数", String(myRows.length), myRows.length ? "当前筛选" : "暂无数据"],
        ["累计曝光", formatNumber(totalExposure), totalExposure > 0 ? "曝光 + 播放合计" : "暂无曝光数据"],
        ["总互动量", formatNumber(totalInteractions), "赞评藏转合计"],
        ["加权互动率", `${weightedEngage}%`, "按曝光量加权"],
        ["归因涨粉", `+${formatNumber(totalFollowers)}`, "内容归因涨粉"],
      ].map(([label, value, change]) => <article key={String(label)}><p>{label}<span>···</span></p><strong>{value}</strong><small>{change}</small></article>)}
    </section>
    <section className="analytics-grid">
      <article className="panel wide-chart">
        <div className="panel-head"><div><h3>负责账号表现</h3><span>近 12 周 · 周期新增量</span></div><div className="legend"><i className="teal-dot" /> 分发量 <i className="orange-dot" /> 互动率</div></div>
        {weeklyExposure.length > 0 ? (
          <div className="line-chart"><div className="grid-lines">{[0, 1, 2, 3].map((item) => <i key={item} />)}</div><div className="chart-columns">{weeklyExposure.map((value, index) => <div key={index}><i style={{ height: `${Math.max(4, (value / maxWeekly) * 100)}%` }}><span /></i><em style={{ bottom: `${Math.max(10, (value / maxWeekly) * 55)}%` }} /></div>)}</div></div>
        ) : (
          <p className="empty-state" style={{ padding: 40, textAlign: "center" }}>暂无内容数据，导入并审批通过后将在此展示趋势</p>
        )}
        <div className="axis">{weeklyExposure.length > 0 ? weeklyExposure.map((_, i) => <span key={i}>W{i + 1}</span>) : null}</div>
      </article>
      <article className="panel">
        <div className="panel-head"><div><h3>我的导入记录</h3><span>{imports.length} 批</span></div></div>
        <div className="intern-import-list">{imports.length ? imports.map((batch) => <div key={batch.id}><span className="file-tile">表</span><div><b>{batch.filename}</b><small>{batch.period} · {batch.rows} 条</small></div><StatusPill tone={batch.status === "已批准" ? "teal" : batch.status === "待审核" ? "amber" : "red"}>{batch.status}</StatusPill></div>) : <p className="empty-state">尚无导入记录</p>}</div>
      </article>
    </section>
  </>;
}

function InternNotifications() {
  const { items, mark } = useServerNotifications();
  const fallback = [
    { id: "fallback-task", kind: "task", title: "任务即将到期", detail: "「整理本周小红书内容数据并提交审核」将在今天 17:30 到期。", createdAt: "12 分钟前", readAt: null },
    { id: "fallback-report", kind: "report", title: "周报提交提醒", detail: "本周周报截止时间为周五 19:00，请提前完成复盘。", createdAt: "今天 10:00", readAt: null },
    { id: "fallback-data", kind: "data", title: "导入数据待审核", detail: "你提交的运营数据已进入 Leader 审核队列。", createdAt: "今天 09:48", readAt: null },
  ];
  const notes = items.length ? items : fallback;
  return <>
    <PageTitle eyebrow="个人消息与提醒" title="通知中心" description={`${notes.filter((item) => !item.readAt).length} 条未读通知`} actions={<button className="secondary" onClick={() => mark()}>全部标记为已读</button>} />
    <article className="panel notification-panel">{notes.map((item) => { const type = item.kind.includes("task") ? "task" : item.kind.includes("report") ? "report" : "data"; return <button key={item.id} className={item.readAt ? "read" : ""} onClick={() => mark(item.id)}><span className={`notification-icon ${type}`}>{type === "task" ? "任" : type === "report" ? "报" : "数"}</span><div><b>{item.title}</b><p>{item.detail}</p><small>{item.createdAt}</small></div>{!item.readAt && <i />}</button>; })}</article>
    <article className="panel notification-config"><span className="notification-icon task">站</span><div><h3>站内提醒已启用</h3><p>重要任务临期、任务逾期与周报截止提醒均会出现在这里。</p></div><StatusPill tone="teal">已开启</StatusPill></article>
  </>;
}

function PageTitle({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="page-title"><div><p>{eyebrow}</p><h1>{title}</h1><span>{description}</span></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

function Overview({ state, userName, onView, onTask, onImport }: { state: WorkspaceState; userName: string; onView: (view: ViewKey) => void; onTask: () => void; onImport: () => void }) {
  const completed = state.tasks.filter((task) => task.status === "已完成").length;
  const activeMembers = state.members.filter((member) => member.status === "active");
  return (
    <>
      <PageTitle eyebrow={formatToday(new Date())} title={formatGreeting(new Date(), userName)} description="本周数据表现稳定，有 1 项任务逾期、2 份周报待处理。" actions={<><button className="secondary" onClick={onImport}>导入运营数据</button><button className="primary" onClick={onTask}>＋ 发布任务</button></>} />
      <section className="hero-grid">
        <article className="hero-card">
          <div className="hero-copy"><StatusPill tone="teal">本周运营简报</StatusPill><h2>内容触达持续上扬，<br />收藏表现值得关注</h2><p>本周小红书与抖音共发布 26 条内容，统一互动率达到 <b>11.8%</b>。</p><button onClick={() => onView("analytics")}>查看完整数据 <span>→</span></button></div>
          <div className="hero-chart">
            <div className="hero-metric"><span>内容分发量</span><strong>12.8万</strong><em>↗ 18.6%</em></div>
            <div className="spark-bars">{trend.map((value, index) => <i key={index} style={{ height: `${value}%` }} />)}</div>
            <div className="chart-labels"><span>7.06</span><span>7.27</span></div>
          </div>
        </article>
        <article className="deadline-card">
          <div className="deadline-top"><span>周报截止</span><StatusPill tone="amber">周五 19:00</StatusPill></div>
          <div className="deadline-count"><strong>4</strong><span>天</span><strong>01</strong><span>小时</span></div>
          <div className="progress-track"><i style={{ width: "48%" }} /></div>
          <div className="deadline-foot"><span><b>1</b> 已提交</span><span><b>2</b> 待完成</span></div>
        </article>
      </section>

      <section className="kpi-grid">
        {[
          ["发布内容", "26", "较上周 +4", "blue"],
          ["总互动量", "15,284", "↗ 12.4%", "teal"],
          ["加权互动率", "11.8%", "↗ 1.6%", "orange"],
          ["净增粉丝", "+326", "目标完成 82%", "purple"],
        ].map(([label, value, note, tone]) => <article className="kpi-card" key={label}><span className={`kpi-icon ${tone}`}>{label.slice(0, 1)}</span><div><p>{label}</p><strong>{value}</strong><small className={note.includes("↗") ? "positive" : ""}>{note}</small></div></article>)}
      </section>

      <section className="dashboard-grid">
        <article className="panel task-panel">
          <div className="panel-head"><div><h3>今日任务</h3><span>{completed}/{state.tasks.length} 已完成</span></div><button onClick={() => onView("tasks")}>查看全部 →</button></div>
          <div className="mini-progress"><i style={{ width: `${Math.max(12, (completed / state.tasks.length) * 100)}%` }} /></div>
          <div className="task-list">
            {state.tasks.slice(0, 4).map((task) => <div className="task-row" key={task.id}><span className={`check ${task.status === "已完成" ? "done" : ""}`}>{task.status === "已完成" ? "✓" : ""}</span><div><b>{task.title}</b><small>{task.project}</small></div><span className={task.status === "已逾期" ? "due overdue" : "due"}>{task.due}</span></div>)}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head"><div><h3>团队进度</h3><span>{activeMembers.length - 1} 名实习生</span></div><button onClick={() => onView("reports")}>团队周报 →</button></div>
          <div className="team-list">
            {state.reports.map((report) => {
              const member = state.members.find((item) => item.id === report.memberId)!;
              return <div className="team-row" key={report.id}><Avatar member={member} /><div><b>{report.memberName}<StatusPill tone={report.status === "已提交" ? "teal" : report.status === "待修改" ? "amber" : "neutral"}>{report.status}</StatusPill></b><span className="member-progress"><i style={{ width: `${report.progress}%` }} /></span></div><strong>{report.progress}%</strong></div>;
            })}
          </div>
        </article>
      </section>

      <section className="bottom-grid">
        <article className="panel">
          <div className="panel-head"><div><h3>待处理事项</h3><span>需要你的关注</span></div></div>
          <div className="attention-list">
            <button onClick={() => onView("analytics")}><span className="attention-icon amber">数</span><div><b>1 批数据等待审核</b><small>其中 2 条存在字段警告</small></div><i>→</i></button>
            <button onClick={() => onView("members")}><span className="attention-icon violet">人</span><div><b>1 位成员申请加入</b><small>谢可欣 · 35 分钟前</small></div><i>→</i></button>
            <button onClick={() => onView("reports")}><span className="attention-icon blue">评</span><div><b>1 份周报等待点评</b><small>林小满 · 今天 15:42</small></div><i>→</i></button>
          </div>
        </article>
        <article className="panel week-card">
          <div className="panel-head"><div><h3>本周节奏</h3><span>10:00—19:00</span></div></div>
          <div className="week-days">{["一", "二", "三", "四", "五", "六", "日"].map((day, index) => <span key={day} className={index === 0 ? "today" : index > 4 ? "weekend" : ""}><small>周{day}</small><b>{27 + index}</b>{index === 4 && <i />}</span>)}</div>
          <p>周五 19:00 周报截止 <b>·</b> 非紧急提醒仅在工作时间内发送</p>
        </article>
      </section>
    </>
  );
}

function Analytics({ state, onImport, onMutate, onReviewImport }: {
  state: WorkspaceState;
  onImport: () => void;
  onMutate: (next: WorkspaceState, action: string) => void;
  onReviewImport: (batchId: string, action: "approve" | "reject") => Promise<void>;
}) {
  const [basis, setBasis] = useState("内容累计表现");
  const [platform, setPlatform] = useState("全部平台");
  const [tab, setTab] = useState<"看板" | "内容明细" | "导入审核">("看板");
  const [platformManager, setPlatformManager] = useState(false);
  const dataRows = state.contentRows.length ? state.contentRows : platformRows;
  const activePlatforms = state.platforms.filter((item) => item.active);
  const basisRows = dataRows.filter((row) => !("basis" in row) || !row.basis || row.basis === basis);
  const filteredRows = platform === "全部平台" ? basisRows : basisRows.filter((row) => row.platform === platform);
  const metricTypeOf = (row: ContentDataRow | typeof platformRows[number]) => (
    "metricType" in row ? row.metricType : row.platform === "小红书" ? "曝光量" : "播放量"
  );
  const impressions = filteredRows.filter((row) => metricTypeOf(row) === "曝光量").reduce((sum, row) => sum + row.exposure, 0);
  const plays = filteredRows.filter((row) => metricTypeOf(row) === "播放量").reduce((sum, row) => sum + row.exposure, 0);
  const interactions = filteredRows.reduce((sum, row) => sum + row.likes + row.comments + row.saves + row.shares, 0);
  const followerGain = filteredRows.reduce((sum, row) => sum + row.followers, 0);
  const totalDistribution = impressions + plays;
  const interactionsPerThousand = totalDistribution > 0 ? interactions / totalDistribution * 1000 : 0;
  const weightedMetric = (field: "exit" | "five" | "complete") => {
    const available = filteredRows.filter((row) => row[field] != null && row.exposure > 0);
    const denominator = available.reduce((sum, row) => sum + row.exposure, 0);
    if (!denominator) return null;
    return Math.round(available.reduce((sum, row) => sum + Number(row[field]) * row.exposure, 0) / denominator * 10) / 10;
  };
  const weightedExit = weightedMetric("exit");
  const retentionRows = [
    { label: "2秒留存率", value: weightedExit == null ? null : Math.round((100 - weightedExit) * 10) / 10 },
    { label: "5秒完播率", value: weightedMetric("five") },
    { label: "全篇完播率", value: weightedMetric("complete") },
  ];
  const topRows = [...filteredRows].sort((left, right) => right.engage - left.engage || left.exposure - right.exposure).slice(0, 3);
  const platformStats = activePlatforms.map((item) => {
    const rows = basisRows.filter((row) => row.platform === item.name);
    return { ...item, total: rows.reduce((sum, row) => sum + row.exposure, 0), hasData: rows.length > 0 };
  });
  const maxPlatformTotal = Math.max(1, ...platformStats.map((item) => item.total));
  return (
    <>
      <PageTitle eyebrow={`账号数据 · ${formatWeekRange(new Date())}`} title="运营数据看板" description="周一至周日统计 · 两种数据口径独立展示" actions={<button className="primary" onClick={onImport}>＋ 导入数据</button>} />
      <div className="filter-bar">
        <div className="segmented">{["看板", "内容明细", "导入审核"].map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item as typeof tab)}>{item}{item === "导入审核" && <em>{state.imports.filter((batch) => batch.status === "待审核").length}</em>}</button>)}</div>
        <div className="filters"><select value={basis} onChange={(event) => setBasis(event.target.value)}><option>周期新增量</option><option>内容累计表现</option></select><select aria-label="平台筛选" value={platform} onChange={(event) => setPlatform(event.target.value)}><option>全部平台</option>{activePlatforms.map((item) => <option key={item.id}>{item.name}</option>)}</select><button className="platform-manage-trigger" onClick={() => setPlatformManager(true)}>＋ 管理平台</button><button>{formatWeekRange(new Date())}　⌄</button></div>
      </div>
      {tab === "看板" && <>
        <div className="notice-line"><span>i</span><p>当前口径为 <b>{basis}</b>，平台为 <b>{platform}</b>。平台名称、别名和默认分发指标可由 Leader 管理，导入时自动匹配。</p></div>
        <section className="analytics-kpis">
          {[
            ["发布内容", String(filteredRows.length), "当前筛选"],
            ["总曝光量", formatNumber(impressions), impressions ? "曝光口径" : "暂无曝光数据"],
            ["总播放量", formatNumber(plays), plays ? "播放口径" : "暂无播放数据"],
            ["总互动量", formatNumber(interactions), "赞评藏转合计"],
            ["每千次分发互动", interactionsPerThousand.toFixed(1), "统一计算指标"],
            ["内容归因涨粉", `+${formatNumber(followerGain)}`, "非账号净增粉"],
          ].map(([label, value, note]) => <article key={label}><p>{label}<span>···</span></p><strong>{value}</strong><small>{note}</small></article>)}
        </section>
        <section className="analytics-grid">
          <article className="panel wide-chart">
            <div className="panel-head"><div><h3>分发与互动趋势</h3><span>近 12 周 · {basis}</span></div><div className="legend"><i className="teal-dot" /> 分发量 <i className="orange-dot" /> 互动率</div></div>
            <div className="line-chart">
              <div className="grid-lines">{[0, 1, 2, 3].map((item) => <i key={item} />)}</div>
              <div className="chart-columns">{trend.map((value, index) => <div key={index}><i style={{ height: `${value}%` }}><span /></i><em style={{ bottom: `${Math.max(10, value * .55)}%` }} /></div>)}</div>
            </div>
            <div className="axis"><span>5.11</span><span>5.25</span><span>6.08</span><span>6.22</span><span>7.06</span><span>7.26</span></div>
          </article>
          <article className="panel retention-card">
            <div className="panel-head"><div><h3>内容留存</h3><span>视频内容加权值</span></div></div>
            {retentionRows.map(({ label, value }) => <div className="retention-row" key={label}><div><b>{label}</b><span>{value == null ? "暂无数据" : `${value}%`}</span></div><div className="retention-track"><i style={{ width: `${value || 0}%` }} /></div><small>{value == null ? "未提供" : "按分发量加权"}</small></div>)}
            <div className="insight"><span>洞察</span><p>前 5 秒留存持续提升，但全篇完播略有回落，建议缩短中段铺垫。</p></div>
          </article>
        </section>
        <section className="analytics-grid lower">
          <article className="panel"><div className="panel-head"><div><h3>平台表现</h3><span>不合并不同分发口径</span></div></div>
            <div className="platform-list">{platformStats.map((item) => <div key={item.id}><span className="platform-badge" style={{ background: item.color }}>{item.name.slice(0, 1)}</span><b>{item.name}</b><span className="platform-track"><i style={{ width: `${Math.round((item.total / maxPlatformTotal) * 100)}%`, background: item.color }} /></span><em>{item.hasData ? `${formatNumber(item.total)} ${item.metricType.replace("量", "")}` : "暂无数据"}</em></div>)}</div>
          </article>
          <article className="panel"><div className="panel-head"><div><h3>高潜内容</h3><span>高互动、待放量</span></div><button onClick={() => setTab("内容明细")}>全部内容 →</button></div>
            <div className="rank-list">{topRows.length ? topRows.map((row, index) => <div key={"id" in row ? row.id : row.title}><span>{index + 1}</span><div><b>{row.title}</b><small>{row.account} · 互动率 {row.engage}%</small></div><em>{formatNumber(row.exposure)}</em></div>) : <p className="empty-state">当前筛选暂无内容数据</p>}</div>
          </article>
        </section>
      </>}
      {tab === "内容明细" && <ContentTable platform={platform} rows={basisRows} />}
      {tab === "导入审核" && <ImportReview state={state} onReview={onReviewImport} />}
      {platformManager && <PlatformManagerModal state={state} onClose={() => setPlatformManager(false)} onMutate={onMutate} />}
    </>
  );
}

function ContentTable({ platform, rows: allRows }: { platform: string; rows: Array<ContentDataRow | typeof platformRows[number]> }) {
  const rows = platform === "全部平台" ? allRows : allRows.filter((row) => row.platform === platform);
  return <article className="panel table-panel"><div className="panel-head"><div><h3>内容明细</h3><span>{rows.length} 条内容 · “—”代表平台未提供</span></div><button>导出当前视图</button></div><div className="table-scroll"><table><thead><tr><th>平台 / 账号</th><th>发布内容</th><th>曝光 / 播放</th><th>2秒退出率</th><th>5秒完播率</th><th>互动率</th><th>互动结构</th><th>全篇完播</th><th>归因涨粉</th></tr></thead><tbody>{rows.map((row) => <tr key={"id" in row ? row.id : row.title}><td><b>{row.platform}</b><small>{row.account}</small></td><td><strong>{row.title}</strong><small>{"metricType" in row ? `${row.metricType}口径` : "图文 / 视频内容"}</small></td><td>{formatNumber(row.exposure)}</td><td>{row.exit == null ? <EmptyMetric /> : `${row.exit}%`}</td><td>{row.five == null ? <EmptyMetric /> : `${row.five}%`}</td><td><StatusPill tone={row.engage > 12 ? "teal" : "neutral"}>{row.engage}%</StatusPill></td><td><span className="interactions">赞 {row.likes} · 评 {row.comments}<br />藏 {row.saves} · 转 {row.shares}</span></td><td>{row.complete == null ? <EmptyMetric /> : `${row.complete}%`}</td><td>+{row.followers}</td></tr>)}</tbody></table></div></article>;
}

function ImportReview({ state, onReview }: { state: WorkspaceState; onReview: (batchId: string, action: "approve" | "reject") => Promise<void> }) {
  const [busyId, setBusyId] = useState("");
  const review = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    try {
      await onReview(id, action);
    } finally {
      setBusyId("");
    }
  };
  return <div className="review-list">{state.imports.map((batch) => <article className="panel import-card" key={batch.id}><div className="file-tile">表</div><div className="import-main"><div><h3>{batch.filename}</h3><StatusPill tone={batch.status === "待审核" ? "amber" : batch.status === "已批准" ? "teal" : "red"}>{batch.status}</StatusPill></div><p>{batch.uploader} · {batch.createdAt} · {batch.period}</p><div className="import-facts"><span><b>{batch.rows}</b> 条记录</span><span><b>{batch.basis}</b> 数据口径</span><span><b>{batch.metricType}</b> 分发类型</span><span><b>{batch.detectedPlatforms?.join("、") || "待识别"}</b> 已匹配平台</span><span className={batch.warnings ? "warn" : ""}><b>{batch.warnings}</b> 条警告</span></div>{Boolean(batch.unmatchedPlatforms?.length) && <p className="unmatched-platforms">未匹配：{batch.unmatchedPlatforms?.join("、")}。请先在平台管理中新增或设置为别名。</p>}</div>{batch.status === "待审核" && <div className="review-actions"><button className="secondary" disabled={busyId === batch.id} onClick={() => void review(batch.id, "reject")}>拒绝</button><button className="primary" disabled={busyId === batch.id} onClick={() => void review(batch.id, "approve")}>{busyId === batch.id ? "正在审核…" : "批准导入"}</button></div>}</article>)}</div>;
}

function Reports({ state, onOpen, onMutate }: { state: WorkspaceState; onOpen: (report: Report) => void; onMutate: (next: WorkspaceState, action: string) => void }) {
  const submitted = state.reports.filter((report) => report.status === "已提交" || report.status === "已点评").length;
  return <>
    <PageTitle eyebrow={`团队周报 · ${formatWeekRange(new Date())}`} title="本周周报" description={`周五 19:00 截止 · ${submitted}/${state.reports.length} 已提交`} actions={<button className="secondary">历史周报</button>} />
    <div className="report-summary"><article><span>已提交</span><strong>{submitted}</strong><small>等待 Leader 点评</small></article><article><span>进行中</span><strong>{state.reports.filter((item) => item.status === "草稿").length}</strong><small>周五 19:00 前提交</small></article><article><span>需修改</span><strong>{state.reports.filter((item) => item.status === "待修改").length}</strong><small>已发送修改建议</small></article><article className="report-deadline"><span>距截止</span><strong>4天 01小时</strong><small>下一次提醒：周五 10:00</small></article></div>
    <div className="report-grid">{state.reports.map((report) => {
      const member = state.members.find((item) => item.id === report.memberId)!;
      return <article className="report-card" key={report.id}><div className="report-card-head"><Avatar member={member} /><div><h3>{report.memberName}</h3><span>更新于 {report.updatedAt}</span></div><StatusPill tone={report.status === "已提交" ? "teal" : report.status === "待修改" ? "amber" : "neutral"}>{report.status}</StatusPill></div><div className="report-progress"><span><i style={{ width: `${report.progress}%` }} /></span><b>{report.progress}%</b></div><div className="report-preview"><p><b>本周完成</b>{report.completed}</p><p><b>关键结果</b>{report.result}</p></div><div className="report-card-foot"><span>{report.review ? "已有修改建议" : report.status === "已提交" ? "等待点评" : "自动保存已开启"}</span><button className={report.status === "已提交" ? "primary" : "secondary"} onClick={() => onOpen(report)}>{report.status === "已提交" ? "开始点评" : "查看周报"}</button></div></article>;
    })}</div>
    <article className="panel report-rule"><span>时间</span><div><h3>自动提醒计划</h3><p>周五 10:00 当日提醒 · 17:00 距截止 2 小时 · 18:30 最后提醒 · 19:00 自动截止</p></div><button onClick={() => onMutate(state, "查看提醒规则")}>查看规则</button></article>
  </>;
}

function Tasks({ state, onCreate, onMutate }: { state: WorkspaceState; onCreate: () => void; onMutate: (next: WorkspaceState, action: string) => void }) {
  const [filter, setFilter] = useState("全部");
  const filtered = filter === "全部" ? state.tasks : state.tasks.filter((task) => task.status === filter);
  const toggle = (id: string) => onMutate({ ...state, tasks: state.tasks.map((task) => task.id === id ? { ...task, status: task.status === "已完成" ? "进行中" : "已完成" } : task) }, "更新任务状态");
  return <>
    <PageTitle eyebrow="团队执行 · 今日" title="每日任务" description="任务状态、负责人和 DDL 集中管理" actions={<button className="primary" onClick={onCreate}>＋ 发布任务</button>} />
    <section className="task-stats">{[["今日任务", state.tasks.length], ["进行中", state.tasks.filter((task) => task.status === "进行中").length], ["已完成", state.tasks.filter((task) => task.status === "已完成").length], ["已逾期", state.tasks.filter((task) => task.status === "已逾期").length]].map(([label, value], index) => <article key={String(label)} className={index === 3 ? "danger" : ""}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <div className="task-toolbar"><div className="segmented">{["全部", "待开始", "进行中", "已完成", "已逾期"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><div><button>按负责人 ⌄</button><button>按 DDL 排序</button></div></div>
    <article className="panel table-panel task-table"><table><thead><tr><th>完成</th><th>任务</th><th>负责人</th><th>优先级</th><th>状态</th><th>DDL</th><th></th></tr></thead><tbody>{filtered.map((task) => {
      const member = state.members.find((item) => item.name === task.assignee);
      return <tr key={task.id}><td><button className={`check large ${task.status === "已完成" ? "done" : ""}`} onClick={() => toggle(task.id)}>{task.status === "已完成" ? "✓" : ""}</button></td><td><strong>{task.title}</strong><small>{task.project} · 创建于 {task.createdAt}</small></td><td><span className="assignee">{member && <Avatar member={member} small />}{task.assignee}</span></td><td><StatusPill tone={task.priority === "紧急" ? "red" : task.priority === "重要" ? "amber" : "neutral"}>{task.priority}</StatusPill></td><td><StatusPill tone={task.status === "已完成" ? "teal" : task.status === "已逾期" ? "red" : "neutral"}>{task.status}</StatusPill></td><td className={task.status === "已逾期" ? "overdue-text" : ""}>{task.due}</td><td><button className="more">···</button></td></tr>;
    })}</tbody></table></article>
  </>;
}

function Notifications({ state, onMutate }: { state: WorkspaceState; onMutate: (next: WorkspaceState, action: string) => void }) {
  const { items, mark } = useServerNotifications();
  const markAll = () => { void mark(); onMutate({ ...state, notifications: state.notifications.map((item) => ({ ...item, read: true })) }, "全部标记为已读"); };
  return <>
    <PageTitle eyebrow="消息与提醒" title="通知中心" description={`${state.notifications.filter((item) => !item.read).length + items.filter((item) => !item.readAt).length} 条未读通知`} actions={<button className="secondary" onClick={markAll}>全部标记为已读</button>} />
    <article className="panel notification-panel">{items.map((item) => { const type = item.kind.includes("task") ? "task" : item.kind.includes("report") ? "report" : "data"; return <button key={item.id} className={item.readAt ? "read" : ""} onClick={() => mark(item.id)}><span className={`notification-icon ${type}`}>{type === "task" ? "任" : type === "report" ? "报" : "数"}</span><div><b>{item.title}</b><p>{item.detail}</p><small>{item.createdAt}</small></div>{!item.readAt && <i />}</button>; })}{state.notifications.map((item) => <button key={item.id} className={item.read ? "read" : ""} onClick={() => onMutate({ ...state, notifications: state.notifications.map((note) => note.id === item.id ? { ...note, read: true } : note) }, "阅读通知")}><span className={`notification-icon ${item.type}`}>{item.type === "task" ? "任" : item.type === "report" ? "报" : item.type === "member" ? "人" : "数"}</span><div><b>{item.title}</b><p>{item.detail}</p><small>{item.time}</small></div>{!item.read && <i />}</button>)}</article>
    <article className="panel notification-config"><span className="notification-icon task">站</span><div><h3>站内提醒已启用</h3><p>任务逾期、重要任务临期和周报截止提醒均在工作台内送达。</p></div><StatusPill tone="teal">已开启</StatusPill></article>
  </>;
}

type AccountView = {
  id: string;
  membershipId: string;
  username: string;
  displayName: string;
  role: "leader" | "intern";
  membershipStatus: "active" | "pending" | "left" | "rejected";
  accountStatus: "active" | "disabled";
  mustChangePassword: boolean;
  joinedAt: string | null;
};

function Members({ state }: { state: WorkspaceState }) {
  const [tab, setTab] = useState<"在组成员" | "已停用">("在组成员");
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"leader" | "intern">("intern");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [credential, setCredential] = useState<{ username: string; password: string } | null>(null);
  const load = async () => {
    const response = await fetch("/api/admin/accounts");
    const data = await response.json();
    if (response.ok) setAccounts(data.accounts || []);
  };
  useEffect(() => {
    void fetch("/api/admin/accounts")
      .then(async (response) => response.ok ? response.json() : { accounts: [] })
      .then((data) => setAccounts(data.accounts || []));
  }, []);
  const create = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, displayName, role }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "创建账号失败");
      setCredential({ username: data.username, password: data.temporaryPassword });
      setCreateOpen(false);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建账号失败");
    } finally {
      setBusy(false);
    }
  };
  const operate = async (account: AccountView, action: "disable" | "enable" | "reset_password") => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/admin/accounts/${account.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "账号操作失败");
      if (data.temporaryPassword) setCredential({ username: account.username, password: data.temporaryPassword });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "账号操作失败");
    } finally {
      setBusy(false);
    }
  };
  const shown = accounts.filter((account) => tab === "在组成员" ? account.accountStatus === "active" && account.membershipStatus === "active" : account.accountStatus === "disabled" || account.membershipStatus === "left");
  return <>
    <PageTitle eyebrow="内部账号" title="成员管理" description={`${accounts.filter((account) => account.accountStatus === "active" && account.membershipStatus === "active").length || state.members.filter((member) => member.status === "active").length} 名有效成员 · 账号与角色由 Leader 统一管理`} actions={<button className="primary" onClick={() => setCreateOpen(true)}>＋ 创建内部账号</button>} />
    <div className="member-banner"><div><span>账</span><div><h3>内部账号管理</h3><p>新账号使用一次性临时密码，成员首次登录后必须设置个人密码。</p></div></div><StatusPill tone="teal">内网专用</StatusPill></div>
    <div className="segmented member-tabs">{(["在组成员", "已停用"] as const).map((item) => <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>
    {message && <p className="auth-message">{message}</p>}
    <article className="panel member-table"><table><thead><tr><th>成员</th><th>登录用户名</th><th>角色</th><th>密码状态</th><th>加入时间</th><th>操作</th></tr></thead><tbody>{shown.map((account) => {
      const member = state.members.find((item) => item.id === account.membershipId) || { name: account.displayName, initials: account.displayName.slice(0, 1), color: account.role === "leader" ? "#173f3a" : "#6389a8" };
      return <tr key={account.id}><td><span className="assignee"><Avatar member={member} /> <b>{account.displayName}</b></span></td><td><code>{account.username}</code></td><td><StatusPill tone={account.role === "leader" ? "teal" : "neutral"}>{account.role === "leader" ? "Leader" : "实习生"}</StatusPill></td><td><StatusPill tone={account.mustChangePassword ? "amber" : "teal"}>{account.mustChangePassword ? "等待首次改密" : "已设置"}</StatusPill></td><td>{account.joinedAt || "—"}</td><td><div className="row-actions">{account.accountStatus === "active" ? <><button className="secondary" disabled={busy} onClick={() => operate(account, "reset_password")}>重置密码</button><button className="text-danger" disabled={busy} onClick={() => operate(account, "disable")}>停用</button></> : <button className="secondary" disabled={busy} onClick={() => operate(account, "enable")}>重新启用</button>}</div></td></tr>;
    })}</tbody></table></article>
    {createOpen && <Modal title="创建内部账号" subtitle="账号创建后会生成只展示一次的临时密码" onClose={() => setCreateOpen(false)} footer={<><button className="secondary" onClick={() => setCreateOpen(false)}>取消</button><button className="primary" disabled={busy || username.length < 3 || !displayName.trim()} onClick={create}>{busy ? "正在创建…" : "创建账号"}</button></>}>
      <label>登录用户名<input autoFocus value={username} onChange={(event) => setUsername(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} placeholder="例如：intern-lin" /></label>
      <label>成员姓名<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如：林小满" /></label>
      <label>职位<select value={role} onChange={(event) => setRole(event.target.value as "leader" | "intern")}><option value="intern">实习生</option><option value="leader">Leader</option></select></label>
      {message && <p className="auth-message">{message}</p>}
    </Modal>}
    {credential && <Modal title="请立即保存临时密码" subtitle="关闭后系统不会再次显示该密码" onClose={() => { setCredential(null); window.location.reload(); }} footer={<button className="primary" onClick={() => { setCredential(null); window.location.reload(); }}>我已安全保存</button>}>
      <div className="credential-box"><span>用户名</span><code>{credential.username}</code><span>临时密码</span><code>{credential.password}</code></div>
      <div className="form-hint warning"><span>!</span>请通过公司认可的安全渠道单独发送给成员，成员首次登录后必须修改。</div>
    </Modal>}
  </>;
}

function Settings({ onPasswordChange }: { onPasswordChange: () => void }) {
  const [weekend, setWeekend] = useState(false);
  return <>
    <PageTitle eyebrow="内容增长组" title="小组设置" description="工作规则、登录方式与通知渠道" actions={<button className="primary">保存设置</button>} />
    <div className="settings-grid">
      <article className="panel settings-card"><h3>基本信息</h3><label>小组名称<input defaultValue="内容增长组" /></label><label>小组简介<textarea defaultValue="负责多平台内容运营、数据复盘与增长实验。" /></label><div className="setting-row"><div><b>内网专用</b><span>不开放搜索、注册或外部申请加入</span></div><StatusPill tone="teal">已启用</StatusPill></div></article>
      <article className="panel settings-card"><h3>工作与周报</h3><div className="two-inputs"><label>工作开始<input type="time" defaultValue="10:00" /></label><label>工作结束<input type="time" defaultValue="19:00" /></label></div><label>周报截止<select defaultValue="周五 19:00"><option>周五 19:00</option></select></label><div className="setting-row"><div><b>周末任务提醒</b><span>普通提醒默认顺延到下周一</span></div><button className={`switch ${weekend ? "on" : ""}`} onClick={() => setWeekend(!weekend)}><i /></button></div></article>
      <article className="panel settings-card"><h3>登录与安全</h3><div className="integration"><span className="inside">密</span><div><b>内部账号密码</b><small>账号由 Leader 创建，首次登录强制改密</small></div><StatusPill tone="teal">已启用</StatusPill></div><button className="secondary" onClick={onPasswordChange}>修改我的登录密码</button><p className="settings-note">连续 5 次登录失败会临时锁定账号 15 分钟。</p></article>
      <article className="panel settings-card"><h3>通知渠道</h3><div className="integration"><span className="inside">站</span><div><b>站内通知</b><small>任务、周报、数据审核与账号动态</small></div><StatusPill tone="teal">已启用</StatusPill></div><p className="settings-note">提醒仅在工作台内发送，成员无需绑定外部联系方式。</p></article>
    </div>
  </>;
}

function Modal({ title, subtitle, onClose, children, footer }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true"><header><div><h2>{title}</h2><p>{subtitle}</p></div><button aria-label="关闭" onClick={onClose}>×</button></header><div className="modal-body">{children}</div><footer>{footer}</footer></section></div>;
}

function TaskModal({ state, onClose, onSave }: { state: WorkspaceState; onClose: () => void; onSave: (task: Task) => void }) {
  const interns = state.members.filter((member) => member.status === "active" && member.role === "intern");
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(interns[0]?.name || "");
  const [priority, setPriority] = useState<Task["priority"]>("普通");
  const [dueAt, setDueAt] = useState("2026-07-29T18:00");
  const save = () => title.trim() && onSave({ id: `t${Date.now()}`, title: title.trim(), assignee, priority, status: "待开始", due: dueAt.replace("T", " "), dueAt: `${dueAt}:00+08:00`, project: "日常运营", createdAt: "刚刚" });
  return <Modal title="发布每日任务" subtitle="通过负责人和 DDL 明确交付责任" onClose={onClose} footer={<><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={save} disabled={!title.trim()}>发布任务</button></>}>
    <label>任务标题<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：整理本周小红书运营数据" /></label><label>任务说明<textarea placeholder="补充交付标准、参考资料或成果链接要求" /></label><div className="form-grid"><label>负责人<select value={assignee} onChange={(event) => setAssignee(event.target.value)}>{interns.map((member) => <option key={member.id}>{member.name}</option>)}</select></label><label>优先级<select value={priority} onChange={(event) => setPriority(event.target.value as Task["priority"])}><option>普通</option><option>重要</option><option>紧急</option></select></label></div><div className="form-grid"><label>开始时间<input type="datetime-local" defaultValue="2026-07-28T10:00" /></label><label>DDL<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label></div><div className="form-hint"><span>i</span>非紧急提醒只在 10:00—19:00 发送；重要任务临期与逾期会发送站内提醒。</div>
  </Modal>;
}

function PlatformManagerModal({ state, onClose, onMutate }: { state: WorkspaceState; onClose: () => void; onMutate: (next: WorkspaceState, action: string) => void }) {
  const [draft, setDraft] = useState(state.platforms.map((platform) => ({ ...platform, aliases: [...platform.aliases], domains: [...platform.domains] })));
  const [newName, setNewName] = useState("");
  const [newMetricType, setNewMetricType] = useState<PlatformDefinition["metricType"]>("播放量");
  const [error, setError] = useState("");
  const update = (id: string, patch: Partial<PlatformDefinition>) => setDraft((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    if (draft.some((item) => item.name.trim().toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN"))) {
      setError("平台名称不能重复");
      return;
    }
    const colors = ["#557fa0", "#8a6f9e", "#c46e54", "#258b78", "#b3843e"];
    setDraft((items) => [...items, { id: `platform_${Date.now()}`, name, aliases: [], domains: [], metricType: newMetricType, color: colors[items.length % colors.length], active: true }]);
    setNewName("");
    setError("");
  };
  const save = () => {
    const normalized = draft.map((item) => ({ ...item, name: item.name.trim(), aliases: item.aliases.map((alias) => alias.trim()).filter(Boolean), domains: item.domains.map((domain) => domain.trim().toLowerCase()).filter(Boolean) }));
    if (normalized.some((item) => !item.name)) {
      setError("平台名称不能为空");
      return;
    }
    if (new Set(normalized.map((item) => item.name.toLocaleLowerCase("zh-CN"))).size !== normalized.length) {
      setError("平台名称不能重复");
      return;
    }
    const previousNames = new Map(state.platforms.map((item) => [item.id, item.name]));
    const renamed = new Map(normalized.map((item) => [previousNames.get(item.id), item.name]).filter(([before, after]) => Boolean(before && before !== after)) as Array<[string, string]>);
    onMutate({
      ...state,
      platforms: normalized,
      contentRows: state.contentRows.map((row) => renamed.has(row.platform) ? { ...row, platform: renamed.get(row.platform)! } : row),
      imports: state.imports.map((batch) => ({
        ...batch,
        detectedPlatforms: batch.detectedPlatforms?.map((name) => renamed.get(name) || name),
        unmatchedPlatforms: batch.unmatchedPlatforms?.filter((name) => !normalized.some((platform) => platform.name === name || platform.aliases.includes(name))),
      })),
    }, "更新平台与自动识别规则");
    onClose();
  };
  return <Modal title="平台管理" subtitle="Leader 可自定义平台名称、识别别名、链接域名和默认分发指标" onClose={onClose} footer={<><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={save}>保存平台设置</button></>}>
    <div className="platform-manager-list">{draft.map((item) => <section key={item.id} className={!item.active ? "disabled" : ""}><div className="platform-manager-head"><span className="platform-badge" style={{ background: item.color }}>{item.name.slice(0, 1) || "平"}</span><input aria-label={`${item.name}平台名称`} value={item.name} onChange={(event) => update(item.id, { name: event.target.value })} /><select aria-label={`${item.name}默认指标`} value={item.metricType} onChange={(event) => update(item.id, { metricType: event.target.value as PlatformDefinition["metricType"] })}><option>曝光量</option><option>播放量</option></select><button className={`switch ${item.active ? "on" : ""}`} aria-label={`${item.name}${item.active ? "停用" : "启用"}`} onClick={() => update(item.id, { active: !item.active })}><i /></button></div><label>识别别名<input value={item.aliases.join("，")} onChange={(event) => update(item.id, { aliases: event.target.value.split(/[，,]/) })} placeholder="例如：XHS，RedNote" /></label><label>链接域名<input value={item.domains.join("，")} onChange={(event) => update(item.id, { domains: event.target.value.split(/[，,]/) })} placeholder="例如：example.com" /></label></section>)}</div>
    <div className="platform-add-row"><label>新增平台<input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="输入自定义平台名" /></label><label>默认分发指标<select value={newMetricType} onChange={(event) => setNewMetricType(event.target.value as PlatformDefinition["metricType"])}><option>曝光量</option><option>播放量</option></select></label><button className="secondary" onClick={add} disabled={!newName.trim()}>＋ 添加</button></div>
    {error && <p className="auth-message">{error}</p>}
    <div className="form-hint"><span>i</span>导入时会优先按平台名称和别名匹配；平台列为空时，可根据内容链接域名自动识别。</div>
  </Modal>;
}

function ImportModal({ onClose, onSave, platforms, uploader }: { onClose: () => void; onSave: (batch: ImportBatch, file: File) => Promise<void>; platforms: PlatformDefinition[]; uploader?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState(1);
  const [basis, setBasis] = useState<ImportBatch["basis"]>("内容累计表现");
  const [metricType, setMetricType] = useState<ImportBatch["metricType"]>("自动识别");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const chooseFile = (candidate?: File | null) => {
    if (!candidate) return;
    const lowerName = candidate.name.toLowerCase();
    if (!lowerName.endsWith(".csv") && !lowerName.endsWith(".xlsx")) {
      setFile(null);
      setError("文件格式不支持，请选择 .csv 或 .xlsx 文件");
      return;
    }
    if (candidate.size <= 0 || candidate.size > 10 * 1024 * 1024) {
      setFile(null);
      setError("文件必须有内容且不能超过 10MB");
      return;
    }
    setFile(candidate);
    setError("");
  };
  const dropFile = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    const fromFileList = event.dataTransfer.files?.[0];
    const fromItems = Array.from(event.dataTransfer.items || []).find((item) => item.kind === "file")?.getAsFile();
    if (!fromFileList && !fromItems) {
      setError("浏览器没有提供文件内容，请从“下载”文件夹拖入，或点击上传框选择文件");
      return;
    }
    chooseFile(fromFileList || fromItems);
  };
  const save = async () => {
    if (!file) return;
    setSubmitting(true);
    setError("");
    try {
      await onSave({ id: `i${Date.now()}`, filename: file.name, uploader, period: "2026-07-20 至 2026-07-26", basis, metricType, rows: 0, warnings: 0, status: "待审核", createdAt: "刚刚" }, file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败");
      setSubmitting(false);
    }
  };
  return <Modal title="导入运营数据" subtitle={`步骤 ${step}/3 · ${step === 1 ? "上传文件" : step === 2 ? "确认字段映射" : "服务端校验并提交"}`} onClose={onClose} footer={<><button className="secondary" disabled={submitting} onClick={step === 1 ? onClose : () => setStep(step - 1)}>{step === 1 ? "取消" : "上一步"}</button><button className="primary" disabled={submitting || (step === 1 && !file)} onClick={step === 3 ? save : () => setStep(step + 1)}>{submitting ? "正在解析并上传…" : step === 3 ? "提交 Leader 审核" : "下一步"}</button></>}>
    {step === 1 && <><label className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={dropFile}><input type="file" accept=".xlsx,.csv" onChange={(event) => chooseFile(event.target.files?.[0])} /><span className="upload-mark">{file ? "✓" : "↑"}</span><b>{file?.name || (dragging ? "松开鼠标即可添加文件" : "拖入文件，或点击选择 Excel / CSV")}</b><small>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB · 文件已选择，可以点击下一步` : "支持 .xlsx、.csv，最大10MB · 原始文件将保存在公司服务器"}</small></label>{error && <p className="auth-message">{error}</p>}<div className="form-grid"><label>统计周期<input defaultValue="2026-07-20 至 2026-07-26" /></label><label>数据口径<select value={basis} onChange={(event) => setBasis(event.target.value as ImportBatch["basis"])}><option>内容累计表现</option><option>周期新增量</option></select></label></div></>}
    {step === 2 && <><div className="mapping-head"><b>识别到 13 个字段</b><span>{platforms.filter((item) => item.active).length} 个平台规则已启用</span></div><div className="mapping-list">{[["平台", "按名称 / 别名 / 链接自动匹配"], ["账号名", "账号名称"], ["发布内容", "标题 + 摘要 + 链接"], ["曝光数｜播放量", metricType], ["5秒完播", "5秒完播率"], ["涨粉数", "内容归因涨粉"]].map(([from, to], index) => <div key={from}><span>{from}</span><i>→</i>{index === 3 ? <select value={metricType} onChange={(event) => setMetricType(event.target.value as ImportBatch["metricType"])}><option>自动识别</option><option>曝光量</option><option>播放量</option></select> : <b>{to}</b>}</div>)}</div><div className="form-hint"><span>i</span>选择“自动识别”后，每一行会使用已匹配平台的默认分发指标；未知平台将标记为待确认，不会误归类。</div></>}
    {step === 3 && <><div className="validation-summary"><div className="valid"><strong>自动</strong><span>识别平台及字段</span></div><div className="warning"><strong>严格</strong><span>校验0、空值与未知平台</span></div><div><strong>审核</strong><span>批准后写入对应平台</span></div></div><div className="validation-list"><p><span>✓</span><b>原始文件将完整保留</b><small>Excel/CSV写入公司服务器持久目录</small></p><p><span>✓</span><b>平台名称、别名与链接联合识别</b><small>匹配后统一写入平台标准名称</small></p><p><span>✓</span><b>Leader 批准后进入正式看板</b><small>未知平台必须先新增或配置别名才能批准</small></p></div>{error && <p className="auth-message">{error}</p>}</>}
  </Modal>;
}

function ReportModal({ report, onClose, onSave }: { report: Report; onClose: () => void; onSave: (report: Report) => void }) {
  const [review, setReview] = useState(report.review || "");
  return <Modal title={`${report.memberName} · 本周周报`} subtitle={`更新于 ${report.updatedAt} · ${report.status}`} onClose={onClose} footer={<><button className="secondary" onClick={() => onSave({ ...report, status: "待修改", review: review || "请补充关键数据与复盘。" })}>退回修改</button><button className="primary" onClick={() => onSave({ ...report, status: "已点评", review: review || "本周推进扎实，下周继续关注数据转化。" })}>完成点评</button></>}>
    <div className="report-detail"><section><b>本周完成事项</b><p>{report.completed}</p></section><section><b>关键成果与数据</b><p>{report.result}</p></section><section><b>遇到的问题</b><p>{report.blockers}</p></section><section><b>下周计划</b><p>{report.next}</p></section></div><label>Leader 点评<textarea value={review} onChange={(event) => setReview(event.target.value)} placeholder="写下优秀点、改进建议和下周关注事项…" /></label>
  </Modal>;
}
