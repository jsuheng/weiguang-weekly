import { hash } from "@node-rs/argon2";
import postgres from "postgres";

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const username = String(argument("username", "leader")).trim().toLowerCase();
const displayName = String(argument("display-name", "Leader")).trim();
const groupName = String(argument("group-name", "内容增长组")).trim();
const password = process.argv.includes("--password-stdin") ? await readStdin() : process.env.BOOTSTRAP_PASSWORD;

if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) throw new Error("用户名格式不正确");
if (!displayName || !groupName) throw new Error("姓名和小组名称不能为空");
if (!password || password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
  throw new Error("临时密码至少10位，并同时包含字母和数字；请通过 --password-stdin 输入");
}

const pepper = process.env.PASSWORD_PEPPER || "development-only-pepper";
const passwordHash = await hash(`${password}\u0000${pepper}`, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const sql = postgres(databaseUrl, { max: 1, prepare: false });
const defaultState = {
  version: 1,
  platforms: [
    { id: "platform_xiaohongshu", name: "小红书", aliases: ["XHS", "RedNote"], domains: ["xiaohongshu.com", "xhslink.com"], metricType: "曝光量", color: "#df6752", active: true, system: true },
    { id: "platform_douyin", name: "抖音", aliases: ["Douyin"], domains: ["douyin.com"], metricType: "播放量", color: "#22262e", active: true, system: true },
    { id: "platform_kuaishou", name: "快手", aliases: ["Kuaishou"], domains: ["kuaishou.com"], metricType: "播放量", color: "#ef7c2c", active: true, system: true },
    { id: "platform_weixin_channels", name: "视频号", aliases: ["微信视频号", "WeChat Channels"], domains: ["channels.weixin.qq.com", "weixin.qq.com"], metricType: "播放量", color: "#2a9d62", active: true, system: true },
  ],
  contentRows: [],
  members: [],
  tasks: [],
  reports: [],
  imports: [],
  notifications: [],
};

try {
  await sql.begin(async (transaction) => {
    const [existing] = await transaction`SELECT id FROM users WHERE username = ${username}`;
    if (existing) {
      await transaction`
        UPDATE users SET password_hash = ${passwordHash}, must_change_password = true,
          failed_login_attempts = 0, locked_until = NULL, status = 'active', updated_at = CURRENT_TIMESTAMP
        WHERE id = ${existing.id}
      `;
      await transaction`DELETE FROM sessions WHERE user_id = ${existing.id}`;
      await transaction`INSERT INTO audit_events (actor, action, target) VALUES ('ops', '重置Leader密码', ${username})`;
      console.log(`Leader ${username} password reset; first-login password change is required.`);
      return;
    }

    const userId = `usr_${crypto.randomUUID()}`;
    const groupId = `grp_${crypto.randomUUID()}`;
    const membershipId = `gm_${crypto.randomUUID()}`;
    const joinedAt = new Date().toISOString().slice(0, 10);
    defaultState.members.push({
      id: membershipId,
      name: displayName,
      username,
      role: "leader",
      status: "active",
      initials: displayName.slice(0, 1),
      color: "#173f3a",
      joinedAt,
    });
    await transaction`
      INSERT INTO users (id, username, display_name, password_hash, must_change_password)
      VALUES (${userId}, ${username}, ${displayName}, ${passwordHash}, true)
    `;
    await transaction`
      INSERT INTO groups (id, name, owner_user_id, invite_code, searchable)
      VALUES (${groupId}, ${groupName}, ${userId}, 'INTERNAL', false)
    `;
    await transaction`
      INSERT INTO group_memberships (id, group_id, user_id, role, status, joined_at)
      VALUES (${membershipId}, ${groupId}, ${userId}, 'leader', 'active', ${joinedAt})
    `;
    await transaction`
      INSERT INTO group_workspace_states (group_id, version, payload)
      VALUES (${groupId}, 1, ${JSON.stringify(defaultState)})
    `;
    await transaction`INSERT INTO audit_events (actor, action, target) VALUES ('ops', '初始化Leader', ${username})`;
    console.log(`Leader ${username} and group ${groupName} created; first-login password change is required.`);
  });
} finally {
  await sql.end();
}
