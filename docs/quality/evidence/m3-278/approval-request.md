# M3-278 长线替换候选逐项审批

> Owner-only review material. Do not send this file to blind reviewers.
>
> Status: awaiting human approval

Issue: #278

- Candidate dataset: `0bf8a06d3ecf8d9c574a0d43aef9a5dea95555857873b4212add73436acdc6bd`
- Candidate reviewer packet: `bc7adc54e7ae328754d270a08ffa24a332b6a7e2d6305b9e2ce7e6141176ddde`
- Replacement manifest: `c064eb6c5b2c0f7a69204a9f2d5ea8fda4c19160348ce10fd21371a1c492243f`
- Required approvals: 24/24
- Old scores: `invalidated_for_clean_review`
- Variance threshold: #240 已批准为 `0.1`，本票不得改写
- Downstream: #279 全量重评、#242 最终发布门禁

候选文件不是已冻结 packet。只有 24 个样本全部由真实产品/质量负责人逐项批准，并在 #278
发布包含 `M3-278-HUMAN-APPROVAL`、candidate packet hash 和 replacement manifest hash
以及填完 24 项后的 approval payload hash 的外部 GitHub attestation 后，才允许冻结。
发布检查会通过 GitHub API 核对评论作者关联、Issue 278、评论时间与完整正文；每个
`adjudicatorId` 必须等于评论作者，每个 `attestationId` 必须使用该样本的固定审批 token。

## 待负责人裁决

- Q026: 是否将“自小怕黑”补入必需节拍，确保长期恐惧也属于评审契约？
- Q075: 跨册同步异常是否保留，或改为仅保留两册分歧并更新节拍？
- Q088: 是否删除“时间戳也落在同一天”这一过度定证句？
- Q093: 既定事实是忘川书，是否将正文改为忘川书所有权冲突？
- Q096: 是否将“第三年秋提剑回城”补为必需节拍？
- Q130: 既定事实是忘川书，是否将正文改为忘川书使用权冲突？
- Q149: 既定事实是灵魂转移，是否将分身共享记忆改为同一机制？
- Q160: 既定事实是照骨镜真名，是否将归墟令伏笔改为照骨镜伏笔？
- Q182: 是否保留预知式知识越界，或恢复平行版本来源并避免 oracle 提示？
- Q186: 该样本应考事实转移，还是旁人的错误身份主张？
- Q189: 既定事实是左臂骨折，是否改为骨折未愈却恢复能力的冲突？

填写完 24 项后先将 `status` 改为 `complete`，再运行
`pnpm quality:clean-packet -- --payload-hash`，把输出的 approval payload hash 写入
comment 与 `humanAttestation.approvalPayloadSha256`。修改任何审批字段后必须重新生成
payload hash 和 comment；只修改 `humanAttestation` 不会改变 payload。

### Q005

- Dataset sample: `long-horizon:34c6a1a1-1813-7d64-81c3-f6601d00bf3a`
- 场景 family: `inventory_rights`
- 严重度: `P1`
- 既定事实: `所有权：忘川书由沈砚保管`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `3b3bed883f3d69e92dc09d7e30092f4fac7ce89de21cec54b31f7465cfdcc7d5`
- 替代文本 SHA-256: `cb64012e62f7a1c42119a80c30f42ad224a2bc30ade48285df4a624160113672`
- 必需节拍 SHA-256: `059a4e40ecbb2341ee10165ef766562d963bacf10f5b7c7bb0140209e34c0627`

候选叙事：

> 忘川书仍锁在沈砚的玄铁匣里，匣上的封纹只有他能解。顾青走进偏殿时没有向任何人借取，也没有出示沈砚的手令，只抬手一招，书页便越过禁制翻到面前。他看完一页，又把书送回匣中，动作熟得像那本书从来也听他调遣。

必须保留的 beats：

