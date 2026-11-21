# Git 远程仓库分工策略

> 自 2026-11-21 起生效。NODELOG 为商业授权软件，源码分三库管理。
> 背景：商业版功能代码不得进入公开库；公开库只保留开源功能 BUG 修复与商业功能开发的文字说明。

## 三个远程

| 远程名 | 地址 | 角色 | 推送方式 |
|---|---|---|---|
| `origin` | `（私有库地址不对外公开）` | **私有主库**（腾讯工蜂） | 默认目标，`git push` 即推这里；商业功能全量代码 |
| `gitee` | `git@gitee.com:nodelog/nodelog.git` | 公开展示库 | 手动、选择性推送 |
| `github` | `git@github.com:nodelog/nodelog.git` | 公开展示库 | 手动、选择性推送 |

## 铁律

1. **默认只推私有库**：`git push` / `git push origin master` → 仅进腾讯工蜂。商业版功能开发全程在此。
2. **禁止整支推公开库**：不要用 `git push gitee master` / `git push github master`，那会把商业代码全量暴露。
3. **公开库只收两类内容**：
   - 公开开源功能的 BUG 修复代码；
   - 每次商业功能开发的**文字说明**（写了什么功能，不含商业源码、密钥、配置项）。

## 日常命令

```bash
# 商业功能开发（默认）
git add <files> && git commit -m "feat: xxx"
git push origin master          # 或直接 git push

# 分支同步到私有库
git push origin dev
```

## 公开库发布流程（独立 public 发布分支 + 一键脚本）

公开库以 `public` 分支作为唯一发布分支，与私有库 `master` 物理隔离，从源头杜绝误推商业代码。
该分支是 **orphan 分支（无父提交）**，代码树取自纯开源基线 `70de471`（Apache 2.0，
商业授权改造前），**不含任何商业源码**（脚本内置校验：相对基线只允许 `COMMERCIAL_CHANGELOG.md`
一个差异文件，混入其他文件立即中止）。

### 商业功能开发说明 —— 每次必做

每次新功能开发 / 优化升级后：

1. 在仓库根目录 `COMMERCIAL_CHANGELOG.md` 顶部追加一条说明（只写做了什么，不含源码/密钥/配置）。
2. 运行发布脚本：

```bash
bash scripts/publish-public.sh            # 发布到 gitee + github 的 public 分支
bash scripts/publish-public.sh --dry-run  # 先预览，不推送
```

脚本每次以「开源基线 + 最新 CHANGELOG」重建 `public` 提交并强推覆盖该分支，**幂等**；
全程不切分支、不动工作区、不碰 `master`。这是当前**唯一**的公开库自动同步通道——
没有 CI、没有 git hook，是否推送完全取决于是否手动运行此脚本。

### 开源功能 BUG 修复

BUG 修复若要同步到公开库，需并入 `public` 分支的代码树。当前脚本每次以固定基线重建 public，
手改会被覆盖；如需带 BUG 修复，应先更新脚本里的 `BASELINE` 指向包含该修复的纯开源提交，再运行脚本。

> 若团队更倾向让公开库继续用 `master`，则必须保证只 cherry-pick 符合条件的 commit，
> 绝不可整支 fast-forward。发布分支方案更安全，推荐采用。

## 历史现状

截至 2026-11-21，Gitee/GitHub 的 `master` 已包含此前推送的商业授权相关代码历史
（`f4bce5d` 改协议、`e9ad0be` 授权入口等）。本策略**自当前节点起生效**，不追溯改写公开库历史。
如需彻底清理公开库历史，属于不可逆的破坏性操作，须单独评估并确认后执行。

## 远程管理速查

```bash
git remote -v                              # 查看三库
git push origin master                     # 推私有库（日常）
git push gitee public && git push github public  # 推公开库（发布时）
git ls-remote origin                       # 核对私有库 refs
```
