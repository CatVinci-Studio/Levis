# iOS 上架步骤

构建和上传由 `.github/workflows/ios-release.yml` 完成：打 `ios-v*` 标签后，GitHub Actions 在 macOS 上构建签名的 iOS 应用，并上传到 App Store Connect（TestFlight）。提交审核仍在 App Store Connect 网页上手动操作。

## 一次性准备

### 1. 注册 App ID

[Apple Developer › Identifiers](https://developer.apple.com/account/resources/identifiers/list)：

- iOS 版和 macOS 版用同一个套装 ID `com.chengaoshen.levis`（`tauri.conf.json` 的 `identifier`）。App ID 不区分平台；macOS 版用 Developer ID 签名、不走 App Store，所以这里可能还没有注册过，没有就新注册一个。共用同一个 ID，将来 macOS 版上 Mac App Store 时，可以和 iOS 版合并成同一个商品（Universal Purchase）。
- Capabilities 不需要额外开启。以后要用 iCloud 容器时再加 iCloud。

### 2. 在 App Store Connect 新建 App

[App Store Connect › 我的 App](https://appstoreconnect.apple.com/apps) › ＋ › 新建 App：

- 平台：iOS
- 名称：Levis（如果已被占用，可以用"Levis - Markdown 编辑器"等）
- 主要语言：简体中文（或英文）
- 套装 ID：`com.chengaoshen.levis`
- SKU：例如 `levis-ios`
- 创建后在 App › 价格与销售范围里，取消"在 Apple 芯片 Mac 上提供"：Mac 上已经有原生的 macOS 版，不要让 iPad 版在 Mac App Store 里重复出现。

### 3. 创建 App Store Connect API 密钥

App Store Connect › 用户和访问 › 集成 › App Store Connect API：

- 第一次进来只有一个"请求访问"（Request Access）按钮，需要账户持有人点击并同意 API 条款，之后才能创建密钥。

然后在团队密钥 › ＋：

- 名称：例如 `Levis CI`；访问权限：**App 管理**
- 记下 **Issuer ID** 和 **密钥 ID**，下载 `AuthKey_<密钥ID>.p8`。这个文件只能下载一次，请妥善保存。

### 4. 欧盟交易商身份

App Store Connect › 商务（Business）里填写欧盟《数字服务法》要求的交易商身份（个人开发者也可以声明自己不是交易商）。不填的话，新 App 不能在欧盟上架，其他地区不受影响。

### 5. 填入仓库 Secrets

GitHub 仓库 › Settings › Secrets and variables › Actions，新增：

| 名称               | 内容                 |
| ------------------ | -------------------- |
| `APPLE_API_ISSUER` | Issuer ID            |
| `APPLE_API_KEY_ID` | 密钥 ID              |
| `APPLE_API_KEY_P8` | `.p8` 文件的全部文本 |

`APPLE_TEAM_ID` 已经存在（macOS 发布在用），不用再加。

## 每次发布

1. 在 Mac 上先自测：
   ```sh
   rustup target add aarch64-apple-ios aarch64-apple-ios-sim
   npx tauri ios init        # 第一次
   npx tauri ios dev         # 模拟器或真机
   ```
2. 打标签上传：
   ```sh
   git tag ios-v0.9.2 && git push origin ios-v0.9.2
   ```
   约 20 分钟后，构建出现在 App Store Connect › TestFlight（苹果处理还需要几分钟到半小时）。
3. 在 TestFlight 里装到自己的 iPhone 和 iPad 上试用。可以先加内部测试员，无需审核。
4. App Store Connect › 你的 App › iOS App › ＋版本，选择这个构建，填写下面的资料，提交审核。

## 审核需要的资料

- **截图**（必填）：
  - 6.9 寸 iPhone：1320 × 2868；
  - 13 寸 iPad：2064 × 2752（App 支持 iPad 才需要）。

  可以在模拟器（iPhone 17 Pro Max、iPad Pro 13 寸）里截取。

- **描述、关键词、副标题、宣传文本**：可以从 README 的"特点"改写。
- **支持网址**：`https://levis.catvinci.com`；**隐私政策网址**：需要一个页面，可以放在官网 `/privacy`。
- **App 隐私**问卷：Levis 不收集数据，选"不收集数据"。AI 请求是用户自己配置的服务商，直接从设备发出，不经过我们的服务器。
- **年龄分级**：4+。
- **出口合规**：只用 HTTPS 等标准加密，已在 `src-tauri/Info.ios.plist` 里声明 `ITSAppUsesNonExemptEncryption = false`（只用 HTTPS 等标准加密），上传后不会再问。
- **审核备注**：说明 AI 功能需要用户自己的 API Key，并提供一个测试用的 Key 或说明如何使用 Ollama 等方式；没有 Key 时编辑器本身可以完整使用。

## 常见被拒原因

- **4.2 功能过少／只是网页套壳**：要让审核员看到原生体验，比如"文件"应用集成、就地打开、键盘工具条、iPad 适配。
- **2.1 无法测试功能**：AI 功能必须给审核员可用的测试方式。
- **5.1.1 隐私**：问卷和实际行为必须一致，隐私政策网址必须能打开。