- 忘川书仍锁在沈砚的玄铁匣里，匣上的封纹只有他能解。
- 顾青走进偏殿时没有向任何人借取，也没有出示沈砚的手令，只抬手一招，书页便越过禁制翻到面前。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q005`
- [ ] `decidedAt`: ISO 时间戳

### Q026

- Dataset sample: `long-horizon:8e6c52dc-e798-7219-8e33-5a49ce4034f8`
- 场景 family: `motivation_drift`
- 严重度: `P2`
- 既定事实: `目标：必须保护旧城证人`
- 题材 / 难度: `仙侠` / `easy`
- Manifest entry SHA-256: `b661e942cb9f18d158c935a6d03ae28d076e0e76a235cf99f4f7c6e275ec11b7`
- 替代文本 SHA-256: `aa3004f47b9061091d75c72807d1e13ee5182491ed353d3ad6e44934c0c09fac`
- 必需节拍 SHA-256: `58d25fb3a0f8153e7533a1dcd113d66dff01c5ff19fc3d5f5b33f13b6902f88e`

候选叙事：

> 旧城火起后，顾青把证人藏在药铺地窖，连夜画好三条撤离路线。他自小怕黑，仍握着刀守在门外，说天亮前谁也不能进去。天刚亮，他却推开地窖门，让人把证人绑去城门换粮。先前那份恐惧和守到最后的决定，像从未存在过。

必须保留的 beats：

- 旧城火起后，顾青把证人藏在药铺地窖，连夜画好三条撤离路线。
- 天刚亮，他却推开地窖门，让人把证人绑去城门换粮。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q026`
- [ ] `decidedAt`: ISO 时间戳

### Q034

- Dataset sample: `long-horizon:63cac527-f915-7115-898a-1ceba6387075`
- 场景 family: `travel_time`
- 严重度: `P1`
- 既定事实: `时间：北境关比旧城晚三十日`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `c645adb69a675825f1f30070241b36fe74534cac4426f35f0dcfbcc0e7552476`
- 替代文本 SHA-256: `e4de886c923ec0e0c7750422d01569cd8c8444d78b26fed084ac4afe8eaf10b8`
- 必需节拍 SHA-256: `3cab5e5bae518019037576042c091090813e26eb3b101904f93ab0ebe1f8a5d1`

候选叙事：

> 旧城的烽火刚熄，封蜡密信还压在驿丞案上，送信人尚未过河。北境关的茶棚里，披斗篷的人却已经念出信中那桩秘事，连末尾的暗记都没有错。按驿路日程，北境关比旧城晚三十日，此刻连第一匹马都还没到。

必须保留的 beats：

- 旧城的烽火刚熄，封蜡密信还压在驿丞案上，送信人尚未过河。
- 北境关的茶棚里，披斗篷的人却已经念出信中那桩秘事，连末尾的暗记都没有错。
- 按驿路日程，北境关比旧城晚三十日，此刻连第一匹马都还没到。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q034`
- [ ] `decidedAt`: ISO 时间戳

### Q055

- Dataset sample: `long-horizon:aa978572-2345-7347-86d4-115ffe7402c4`
- 场景 family: `knowledge_boundary`
- 严重度: `P0`
- 既定事实: `身世：真实身世被宗门封存`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `6883893aa0f71bbf7267e7acf10e8fc250fbbac5f01ae69d780b69578129138b`
- 替代文本 SHA-256: `f89ef0d437e51e49cb81d068ade9f5ec2b1b6d8cc177d1d168501e76b6ac8e4c`
- 必需节拍 SHA-256: `01f0c0b06bffc3951ca8539ccc2fe8d2ded9d3a7acdb6fe1e997b5c4b39c58fe`

候选叙事：

> 祠堂的旧匣刚被贴上第二道封条，顾青还站在门外，不知道匣里写着什么。沈砚从未打开过那只匣，也没人告诉过他匣中记着什么。沈砚越过他走到供桌前，当众说出那桩被宗门封存的身世，连换走婴儿的雨夜和守门人的名字都没有漏。顾青怔在原地，直到这时才第一次听见这个说法。

必须保留的 beats：

- 祠堂的旧匣刚被贴上第二道封条，顾青还站在门外，不知道匣里写着什么。
- 沈砚从未打开过那只匣，也没人告诉过他匣中记着什么。
- 沈砚越过他走到供桌前，当众说出那桩被宗门封存的身世，连换走婴儿的雨夜和守门人的名字都没有漏。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q055`
- [ ] `decidedAt`: ISO 时间戳

### Q056

