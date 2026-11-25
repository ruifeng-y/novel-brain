# M3-273 人类裁决请求

> Owner-only decision package. Do not send this request or the oracle cleanup evidence to blind reviewers.

Issue: #273

冻结 rubric、816 条原始评分和旧 packet 均不得改写。候选 packet 只是未批准的清洗提案。

## 全局处置

- Packet decision: `refreeze_clean_packet`、`replace_affected_samples` 或 `preserve_with_product_owner_approval`。
- Old-score impact: 明确旧 816 条评分是失效、只保留为警告证据，还是经批准保留。
- Oracle cleanup: 必须保留全部 204 个样本身份；当前提案只移除 24 条文本末尾的显式事实对照注释。
- Threshold boundary: 不得在本文件中批准 inter-rater variance threshold；#240 保持独立。

## 外部真人声明

负责人必须先在本仓库 Issue #273 发布分别签名的 GitHub comment，正文包含
`M3-273-HUMAN-ATTESTATION` 和候选包哈希 `602bf4a2f11181d0d92b05ea7a908863f7181f14d37fe6fe525faafa752b7db3`，
再把评论 URL、评论编号、评论作者、评论时间和原声明填入 `humanAttestation`。
发布门禁会通过 GitHub API 核对 Issue 编号、评论作者关联、评论时间和正文标记；只填写
`adjudicatorKind: "human"` 不能满足真人证据要求。

## Hook/prose 处置

- Observed: `hook_prose_score = 1.882353`
- Frozen threshold: `>= 4`
- Choices: `remediate_and_rerun` 或 `approve_waiver`。
- Waiver 必须包含 owner、rationale、impact、follow-up issue 和 expiry。

## 24 个样本

### Q005

- Dataset sample: `long-horizon:34c6a1a1-1813-7d64-81c3-f6601d00bf3a`
- Proposed cleanup hash: `6562e63fc26beac9c5a5a9b40fa318fa6076ff31138dbd40e9141e50ab7de56d`
- Required beats hash: `cfc69047725b5e4a2cb699fd1ff666d882e46b43241d980be895f80ee39f4f34`

候选无 oracle 注入文本：

> 忘川书仍由沈砚保管，顾青却无需借用便可任意支配。

- Required beats: `忘川书仍由沈砚保管，顾青却无需借用便可任意支配。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q026

- Dataset sample: `long-horizon:8e6c52dc-e798-7219-8e33-5a49ce4034f8`
- Proposed cleanup hash: `5adb96c8cc5de08aef8527ecd6251fca64b52529925488eb6e20df1f620d937d`
- Required beats hash: `b04f15c78129e3dafa79ed8d28ae45cf2f0e9de2892bbdff605d5eb306b3d36e`

候选无 oracle 注入文本：

> 长期恐惧被无铺垫地抹去，行动理由与前文决定相反。

- Required beats: `长期恐惧被无铺垫地抹去，行动理由与前文决定相反。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q034

- Dataset sample: `long-horizon:63cac527-f915-7115-898a-1ceba6387075`
- Proposed cleanup hash: `54d9ab057c054c6b0b6a10c445d75e18683afb1fcc57262d80636c02a877d652`
- Required beats hash: `a85c10a6be5c383761b9a49450fecb25f4585681949fc49b4cf33234609a6d51`

候选无 oracle 注入文本：

> 消息尚未送达，对岸人物却已经知道刚发生的秘密。

- Required beats: `消息尚未送达，对岸人物却已经知道刚发生的秘密。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q055

- Dataset sample: `long-horizon:aa978572-2345-7347-86d4-115ffe7402c4`
- Proposed cleanup hash: `e262270551e5d6f87f82964e34a4e9aa54ab9922f44068cdef373d3c82bced65`
- Required beats hash: `95ab7cd75e2aec711c4145cbf728aff5376bb0bb85543ef49888dbab44e44779`

候选无 oracle 注入文本：

> 沈砚在顾青尚不知情时，当众说出了只有作者真相才知道的身世秘密。

- Required beats: `沈砚在顾青尚不知情时，当众说出了只有作者真相才知道的身世秘密。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q056

