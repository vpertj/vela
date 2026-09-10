# Vela Bug 库
> 状态: open / fixed / wontfix。修复时在本文件更新状态并在提交信息引用编号。

## BUG-001 [P1][登录UX] 已登录状态下点"登录"弹出模态 alert，阻塞整窗
- 现象：登录成功后再点顶栏登录菜单，弹 "[JavaScript Application] 已登录：vpertj"；该弹窗为窗口模态，导致 GitHub 授权页所有按钮（含 Continue）无法点击。
- 根因：window.alert 在 Firefox chrome 里是窗口模态。
- 修复：登录链路 alert 全部清除（cbf585c），改原生系统通知；菜单动态显示登录态（已登录项变灰显示账号）。
- 状态：**fixed**

## BUG-002 [P2][登录UX] 登录成功后顶栏无任何状态反馈
- 现象：登录完成后按钮/菜单无变化，用户以为没成功而重复点登录，触发 BUG-001。
- 修复：菜单项动态化（已登录：账号名；同步/退出解锁）+ 登录成功系统通知（259b587/cbf585c）。
- 状态：**fixed**

## BUG-003 [P2][设置页] "外观焕新，设置依旧。"新手提示条常驻
- 现象：设置页顶部出现上游 redesign 提示条（有"知道了"可关），信息价值低。
- 处置建议：可直接移除（同 helpButton 做法）。
- 状态：open

## BUG-004 [P2][隐私窗口] 隐私页宣传区出现"移动端更强大的隐私保护/下载 Vela Focus"
- 现象：桌面浏览器的隐私起始页推广移动端产品 Vela Focus，场景不符。
- 处置建议：隐藏该 promo 区块或换成本厂文案。
- 状态：open

## NOT-A-BUG
- 启动 stderr 出现 g.alicdn.com 脚本 NS_ERROR_FAILURE：远程网页自身反爬脚本报错，非产品缺陷。