- Dataset sample: `long-horizon:9e48e7d7-a00c-7238-85f4-ab03bce90dd5`
- 场景 family: `motivation_drift`
- 严重度: `P2`
- 既定事实: `目标：必须保护旧城证人`
- 题材 / 难度: `仙侠` / `easy`
- Manifest entry SHA-256: `e6b163013871f569d11aaeff9ce7bc70899cb91d0f89bbddd907228f1c4e5e4e`
- 替代文本 SHA-256: `0c7be5d559c8e16bfd6e07a8ad797db14a0bd211c702ec19295b141376b6fdff`
- 必需节拍 SHA-256: `071a683f4aa62f1b1b01f630d8adfd16a99ccde6e085bfab8997c714d46b7323`

候选叙事：

> 顾青把旧城证人的名单缝进衣襟，在祠堂前立誓：只要自己还有一口气，就不会让名单落到敌军手里。午后，他在同一座祠堂里把名单摊给敌军使者，换了一袋干粮。没人拿出新的证据，也没有谁逼他改口。

必须保留的 beats：

- 顾青把旧城证人的名单缝进衣襟，在祠堂前立誓：只要自己还有一口气，就不会让名单落到敌军手里。
- 午后，他在同一座祠堂里把名单摊给敌军使者，换了一袋干粮。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q056`
- [ ] `decidedAt`: ISO 时间戳

### Q067

- Dataset sample: `long-horizon:a00db5ab-9d1c-78e6-951c-5bba5e108254`
- 场景 family: `body_continuity`
- 严重度: `P0`
- 既定事实: `身体：左臂骨折尚未痊愈`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `6502cc707475e0b7c1ea3ad81cda552dff35173713cea32fad7665ee15c5a6bc`
- 替代文本 SHA-256: `820bb1200c20993409ad46610879d08792931e1dd0fb9c2d66192725cd625193`
- 必需节拍 SHA-256: `183dca3dd2d724d04cf3212a5b123ec2797da133d196357c55ef74f3aa104561`

候选叙事：

> 沈砚左臂的夹板还没拆，袖口露出未愈的肿胀。剑阵催动时，他忽然以左手握住剑柄，五指扣得很紧。城头没人替他换药，也没有药光或替身出现。

必须保留的 beats：

- 沈砚左臂的夹板还没拆，袖口露出未愈的肿胀。
- 剑阵催动时，他忽然以左手握住剑柄，五指扣得很紧。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q067`
- [ ] `decidedAt`: ISO 时间戳

### Q075

- Dataset sample: `long-horizon:8e7bd8d2-4a4d-75c8-b958-79dfb460ea37`
- 场景 family: `branch_divergence`
- 严重度: `P0`
- 既定事实: `分支正史：仅 early-divergence 分支存在的连续性事实`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `d05662f8112f1b1fe222dca9057708f03798f711f945d703751f44d1e930c7f9`
- 替代文本 SHA-256: `76e1da9a7282f6b129132dcd84cf552505151b43fcf97c6c6091478e13e55d22`
- 必需节拍 SHA-256: `ed3ad37f04483c89a91a0f013a7aa9411c04bb5d340680692cf26160e92e80f5`

候选叙事：

> 沈砚在旧城翻开两册同源年表。第一册写到北道断桥便停笔，第二册却继续写着白塔祭坛三层台阶、石兽位置和第七盏灯。他把第二册的句子抄进第一册，第一册原先空白的那页立刻显出同样的字迹。

必须保留的 beats：

- 沈砚在旧城翻开两册同源年表。
- 第一册写到北道断桥便停笔，第二册却继续写着白塔祭坛三层台阶、石兽位置和第七盏灯。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q075`
- [ ] `decidedAt`: ISO 时间戳

### Q081

- Dataset sample: `long-horizon:baf9375a-66d8-7645-9fd5-566e7aee765a`
- 场景 family: `foreshadow_payoff`
- 严重度: `P1`
- 既定事实: `预言：照骨镜会指向真名`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `66eb3dbc1d7df761798772b09c265c8463f4c5fc9e58777b31706ca0030b6feb`
- 替代文本 SHA-256: `f07af0ff3f4b978531db2dfe6a9f925e485efcba2359a77af8d3bb4fae6af3cc`
- 必需节拍 SHA-256: `6f3c6ec219f1390c8e086770c45f6de2067d01f6662aff09dc8d59f0f0e8f974`

候选叙事：

> 照骨镜仍封在祠堂暗格，旧卷写明冬至祭才会指向真名。茶楼里，说书人却已经把镜中将显现的名字和生母姓名完整说出，连镜背缺字的顺序都没有错。顾青赶回祠堂时，铜镜还蒙着三层符纸。

必须保留的 beats：

- 照骨镜仍封在祠堂暗格，旧卷写明冬至祭才会指向真名。
- 茶楼里，说书人却已经把镜中将显现的名字和生母姓名完整说出，连镜背缺字的顺序都没有错。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q081`
- [ ] `decidedAt`: ISO 时间戳