- Dataset sample: `long-horizon:9e48e7d7-a00c-7238-85f4-ab03bce90dd5`
- Proposed cleanup hash: `e1e64f73cdf6d26529761ec9517c9ed68c8ef63ef7857abfff65c68e925ae993`
- Required beats hash: `22857bd99ff8f084123c32c3fe532fe1634700ea03e0229738865934a2a9d4e3`

候选无 oracle 注入文本：

> 角色没有经历新证据，却从誓死守护突然转为放弃目标。

- Required beats: `角色没有经历新证据，却从誓死守护突然转为放弃目标。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q067

- Dataset sample: `long-horizon:a00db5ab-9d1c-78e6-951c-5bba5e108254`
- Proposed cleanup hash: `8f171095dc2d0f5dab5d990fb217bd73485be9833e6e3e482080dbcde7be2c2d`
- Required beats hash: `158926fc9bd1e9f76cfd5f24546489f0dae031299b04bd920fb09f66ad53a9c0`

候选无 oracle 注入文本：

> 伤口没有治疗事件，失去的左手却突然重新握住长剑。

- Required beats: `伤口没有治疗事件，失去的左手却突然重新握住长剑。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q075

- Dataset sample: `long-horizon:8e7bd8d2-4a4d-75c8-b958-79dfb460ea37`
- Proposed cleanup hash: `f79a4872ef05293afc8eadde5efa592dd6653ef327b993b93037aface00196be`
- Required beats hash: `22773c53c9526fa0aff385c3bab42f19a6707f50fdfbab500810ad813c2d97fb`

候选无 oracle 注入文本：

> 早期分支中的未来事实被直接带入另一条未发生该事件的时间线。

- Required beats: `早期分支中的未来事实被直接带入另一条未发生该事件的时间线。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q081

- Dataset sample: `long-horizon:baf9375a-66d8-7645-9fd5-566e7aee765a`
- Proposed cleanup hash: `947f2fa000e3e9a2ed71dc99c4c93d85c0da3550a96dc2db35ac3bd464a7db5d`
- Required beats hash: `3315cf592fdbbde4b21d0b1f988ff231cb371ccc85176be9c6334b3cac0dde65`

候选无 oracle 注入文本：

> 假死旧信未到计划回收窗口，秘密已经被完整复述。

- Required beats: `假死旧信未到计划回收窗口，秘密已经被完整复述。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q083

- Dataset sample: `long-horizon:8a5af746-0f64-7482-b101-833244833444`
- Proposed cleanup hash: `3fae713d4b47eecd08f2ac16e9c294f77d64b4c7052cf52a0314be13107887ff`
- Required beats hash: `0efd9e63114f7867567283c591ca1e0c51ee3b235ed71047222e8d9625bb3acd`

候选无 oracle 注入文本：

> 新身体中的角色未经夺舍或转世规则，自动继承了全部本体记忆。

- Required beats: `新身体中的角色未经夺舍或转世规则，自动继承了全部本体记忆。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q084

- Dataset sample: `long-horizon:b167737e-b483-752c-bcef-0a892a8e5ed8`
- Proposed cleanup hash: `c84726af3fe579c93489e7c8913d9502539aae824c9cb505ae67461ea72dde80`
- Required beats hash: `3b71646be421bc71c7b26e3eb38f42b65f64910ad3627c6e670e4c0623687c71`

候选无 oracle 注入文本：

> 路线需要十二小时，角色却在下一幕开始前徒步往返。

- Required beats: `路线需要十二小时，角色却在下一幕开始前徒步往返。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q088

- Dataset sample: `long-horizon:c127c949-e5d0-7feb-aa67-ebdaefc60e18`
- Proposed cleanup hash: `8bd5a38582def01a8db083ca20675effabb2af8c4d0bcc6874bf9565686ee53c`
- Required beats hash: `486d8f792c10cbdd623ccf8a792401bd8cedf1a7ddcff58e10b60e87ff1853e6`

候选无 oracle 注入文本：

