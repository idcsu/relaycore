export interface NavItem {
  path: string;
  label: string;
  short: string;
  subtitle: string;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    path: "/",
    label: "总览",
    short: "总",
    subtitle: "先看节点是否在线，再看规则是否生效和有没有风险。",
  },
  {
    path: "/nodes",
    label: "节点",
    short: "节",
    subtitle: "管理负责转发的服务器，查看负载、内存和防火墙模式。",
  },
  {
    path: "/rules",
    label: "转发规则",
    short: "规",
    subtitle: "把节点的公网端口转到你的目标服务器或内网服务。",
  },
  {
    path: "/diagnostics",
    label: "诊断中心",
    short: "诊",
    subtitle: "遇到慢、卡、不通时，按这里的结论逐项排查。",
  },
  {
    path: "/tokens",
    label: "节点接入",
    short: "接",
    subtitle: "生成一次性接入命令，把新节点加入面板。",
    adminOnly: true,
  },
  {
    path: "/users",
    label: "用户管理",
    short: "用",
    subtitle: "管理面板账号、角色和规则归属。",
    adminOnly: true,
  },
  {
    path: "/security",
    label: "账号安全",
    short: "安",
    subtitle: "开启两步验证，减少面板账号被撞库的风险。",
  },
  {
    path: "/events",
    label: "审计日志",
    short: "审",
    subtitle: "查看谁在什么时候做了关键操作。",
    adminOnly: true,
  },
];