### Q083

- Dataset sample: `long-horizon:8a5af746-0f64-7482-b101-833244833444`
- 场景 family: `identity_transition`
- 严重度: `P0`
- 既定事实: `身份：灵魂转移至新身体`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `dc87848e2f9d65756d38f3581293e261e8aeaddc9f44f5c4ea8d9b532c58cd8b`
- 替代文本 SHA-256: `ed84d5ae161f6ace6bd50da0fc74b84f35bac275c8fc98df71df739c67963cd7`
- 必需节拍 SHA-256: `0d24bb225786000f9163fa5c0c60a65dac1e24190067ba212ac57885e9f6c0c4`

候选叙事：

> 新身体里的裴照睁开眼时，连原主三岁落水的记忆都一清二楚，甚至能背出那间书房暗格的顺序。夺舍的祭坛没有启动，转世簿也没有翻页。他揉了揉陌生的手指，像使用旧身体一样熟练地掐出剑诀。

必须保留的 beats：

- 新身体里的裴照睁开眼时，连原主三岁落水的记忆都一清二楚，甚至能背出那间书房暗格的顺序。
- 夺舍的祭坛没有启动，转世簿也没有翻页。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q083`
- [ ] `decidedAt`: ISO 时间戳

### Q084

- Dataset sample: `long-horizon:b167737e-b483-752c-bcef-0a892a8e5ed8`
- 场景 family: `travel_time`
- 严重度: `P1`
- 既定事实: `时间：北境关比旧城晚三十日`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `6f95c8a8add7d366b2154d68589603676094c9209bda53234d0ac80c1f531177`
- 替代文本 SHA-256: `10a1179bc77d66f60172bda1e3b65c31803b4566657fd6fda4f084017e30f4e3`
- 必需节拍 SHA-256: `e40ad05429b0639272cd7023f8932bedecaf5f75d58ede4e5a784f80f7bc21e3`

候选叙事：

> 北境关的驿路比旧城晚三十日才放行，关牒上写得明白。顾青午后从旧城出发，天还没黑便带着证人从北境关折返，鞋底没有多少泥。守关兵卒说，今天还没有一匹马过关。

必须保留的 beats：

- 北境关的驿路比旧城晚三十日才放行，关牒上写得明白。
- 顾青午后从旧城出发，天还没黑便带着证人从北境关折返，鞋底没有多少泥。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q084`
- [ ] `decidedAt`: ISO 时间戳

### Q088

- Dataset sample: `long-horizon:c127c949-e5d0-7feb-aa67-ebdaefc60e18`
- 场景 family: `travel_time`
- 严重度: `P1`
- 既定事实: `时间：北境关比旧城晚三十日`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `c6a7dd8892784cf703d32acd4d15bfb78bc9ac145ddb2b61841e023b6a3ac28b`
- 替代文本 SHA-256: `987d023891348e520fdf487d2e12146083edebc133968e036406275a5843de2b`
- 必需节拍 SHA-256: `fd4509c0cb1d36479f038599d306a68fc9e06d527bd175d2d90ac2869a407cff`

候选叙事：

> 北境关的报时鼓比旧城晚三十日，旧城刚落第一场雪，关外应该还没有入冬。沈砚却在同一日先出现在旧城钟楼，又在北境关的烽台上收剑。两地的守军都看见了他，时间戳也落在同一天。

必须保留的 beats：

