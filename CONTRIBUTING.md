# 贡献指南

感谢改进 Agent Journal。项目保持零运行依赖、免构建和本地优先，请避免引入远程服务、CDN、远程脚本或仅为了构建而增加的依赖。

## 开发流程

1. Fork 并克隆仓库，创建语义清晰的分支。
2. Chrome / Edge 扩展页选择“加载已解压的扩展程序”，加载项目根目录。
3. 修改代码后在扩展页点击“重新加载”，并刷新目标 Agent 网页。
4. 运行 `node --test tests/core.test.js` 与 `npm run check`。
5. 按 `MANUAL_TESTING.md` 做真实浏览器验证，提交说明中列出验证过的网站与未验证的限制。
6. 提交 Pull Request，描述问题、修复方式和隐私影响。

## 网站选择器失效时

内容脚本位于 `content.js`。优先使用网站提供的稳定语义属性，例如：

- `textarea`、标准 `[contenteditable="true"]` 输入区域；
- `data-testid`、`aria-label` 等语义化发送按钮属性；
- 最后才考虑带层级关系的通用兜底选择器。

不要依赖易变的编译 CSS 类名，不要读取回答、聊天列表或整页 `innerText`。选择器应只覆盖提问输入与发送按钮，并且必须保持事件监听“只观察、不阻止”：禁止 `preventDefault()`、`stopPropagation()` 或改写用户输入。

新增站点时同步更新：

1. `manifest.json` 的 `host_permissions` 与 `content_scripts.matches`；
2. `lib/core.js` 的 `AGENTS` 和域名识别；
3. `content.js` 的站点选择器；
4. README 支持站点表格与相应测试。

权限必须保持最小化，不要图方便改成 `<all_urls>`。

## 代码约定

- 日期、摘要、导入校验等逻辑放在 `lib/core.js`，保持无 DOM / Chrome API 依赖，便于 Node 测试。
- Chrome 存储读写集中在 `lib/storage.js`；UI 不直接拼装存储键。
- 所有用户文本用 `textContent` 或等价安全 API 渲染，不允许拼入 `innerHTML`。
- 新数据字段应向后兼容旧备份；导入不可信任，必须校验长度、类型、时间与 URL。
- 日报使用本地自然日，周报固定周一至周日，不要依赖服务器时区。
- 不提交真实用户数据、账号 token、Cookie、会话 URL 参数或个人备份。

## 提交信息建议

使用 `feat:`、`fix:`、`docs:`、`test:`、`refactor:` 等前缀，例如：

```text
fix: update ChatGPT send button selector
```

如果修复只在一个网站验证过，请在 PR 中明确说明，避免声称已验证所有站点。