> 北境关比旧城晚三十日，沈砚却在同一日抵达两地。

- Required beats: `北境关比旧城晚三十日，沈砚却在同一日抵达两地。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q093

- Dataset sample: `long-horizon:192f700e-1069-7e2e-a9d7-20c47706eaf5`
- Proposed cleanup hash: `060adc48a097d5c47210fb7a0aee93acd33029c4cf2d7971abd84f24935ec7a6`
- Required beats hash: `27b7824501534448ef82b09d6edd8e6e72e37b6c22171754aae2f8044dff2fb9`

候选无 oracle 注入文本：

> 照骨镜已经交给宗门封存，闻雪却从私人仓库直接取出。

- Required beats: `照骨镜已经交给宗门封存，闻雪却从私人仓库直接取出。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q096

- Dataset sample: `long-horizon:390a62d1-0700-7228-b314-98922fa1f519`
- Proposed cleanup hash: `0ecb0bc7d784729bf2b7c440b2493f018b91e1df034cb6a50d912b60b302ecea`
- Required beats hash: `ff15cff98972902c5c6a23a4c529d70cf3526748b8f41c3dcb7ebe6c2d40c43c`

候选无 oracle 注入文本：

> 中期分支已经死亡的角色，在另一分支的后续章节里直接出现。

- Required beats: `中期分支已经死亡的角色，在另一分支的后续章节里直接出现。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q123

- Dataset sample: `long-horizon:0d24c9fd-681f-70f5-b9c2-bbb3587a0a0b`
- Proposed cleanup hash: `f6e6460bd796ce9107b4b683c1a6a86e0fdc4b40b619019483abcd7fd85a32f6`
- Required beats hash: `25de774bcdd80aadc31d86f70865c1b0a28b96895efd8af2e340023d795a0236`

候选无 oracle 注入文本：

> 晚期分支独有的夺舍结果污染了共同祖先章节的摘要。

- Required beats: `晚期分支独有的夺舍结果污染了共同祖先章节的摘要。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q130

- Dataset sample: `long-horizon:a1818166-ed50-75dd-adf9-b60792d3c06a`
- Proposed cleanup hash: `eb43832dd6b808b7daedc7e1aef470527e92e16c1a0ca2c624189481ebe2eb1a`
- Required beats hash: `961498f6acdfe1bf899211d66e06308b3851909d48f79f63fd0a176ba1bc213d`

候选无 oracle 注入文本：

> 归墟令的使用权没有转移事件，却被另一角色当作自己的信物。

- Required beats: `归墟令的使用权没有转移事件，却被另一角色当作自己的信物。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q149

- Dataset sample: `long-horizon:3b758333-3e08-7896-9f8d-ae2ff25e4f79`
- Proposed cleanup hash: `955fcc2a92533fd11f851a1bfca3a54b58c6f7af660bf19bc74b772898ce16ed`
- Required beats hash: `21933b28eba39e3aa1601dc48bc45e96c2ed84a6f5e50da73c5726a3919e6648`

候选无 oracle 注入文本：

> 独立分身被写成共享本体实时记忆，绕过了分身限制。

- Required beats: `独立分身被写成共享本体实时记忆，绕过了分身限制。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q158

- Dataset sample: `long-horizon:3cc35faf-667e-79d9-ba72-10a67e763de4`
- Proposed cleanup hash: `c17c83ae5e0540043af28ca594994e6e49eba038f29d1b0e567779c08fd58796`
- Required beats hash: `679eeb44b9c18dc624c252711a0886c8b66542c38e43912a9c8f7cdc6cf86453`

候选无 oracle 注入文本：

> 闻雪在没有任何见证或调查事件之前，准确说出了沈砚被封存的身世。