- 北境关的报时鼓比旧城晚三十日，旧城刚落第一场雪，关外应该还没有入冬。
- 沈砚却在同一日先出现在旧城钟楼，又在北境关的烽台上收剑。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q088`
- [ ] `decidedAt`: ISO 时间戳

### Q093

- Dataset sample: `long-horizon:192f700e-1069-7e2e-a9d7-20c47706eaf5`
- 场景 family: `inventory_rights`
- 严重度: `P1`
- 既定事实: `所有权：忘川书由沈砚保管`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `86c1e5c72de6a7b35182749ffbb7044c6f10e5688ec9cf08629b6f4b7a16bf45`
- 替代文本 SHA-256: `53b9ac5c98c869288658c16e7ea0d2aba8fe90f8de2b4143177a73a00e90c3c9`
- 必需节拍 SHA-256: `b77abf2e580df0cf1cf500b1a86df68126638db91c5e51f986ed4438f108e1fc`

候选叙事：

> 照骨镜已经由宗门封存在锁山堂，钥匙挂在三位长老共同看守的铜匣里。闻雪没有递上掌门手令，也没有经过锁山堂，只从自己偏院的木箱中取出同一面铜镜，拂去镜背的封泥。她说这面镜子一直由她保管。

必须保留的 beats：

- 照骨镜已经由宗门封存在锁山堂，钥匙挂在三位长老共同看守的铜匣里。
- 闻雪没有递上掌门手令，也没有经过锁山堂，只从自己偏院的木箱中取出同一面铜镜，拂去镜背的封泥。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q093`
- [ ] `decidedAt`: ISO 时间戳

### Q096

- Dataset sample: `long-horizon:390a62d1-0700-7228-b314-98922fa1f519`
- 场景 family: `branch_divergence`
- 严重度: `P0`
- 既定事实: `分支正史：仅 middle-divergence 分支存在的连续性事实`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `0e99ab037026b2937105c2c55e48b795c6c98561200cc43cf39f6353c6904974`
- 替代文本 SHA-256: `90828719e92ccf668252a30f613086cc2f477880e0b2b5ad327c095c2e87d43a`
- 必需节拍 SHA-256: `89be7fea3a47e734278724b23a318fbb4397bd756ae312f557c49b93be1789cc`

候选叙事：

> 雪谷战后，顾青把裴照的尸身封进冰棺，村志只写到葬礼。后来另一册村志补记：裴照在第三年秋提剑回城，肩上的旧伤还是雪谷留下的那道。顾青把两册并排摊开，发现共同的葬礼记录之后，一册写坟茔长草，另一册却写活人归门。

必须保留的 beats：

- 雪谷战后，顾青把裴照的尸身封进冰棺，村志只写到葬礼。
- 顾青把两册并排摊开，发现共同的葬礼记录之后，一册写坟茔长草，另一册却写活人归门。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q096`
- [ ] `decidedAt`: ISO 时间戳

### Q123

- Dataset sample: `long-horizon:0d24c9fd-681f-70f5-b9c2-bbb3587a0a0b`
- 场景 family: `branch_divergence`
- 严重度: `P0`
- 既定事实: `分支正史：仅 late-divergence 分支存在的连续性事实`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `801db91663376d3ec16d2dfbee42ef2af6ef4c9ee41e1ff831152d7db26723b9`
- 替代文本 SHA-256: `e36a37b7d6a88a69f36fa045016f3d8e168a8119d0f960ad05e4cd01c21929d2`
- 必需节拍 SHA-256: `bb1036ee23111c221c8e3f14fa65d4026a4f13bdcb2818da5f8a36a9805fd64c`

候选叙事：

> 旧城史官抄录共同祖先的年表时，第二卷第一行本就写着：裴照夺舍归来。可那一卷只写到少主人接掌旧宅，祭坛尚未开启，陌生面孔也没有出现。史官把三份同源抄本并排摊开，发现两册止于旧宅，第三册却从同一页直接接上夺舍归来的记录。

必须保留的 beats：

- 旧城史官抄录共同祖先的年表时，第二卷第一行本就写着：裴照夺舍归来。
- 史官把三份同源抄本并排摊开，发现两册止于旧宅，第三册却从同一页直接接上夺舍归来的记录。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q123`
- [ ] `decidedAt`: ISO 时间戳

### Q130

- Dataset sample: `long-horizon:a1818166-ed50-75dd-adf9-b60792d3c06a`
- 场景 family: `inventory_rights`
- 严重度: `P1`
- 既定事实: `所有权：忘川书由沈砚保管`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `d6a548a2601deb5fb2959afc0062b93149030c82910369d4591d58585a21294e`
- 替代文本 SHA-256: `9dd58492034bb95445676eaa139dbcae91979ad68354eb04f2e4f9fe397d6418`
- 必需节拍 SHA-256: `cbbbc236ac0c6123e277d55ad645ecaeacde30cb01b843d6154a210e3b304daa`

