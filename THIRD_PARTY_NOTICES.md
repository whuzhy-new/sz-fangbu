# 第三方组件、数据与素材说明

本文件说明代码许可之外的材料及其上游条款，核对日期为 2026-11-10。项目原创代码和原创文档文字采用 GNU Affero General Public License v3.0 only（`AGPL-3.0-only`），Copyright (C) 2026 sz-fangbu contributors。项目根目录的 `LICENSE` 仅授予项目贡献者有权许可的内容的权利；已有独立许可的文件、第三方数据、素材和标识不因收录在仓库中而改用该许可。

## 文件范围

| 范围 | 来源与许可边界 |
| --- | --- |
| 原创应用代码、测试、数据处理程序和文档文字 | 适用 `AGPL-3.0-only`，见根目录 `LICENSE`；处理程序的许可不等于其输入或输出数据的许可 |
| `scripts/vite/sites-vite-plugin.ts` | 保留 OpenAI 的 MIT 许可，见同目录 `sites-vite-plugin.LICENSE` |
| shadcn 相关组件及样式 | 保留上游 MIT 许可，见 `vendor/shadcn-tailwind-4.13.0.LICENSE.md` |
| npm 依赖 | 适用各依赖自身的许可；版本见 `package-lock.json`，许可原文见依赖发行包中的声明 |
| `public/data/road-network/` | 含 OSM 衍生路网及高德样本校准参数；OSM 部分适用 ODbL，其他来源权利需分别处理 |
| `public/data/metro-tracks.json` | 高德线路查询返回的深圳地铁轨迹 |
| `public/data/` 中的其他数据文件 | 含高德地点、车站、路线、时长、校准样本，以及结合 OSM 生成的范围；不作为统一适用代码许可的数据集发布 |
| `data/metro-index.json`、`data/office-profiles/`、`data/duration-policy-report.json` | 含第三方地点信息、固定方案或数据生成报告；须按实际内容遵守对应来源条款 |
| `data/snapshots/` | 历史数据的打包归档，沿用其内容对应的来源与许可边界 |
| `public/images/amap-scan-entry.png`、`public/images/system-scan-entry.png` | 用户提供的应用／系统界面截图，含第三方界面和标识，不包含在代码许可授权中 |
| `public/guide.html`、`docs/使用说明.html` 中内嵌的截图与录屏 | 文档文字与内嵌素材分别判断；第三方界面、地图和标识不随文档文字一并获得代码许可授权 |

若其他文件含第三方内容，同样适用其上游权利，不因未在表中逐项列出而获得额外授权。文件内的具体声明优先于概括性的目录说明。

## OpenStreetMap

数据署名：**© OpenStreetMap contributors**。

- [OpenStreetMap 版权与许可说明](https://www.openstreetmap.org/copyright)
- [Open Data Commons Open Database License 1.0（ODbL）原文](https://opendatacommons.org/licenses/odbl/1-0/)

OSM 数据及属于其衍生数据库的部分受 ODbL 约束。公开使用、分发或修改时，应按适用条款保留署名与许可说明，履行相同方式共享和提供衍生数据库或修改材料的义务。生成的地图等作品与衍生数据库的要求有所不同，不能仅因文件由本项目脚本输出就统一改为代码许可。

OSM 路网由 Geofabrik 提供的广东数据提取；来源为 [Geofabrik 广东下载页](https://download.geofabrik.de/asia/china/guangdong.html)。当前路网数据日期记录于 `public/data/road-network/manifest.json`。

当前部分路网权重和范围还使用高德样本、固定方案或校准结果。ODbL 不授予高德数据的使用权，也不能消除其他来源的独立限制。应分别核对可分离的 OSM 数据、混合数据库和生成作品；本文件不宣称已完成混合数据的全部兼容性与分发授权核查。

## 高德地图

高德底图、地点、车站、坐标、路线、时长、接口响应及相关截图，受高德及相应权利人的条款约束：

- [高德地图开放平台服务协议](https://lbs.amap.com/pages/terms)
- 各产品／API 的单独协议、账号授权及另行取得的书面许可（如有）。

本次核对的服务协议页面标注更新时间为 2025-12-03。其中第 3.5、4.12 和 7.2—7.3 条涉及数据存储、缓存、衍生使用、传播和再许可等限制；具体使用应以适用协议及有效授权为准。

**调用接口的权限，不等同于把响应、缓存、预计算数据或截图公开再分发的权限。** 本项目的代码许可不会授予这些第三方权利，使用自己的 Key 也不会自动取得额外分发授权。

仓库未附可用于确认上述数据公开再分发权限的高德专项授权文件。因此，不能仅凭仓库公开可见、来源署名或本声明，确认现有数据和素材可被自由复制、商用或再发布。发布和维护者需要核实授权；授权不足的材料应取得许可，或从公开发行范围中移除、以许可兼容的数据替换。本声明本身不能补足授权。

## 其他素材、名称与标识

截图可能包含 Apple、高德及其他厂商的界面、商标和版权内容；相关权利归对应权利人。项目仅对自己有权许可的部分授予许可，不授予第三方商标、品牌、肖像或界面素材的独立使用权。

字节跳动、高德、OpenStreetMap、Apple 等名称仅用于说明适用场景、来源或操作步骤，不表示官方关联、认可或背书。

## 已保留的上游许可

- [Sites Vite 插件 MIT 许可](scripts/vite/sites-vite-plugin.LICENSE)：Copyright (c) 2026 OpenAI。
- [shadcn MIT 许可](vendor/shadcn-tailwind-4.13.0.LICENSE.md)：Copyright (c) 2023 shadcn。
- [Lucide ISC 许可与 Feather MIT 许可](vendor/lucide-react-1.31.0.LICENSE)：用于界面、地图标记和说明页图标。

复制、修改或分发这些组件时，应保留对应版权与许可文本。其他依赖按其各自许可处理，本清单不替代依赖包中的完整声明。