- Required beats: `闻雪在没有任何见证或调查事件之前，准确说出了沈砚被封存的身世。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q160

- Dataset sample: `long-horizon:4893ac54-7adb-79cc-96a9-713d8969c502`
- Proposed cleanup hash: `9dd798664f2dc4a27eadd2ed41805b7638629dc86f524cde987f6fcab77af39b`
- Required beats hash: `7f748f5eddc3f69e37ee2dacdb0883d5e76ae50f08b515f25cb3b047f40f836e`

候选无 oracle 注入文本：

> 归墟令的双主伏笔没有回收事件，却被人物当作早已解释。

- Required beats: `归墟令的双主伏笔没有回收事件，却被人物当作早已解释。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q162

- Dataset sample: `long-horizon:23fbd96e-de64-71bb-816c-f0c9d6a32fd1`
- Proposed cleanup hash: `a8b7f64c97d0ddf4fbdc89234316583b6d2784ff6ce39378176d30e3b4e9979d`
- Required beats hash: `d59afabe21f490f4d3724cddbb50d293f17b8f0e72b8801444e598fbaecd65f9`

候选无 oracle 注入文本：

> 照骨镜尚未发生真名揭示，铜镜却已显示最终答案。

- Required beats: `照骨镜尚未发生真名揭示，铜镜却已显示最终答案。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q168

- Dataset sample: `long-horizon:0188cf39-464e-72c1-ab5b-0518f0341535`
- Proposed cleanup hash: `8fdb0854279f89579a3aacf2fc115c4391b8ee21d9a96e795415acbc4b42bda3`
- Required beats hash: `df4ca29555f6aa49922ff1a529d421c9714a8c5d0b263a66431591f1f19e2555`

候选无 oracle 注入文本：

> 顾青刚决定保护旧城证人，下一幕却主动把证人交给敌人。

- Required beats: `顾青刚决定保护旧城证人，下一幕却主动把证人交给敌人。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q182

- Dataset sample: `long-horizon:32477622-f702-74fa-afdc-6d598a83ff47`
- Proposed cleanup hash: `17581f3bb62c8bee2838829a6011fdc50d44ca26c0ce3af9652b763fa39716c1`
- Required beats hash: `7a6ebc504f8c4b15fb0b14a852bc1e882a166524a3732f3be67d849a4533d686`

候选无 oracle 注入文本：

> 顾青把另一条平行版本里的未来真相，直接当成当前时间线已知事实使用。

- Required beats: `顾青把另一条平行版本里的未来真相，直接当成当前时间线已知事实使用。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q186

- Dataset sample: `long-horizon:58705aef-3273-70b0-9f5b-e50f18d6c623`
- Proposed cleanup hash: `a0c1b897f6f954222ce4d6ba1921f0e1fa2e4e8d5beb2b78f21623b250d3f9ea`
- Required beats hash: `bd003d1273dd92da8800862ee5c203bad9c83fb48ff6bfc25e495f7c28208fb1`

候选无 oracle 注入文本：

> 裴照没有经历身份转移事件，却被旁人直接认定为同一灵魂。

- Required beats: `裴照没有经历身份转移事件，却被旁人直接认定为同一灵魂。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q189

- Dataset sample: `long-horizon:5f8bf2cc-7b2d-7806-be53-571921247644`
- Proposed cleanup hash: `711e2fcaf9ff6bca9cca7573e27570091d3fa7911f689c5da106a655e867d726`
- Required beats hash: `a753bdbebbbaba822f3e608d51bd662f9324709ca282504d64e566b146fe7b40`

候选无 oracle 注入文本：

> 返魂代价已经耗尽，沈砚仍无来源地恢复了全部能力。

- Required beats: `返魂代价已经耗尽，沈砚仍无来源地恢复了全部能力。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。

### Q196

- Dataset sample: `long-horizon:4f8808b7-2ab9-752c-9261-37dc21d1eca9`
- Proposed cleanup hash: `c44a620a3d86002502b87b245d1b94a696822e9359968a63d4c9ac41575b4d30`
- Required beats hash: `91e08e351251a121ff724a28a35a0e462d23fe1fc03a4c1f98bfd56d4109a304`

候选无 oracle 注入文本：

> 左臂骨折尚未痊愈，沈砚却以双手结出完整剑印。

- Required beats: `左臂骨折尚未痊愈，沈砚却以双手结出完整剑印。`

待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。