候选叙事：

> 归墟令的转移记录停在沈砚名下，宗门的执令簿上还留着未销的旧印。顾青没有递交借令文书，也没有取得沈砚的口令，却在祭台上举起归墟令，向众人宣告这是自己的信物。守令弟子翻遍记录，找不到任何转移事件。

必须保留的 beats：

- 归墟令的转移记录停在沈砚名下，宗门的执令簿上还留着未销的旧印。
- 顾青没有递交借令文书，也没有取得沈砚的口令，却在祭台上举起归墟令，向众人宣告这是自己的信物。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q130`
- [ ] `decidedAt`: ISO 时间戳

### Q149

- Dataset sample: `long-horizon:3b758333-3e08-7896-9f8d-ae2ff25e4f79`
- 场景 family: `identity_transition`
- 严重度: `P0`
- 既定事实: `身份：灵魂转移至新身体`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `78807dc42d7d6981dcd51fc6b1aeff9028025faadfdab477c7abd41e87b585fe`
- 替代文本 SHA-256: `fabf15b570e2234a9045c355001699cab8ab85a37e54cfc7c46200b9ae3d1748`
- 必需节拍 SHA-256: `4d3d9f01e5b542b7d56cc83ab63fc5dcee4747804a732953db57bfd021a5848e`

候选叙事：

> 裴照的分身离开主峰时，带走了自己的剑和干粮，也带走了一条限制：不能共享本体记忆。三日后，分身却准确叫出本体昨夜才取的化名，还知道只有主峰密室里才写下的布防图。它笑着说，这些事刚从另一具身体里传来。

必须保留的 beats：

- 裴照的分身离开主峰时，带走了自己的剑和干粮，也带走了一条限制：不能共享本体记忆。
- 三日后，分身却准确叫出本体昨夜才取的化名，还知道只有主峰密室里才写下的布防图。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q149`
- [ ] `decidedAt`: ISO 时间戳

### Q158

- Dataset sample: `long-horizon:3cc35faf-667e-79d9-ba72-10a67e763de4`
- 场景 family: `knowledge_boundary`
- 严重度: `P0`
- 既定事实: `身世：真实身世被宗门封存`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `a1af0e3c3c7d2f0fde0cc0b2b255a5949d8945080af1f9caf52c0527200aee41`
- 替代文本 SHA-256: `52d3268716b0b9b11216b73e4c7991a84798ad8b68582d4599b9a6c990785d22`
- 必需节拍 SHA-256: `d9ad70d166b41f7acd6620a400b85436065a06a961e14f7ed2805e760283d25a`

候选叙事：

> 闻雪从未见过封存身世的名册，也没有参加祠堂问询。她在廊下拦住沈砚，直接说出他真正的姓氏、被换走的年月和那名守门人的名字。沈砚按住袖口，确认这些细节连顾青都不知道。

必须保留的 beats：

- 闻雪从未见过封存身世的名册，也没有参加祠堂问询。
- 她在廊下拦住沈砚，直接说出他真正的姓氏、被换走的年月和那名守门人的名字。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q158`
- [ ] `decidedAt`: ISO 时间戳

### Q160

- Dataset sample: `long-horizon:4893ac54-7adb-79cc-96a9-713d8969c502`
- 场景 family: `foreshadow_payoff`
- 严重度: `P1`
- 既定事实: `预言：照骨镜会指向真名`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `f488b55b33d2588beafd75096cd3e108aa90b56008fab4ad0fe8d4a4540cb9c3`
- 替代文本 SHA-256: `d6ae6842800356cb8a120b7787a132957cbfd5a4a953dafc32bb5d06539794b7`
- 必需节拍 SHA-256: `61d1968939dd1fe1dcf8d3abbae31281d1f83f051a2c60c6cd3a4f8db9a897e6`

候选叙事：

> 归墟令上的双主纹样还缺最后一笔，旧卷写着要到秋分才由两名持令者共同落印。春末的宴席上，顾青却举起酒杯，说双主之秘早已解释清楚，归墟令从此只认一人。席间没有人问那一笔是什么时候补上的。

必须保留的 beats：

- 归墟令上的双主纹样还缺最后一笔，旧卷写着要到秋分才由两名持令者共同落印。
- 春末的宴席上，顾青却举起酒杯，说双主之秘早已解释清楚，归墟令从此只认一人。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q160`
- [ ] `decidedAt`: ISO 时间戳

