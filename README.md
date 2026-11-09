# 深圳房补地图

字节跳动深圳三个工区的预计算通勤范围，以及小区、地址和地图选点的高德路线核验。

## 使用说明

[HTML 使用说明](docs/使用说明.html)包含操作录屏与截图。下载后直接打开，无需另带素材文件夹。

## 运行

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_heavy_omega_sentinel.sql
npm run dev
```

本地访问 http://localhost:5173 。数据库迁移只需对新建的本地数据库执行一次。

在被 Git 忽略的 `.dev.vars` 中配置：

```dotenv
AMAP_WEB_KEY="Web服务 Key"
AMAP_JS_KEY="Web端 Key"
AMAP_JS_SECURITY_CODE="Web端安全密钥"
AMAP_APP_MONTHLY_LIMIT="100000"
AMAP_SEARCH_MONTHLY_LIMIT="3000"
```

JSAPI 使用 `/_AMapService` 服务端安全代理；源码目录 `%5FAMapService` 是框架对下划线路由的转义。安全密钥和 Web 服务 Key 不发送到前端。生产配置保存在 Sites 的秘密环境变量中。

## 计算规则

- 先核验全程步行 ≤30 分钟、普通自行车 ≤20 分钟，任一满足即结束，不查询完整或分段地铁方案。各工区独立判断。
- 步行与自行车都未找到符合时限的方案，再查询高德点位→工区完整地铁方案，使用 API 总时长（含步行、换乘与接口候车估算）取整到分钟。≤20 分钟即结束；超时、没有可用方案或查询失败才尝试分段。只接受步行＋地铁，排除公交、打车、火车等。
- 分段地铁组合 ≤20 分钟：小区入口到进站口的步行／骑行＋高德地铁路段耗时＋换乘步行＋出站口到工区的步行／骑行。
- 分段时不另加首次进站、最终出站的站内步行，也不另加候车。高德地铁路段字段不是独立列车时刻表。
- 地面接驳使用地铁口坐标；地铁段的名称和复核链接使用车站坐标。换乘作为独立一段展示。
- 按分钟四舍五入，取整后为0分的按1分计算；直达方案按总时长取整，分段方案每段先取整、各段最少1分再相加。展示、是否符合时限以及候选筛选使用同一口径，API原始秒数保留在 `rawDuration` 中。16 个工作日的租住要求需另行满足。

分段采用用户指定的口径；完整方案保留高德总时长，不做扣减。申请时应以公司要求的地图页面时长和截图复核，应用不代替公司审批。

## 数据与误差

工区、地铁线网、出口和固定路线使用高德数据；范围图在本地结合 OSM 路网按 50 米网格预计算，输出 GCJ02 坐标。直接骑行使用 120 个独立空间样本校准。1万平方米以内的内部小洞在生成阶段直接作显示补全，包括多种方式叠加形成的小洞；外边界保留。此补全不改变地址核验的时限和路线。较大的住宅空白按高德小区门口坐标核验，通过的住宅边界记录在 `public/data/coverage-corrections.json`，只补现有范围内部；每条记录含起终点、分段秒数和数据来源。范围是选房初筛估算，具体地址使用高德接口核验，无法保证穷举所有地图软件或任意换乘方案。

模型验证结果见 `public/data/validation.json`。步行、自行车和完整地铁方案均不满足时，才加载本地路网。分段查询从实际坐标在本地有向路网上做两次单源最短路搜索（步行、骑行），再读取所有预备站口、加上高德固定地铁与公司侧接驳，比较全部组合。每次查询不再依赖网格点或逐站调用高德。页面显示全量本地比较数量及估算最短时长，估算不会产生“符合房补条件”的已确认结论。

高德最多核验3个接驳，每站最多2个。500米内最近入口优先步行核验；同站附近有相反方向入口时，也优先核验其步行，避免骑行绕路或道路两侧差异漏掉近站。剩余额度按本地总时长排序，符合即结束。结果逐项返回，单次高德请求独立限时8秒，完整查询最多等待25秒；超时取消未完成的网络请求与排队，保留已经返回的实测方案。外部服务、主机负载和数据库仍可能影响总响应时间，不能保证所有方案在5秒内完成。未确认时不提供连续翻批按钮，也不推断为不符合。查询中断、额度及网络错误分别保留。

路网资产为 `public/data/road-network/`，从已有OSM图离线导出，保留步行／骑行通行条件、骑行方向和校准系数，运行时不需要Python服务。更改路网或校准后运行 `.venv/bin/python scripts/data/export_road_network.py` 重建资产；无高德调用。固定地铁方案更新后直接读取新方案，无需生成地址网格。

路线缓存 7 天，搜索缓存 30 天；D1 使用原子额度计数和请求间隔。达到应用预算时停止新增查询，静态范围仍可浏览。离线准备脚本也有独立调用账本；这些限制不代表整个高德账号剩余额度。

## 重新生成范围

准备 Python 环境，安装 `scripts/data/requirements.txt`；将广东 OSM PBF 放入 `work/guangdong.osm.pbf`。下载来源：https://download.geofabrik.de/asia/china/guangdong.html 。数据工作目录、原始响应、密钥和虚拟环境不进入 Git。

```sh
.venv/bin/python scripts/data/build_network.py
.venv/bin/python scripts/data/calibrate_bicycling.py
python3 scripts/data/prepare_rail_plans.py
python3 scripts/data/prepare_station_api.py
.venv/bin/python scripts/data/expand_rail_candidates.py
.venv/bin/python scripts/data/validate_network.py
.venv/bin/python scripts/data/generate_coverage.py
```

站间地铁仅使用明确 originpoi/destinationpoi 的高德 API，返回首末站与请求不一致时拒绝采用。完整通勤方案只用于发现候选，不能省略通往实际上车站的路程。另将缓存中的地铁路段与已知换乘组成图，检查可拼接出的更快候选；图中耗时只用于筛选，必须再由明确首末站的 API 结果确认，才可更新范围。`expand_rail_candidates.py --cache-only` 仅生成本地审计，不新增调用、不替换公开数据。

地铁脚本按当前快照日期 2026-11-09 09:00 查询，支持中断续算；更新日期或计算规则时需调整版本并重新生成参考数据。生成器拒绝把未完成的地铁准备结果发布成完整覆盖图。高德请求缓存和本月离线调用账本位于 `work/`。

## 检查

```sh
npx tsc --noEmit
node --experimental-strip-types --experimental-vm-modules --test tests/*.test.ts tests/*.test.mjs
.venv/bin/python -m unittest discover -s scripts/data -p 'test_*.py'
npm run build
```

OSM 数据：© OpenStreetMap contributors，ODbL。高德数据和链接按其服务要求使用。