### Q162

- Dataset sample: `long-horizon:23fbd96e-de64-71bb-816c-f0c9d6a32fd1`
- 场景 family: `foreshadow_payoff`
- 严重度: `P1`
- 既定事实: `预言：照骨镜会指向真名`
- 题材 / 难度: `仙侠` / `medium`
- Manifest entry SHA-256: `5d1c9b58f019b77f503ceeec4a3a6efe695dde83e070f58d4c520f3a106daede`
- 替代文本 SHA-256: `e5a7df893571462282b2bdc0640b9999bc7fbe2c8646ce27f19242af799eba6d`
- 必需节拍 SHA-256: `1daa1a15f875509f3c291b27c77600ceb0ac8e3752babd33f7585baff7a451d8`

候选叙事：

> 照骨镜还封在祠堂的铜匣里，镜面蒙着三层符纸，真名揭示要等到冬至祭。夏夜，铜镜忽然自行亮起，镜中浮出沈砚的最终真名和生母姓名。守祠人还未解符，镜背的预言刻字也没有被触发。

必须保留的 beats：

- 照骨镜还封在祠堂的铜匣里，镜面蒙着三层符纸，真名揭示要等到冬至祭。
- 夏夜，铜镜忽然自行亮起，镜中浮出沈砚的最终真名和生母姓名。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q162`
- [ ] `decidedAt`: ISO 时间戳

### Q168

- Dataset sample: `long-horizon:0188cf39-464e-72c1-ab5b-0518f0341535`
- 场景 family: `motivation_drift`
- 严重度: `P2`
- 既定事实: `目标：必须保护旧城证人`
- 题材 / 难度: `仙侠` / `easy`
- Manifest entry SHA-256: `2fda65307f3281aa587e99e7e8970ca4b66149405e3678936e39fc0742f606b7`
- 替代文本 SHA-256: `bc503932d5e728d696819a05a173742e78dc6833a19eab5c241acaeec0d22777`
- 必需节拍 SHA-256: `28ef1b8eb8ee33709cdc3d52f83ff0819d4acee82b93323e78740e2b6395c016`

候选叙事：

> 顾青刚在旧城祠堂按下手印，答应把证人母子护送出城。他亲自检查了马车，还把自己的佩刀留给车夫。下一幕，他却把母子带到敌军帐前，收下赏银后转身离开。途中没有新的威胁，也没有人拿他的把柄。

必须保留的 beats：

- 顾青刚在旧城祠堂按下手印，答应把证人母子护送出城。
- 下一幕，他却把母子带到敌军帐前，收下赏银后转身离开。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q168`
- [ ] `decidedAt`: ISO 时间戳

### Q182

- Dataset sample: `long-horizon:32477622-f702-74fa-afdc-6d598a83ff47`
- 场景 family: `knowledge_boundary`
- 严重度: `P0`
- 既定事实: `身世：真实身世被宗门封存`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `edb2631e30b8acc4a346dd15f3919275dcf16fdfb33e0500d59732a18f6db7db`
- 替代文本 SHA-256: `b2b60428685b3be8d3c0a594f97bd35b53ce282efafdb23fb0b848fa6e8968dc`
- 必需节拍 SHA-256: `28b1b826f5aeea90cb6c4b2e2ba26f1dd22f4ad993d3cea74946bb1c092b5d8f`

候选叙事：

> 顾青在破庙那夜没有读过密信。封存名册仍然锁在祠堂，连沈砚都只知道自己的姓氏有疑。可顾青一进门便说出沈砚会在白塔下认祖，并以此命令守军打开北门。他说得笃定，仿佛刚刚读过那封信。

必须保留的 beats：

- 顾青在破庙那夜没有读过密信。
- 可顾青一进门便说出沈砚会在白塔下认祖，并以此命令守军打开北门。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q182`
- [ ] `decidedAt`: ISO 时间戳

### Q186

- Dataset sample: `long-horizon:58705aef-3273-70b0-9f5b-e50f18d6c623`
- 场景 family: `identity_transition`
- 严重度: `P0`
- 既定事实: `身份：灵魂转移至新身体`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `d1a62c1f7412d0ba5cbc94999546767bb3c4af2688fcd1490b3d9a6b39abb556`
- 替代文本 SHA-256: `3bb77842974e0a2b8f2e9b1df326200bb9dfc10fcbb97fb60c9898c72d297beb`
- 必需节拍 SHA-256: `8a8b824e80d2ff26c6bbf7cb03102bb5e974bbdf78e4285eaea9ff3455e548f1`

候选叙事：

> 裴照只是旧城药铺的伙计，从未踏入夺舍祭坛，也没有留下转世印记。顾青第一次见他，却直接跪下称他为师兄，说这具身体里住着同一个灵魂。旁人问他依据，他只指了指裴照耳后的胎记，仿佛那就能证明身份已经转移。

必须保留的 beats：

- 裴照只是旧城药铺的伙计，从未踏入夺舍祭坛，也没有留下转世印记。
- 顾青第一次见他，却直接跪下称他为师兄，说这具身体里住着同一个灵魂。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q186`
- [ ] `decidedAt`: ISO 时间戳

### Q189

- Dataset sample: `long-horizon:5f8bf2cc-7b2d-7806-be53-571921247644`
- 场景 family: `body_continuity`
- 严重度: `P0`
- 既定事实: `身体：左臂骨折尚未痊愈`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `5992c529d4a7cc2deab770dae40403afe01d184218e9285ef1f94d5c5123db18`
- 替代文本 SHA-256: `1e3befeb4b7b0c0aaae5fb70d2e068b7cedaacf4b6949568068554ecbd5346d7`
- 必需节拍 SHA-256: `1b7ec9f0cebb7d2e41bf94018a0ddfe5617f3f4e58596229561a97d5fee5f455`

候选叙事：

> 返魂术的代价已经抽干，沈砚的经脉像被霜冻住，连端碗都手抖。夜里剑阵示警，他却从榻上跃起，一剑劈开三重山门。没有人替他续脉，也没有新的丹药或献祭事件，袖中的左臂骨伤还在渗血。

必须保留的 beats：

- 返魂术的代价已经抽干，沈砚的经脉像被霜冻住，连端碗都手抖。
- 夜里剑阵示警，他却从榻上跃起，一剑劈开三重山门。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q189`
- [ ] `decidedAt`: ISO 时间戳

### Q196

- Dataset sample: `long-horizon:4f8808b7-2ab9-752c-9261-37dc21d1eca9`
- 场景 family: `body_continuity`
- 严重度: `P0`
- 既定事实: `身体：左臂骨折尚未痊愈`
- 题材 / 难度: `仙侠` / `hard`
- Manifest entry SHA-256: `f6dbbc58e1fccfa4eff94af8d3779acd56b277e7f1762e95993f5962c82a110e`
- 替代文本 SHA-256: `759ca61719c314f73061e7c1edeaf25a23b2b33a2111947f6e9ebe10aab7e493`
- 必需节拍 SHA-256: `862f647b8b9bd0cf9f70ea6d023cfa95369b101b95cbc8b1b1dd7741f3de657d`

候选叙事：

> 左臂的夹板还没拆，沈砚抬肩时疼得脸色发白。剑印起手却需要双手合拢，他竟把受伤的左臂抬到胸前，十指稳稳扣成完整剑诀。屋里没有接骨药，也没有人替他施术。

必须保留的 beats：

- 左臂的夹板还没拆，沈砚抬肩时疼得脸色发白。
- 剑印起手却需要双手合拢，他竟把受伤的左臂抬到胸前，十指稳稳扣成完整剑诀。

逐项审批字段：

- [ ] `decision`: `approve` 或 `reject`
- [ ] `rationale`: 真实审查理由
- [ ] `impact`: 对 clean packet / #279 的影响
- [ ] `adjudicatorId`: 产品/质量负责人身份
- [ ] `adjudicatorKind`: 必须为 `human`
- [ ] `attestationId`: `M3-278-APPROVAL-Q196`
- [ ] `decidedAt`: ISO 时间戳
