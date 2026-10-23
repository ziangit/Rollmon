// UI strings in English (the keys), Simplified Chinese, and Japanese
// (docs/ROADMAP.md §9). Keys are the English text; `{name}` placeholders are
// filled by t(). Static markup carries data-i18n="<key>" and is retranslated
// by applyStatic(); dynamic strings call t() at render time. The replay
// player, set exports, and move/item names stay English.

export type Lang = 'en' | 'zh' | 'ja';
export const LANGS: readonly {code: Lang; label: string}[] = [{code: 'en', label: 'English'}, {code: 'zh', label: '中文'}, {code: 'ja', label: '日本語'}];
const LANG_KEY = 'rollmons-lang';

const STRINGS: Record<Exclude<Lang, 'en'>, Record<string, string>> = {
  zh: {
    'Rollmons — Draft & Battle': 'Rollmons — 抽选与对战',
    'Draft': '抽选', 'Loadout': '配置', 'Gauntlet': '挑战', 'Battle': '对战', 'Results': '结果',
    'Pokédex': '图鉴', '← Back': '← 返回',
    'Draft · Battle · Conquer': '抽选 · 对战 · 征服',
    'Roll 6 mons via Gen × Type, battle 10 bosses.': '按「世代 × 属性」摇出 6 只宝可梦，挑战 10 位头目。',
    '▶ Start a new run': '▶ 开始新的一局', 'Browse the pool': '浏览抽选池',
    'Lv 100 · Gen 9': 'Lv 100 · 第九世代',
    'Loading…': '加载中…', 'Loading game data…': '正在加载游戏数据…', 'Could not load game data: {error}': '无法加载游戏数据：{error}',
    '◓ Gen × Type Slot Roller': '◓ 世代 × 属性老虎机', 'GEN': '世代', 'TYPE': '属性',
    'A wild ’mon<br>appears here': '野生宝可梦<br>将出现在这里', '● Roll': '● 摇一下',
    'Step 1 — Build your team': '第 1 步 — 组建队伍', 'Draft your six': '抽选你的六只', 'Copy team export': '复制队伍文本', 'Copied ✓': '已复制 ✓',
    'Your party': '你的队伍', '{n} / 6 drafted': '已抽选 {n} / 6',
    'Team assembled 🎉': '队伍组建完成 🎉', 'Six unique Pokémon, locked at level 100. Next, choose each one\'s set.': '六只各不相同的宝可梦，等级固定为 100。接下来为每只选择配置。',
    'Choose sets →': '选择配置 →',
    'Complete': '完成', 'Round {n} of 6': '第 {n} / 6 轮', 'Wild cell': '野生格子',
    'Thin cell — only {n} from this generation; the rest are visitors from nearby generations.': '稀疏格子 — 本世代仅 {n} 只，其余由相邻世代的宝可梦补位。',
    'Skip cell ({a}/{b})': '跳过格子（{a}/{b}）', 'Gen {n}': '第 {n} 世代', 'Gen {g} · BST {b}': '第 {g} 世代 · 种族值 {b}',
    'Rarity': '稀有度', 'Poké Ball': '精灵球', 'Great Ball': '超级球', 'Ultra Ball': '高级球', 'Master Ball': '大师球', 'Visitor · Gen {n}': '客串 · 第 {n} 世代',
    'Slot odds — Poké Ball {c}% · Great Ball {u}% · Ultra Ball {r}% · Master Ball {l}%': '每格概率 — 精灵球 {c}% · 超级球 {u}% · 高级球 {r}% · 大师球 {l}%',
    'Pick {name}': '选择 {name}', 'Slot {n}': '位置 {n}', 'Empty': '空',
    'Rolling the first cell…': '正在摇出第一个格子…', 'game data is still loading': '游戏数据仍在加载',
    'Step 2 — Build each set': '第 2 步 — 配置每只宝可梦', 'Choose your sets': '选择配置',
    'Pick one set per Pokémon. Mega is opt-in — only one Mega can evolve per battle.': '为每只宝可梦选择一套配置。超级进化需主动选择 — 每场对战只能有一只超级进化。',
    'To the gauntlet →': '前往挑战 →', 'Set': '配置',
    'Step 3 — Set the ladder': '第 3 步 — 设定阶梯', 'Boss gauntlet': '头目挑战',
    'Run the tiered 10-battle campaign (random team per level), or set a manual ladder below.': '进行分层的 10 场战役（每层随机一支队伍），或在下方手动设定阶梯。',
    '🏔 Start campaign (10, tiered)': '🏔 开始战役（10 场，分层）', 'Manual: exhibition': '手动：表演赛', 'Manual: run ladder': '手动：阶梯赛',
    'Add a boss': '添加头目', 'Paste a Showdown team export.': '粘贴 Showdown 队伍文本。', 'Boss name': '头目名称', 'e.g. Champion Geeta': '例如：冠军 也奈',
    'PokéPaste export': 'PokéPaste 文本', 'Add boss': '添加', 'Cancel': '取消', 'Save boss': '保存', 'Edit': '编辑', 'Edit {name}': '编辑 {name}',
    'Advanced: single-boss test': '高级：单头目测试', 'Boss': '头目', 'Battle this boss': '挑战此头目',
    '{name} (pasted)': '{name}（粘贴）', '{name} (edited)': '{name}（已编辑）', 'pasted': '粘贴', 'edited': '已编辑',
    'No bosses found under rollmons/bosses/.': '在 rollmons/bosses/ 下未找到头目。', 'At least one boss must remain.': '至少要保留一位头目。',
    'Validate and save to apply.': '验证并保存后生效。', 'Name and export are required.': '名称和队伍文本都是必填的。',
    'A run can hold at most {n} bosses.': '一局最多 {n} 位头目。', 'Validating…': '正在验证…', 'Saved {name}.': '已保存 {name}。', 'Added {name}.': '已添加 {name}。',
    'Does not validate: {error}': '验证失败：{error}', 'Draft a team first.': '请先抽选队伍。', 'Add at least one boss first.': '请先添加至少一位头目。', 'Pick a boss to test.': '请选择要测试的头目。',
    'Step 4 — The arena': '第 4 步 — 竞技场', 'Each matchup plays out in the live Showdown engine.': '每场对战都在 Showdown 引擎中实时进行。',
    'Both AIs think on <em>your</em> device (about 4 s of one CPU core per battle, nothing is sent to a server).': '双方 AI 都在<em>你的</em>设备上思考（每场约占用一个 CPU 核心 4 秒，不会向服务器发送任何数据）。',
    'Low power: half the think time, slightly weaker play': '省电模式：思考时间减半，AI 略弱',
    'View run summary →': '查看本局总结 →',
    'Waiting': '等待中', 'Now': '进行中', 'Watch this battle': '观看这场对战', 'Tie': '平局', '{name} wins': '{name} 获胜', 'Live · turn {n}': '直播 · 第 {n} 回合', 'vs': 'vs',
    'Waiting for the first battle…': '等待第一场对战…', 'Matchups stream in here as your team climbs the ladder.': '随着队伍攀登阶梯，对战会在这里实时播放。',
    'No replay for this battle': '这场对战没有回放', '{label} in {n} turns.': '{label}，共 {n} 回合。',
    'Now battling {name} — {i} of {n}.': '正在对战 {name} — 第 {i} / {n} 场。', 'Now battling {name} — turn {n}.': '正在对战 {name} — 第 {n} 回合。',
    'Climbing the ladder — one loss ends the run.': '攀登阶梯 — 输一场即结束。', 'Exhibition — playing every boss.': '表演赛 — 对战所有头目。',
    'Tiered campaign — 10 battles, one random team drawn per level.': '分层战役 — 10 场对战，每层随机抽取一支队伍。',
    'Run complete — view the summary.': '本局结束 — 查看总结。', 'Single exhibition battle.': '单场表演赛。',
    'Campaign complete': '战役结束', 'Run complete': '本局结束', '{n}-battle campaign': '{n} 场战役', 'Champion! 🏆': '冠军！🏆', 'Run ended': '本局终止', 'Gauntlet complete': '挑战完成',
    'cleared {w}/{t}': '通关 {w}/{t}', '{avg} avg turns': '平均 {avg} 回合',
    'Damage by Pokémon': '各宝可梦伤害', 'share of team damage': '占队伍伤害比例', '{n}% dealt': '造成 {n}%', 'No damage was recorded this run.': '本局没有记录到伤害。',
    'Run MVP': '本局 MVP', 'MVP': 'MVP', 'of team damage · {n}% HP dealt': '的队伍伤害 · 造成 {n}% HP',
    'Wins': '胜', 'Losses': '负', 'Ties': '平', 'Avg turns': '平均回合', 'The climb': '攀登记录', 'tier by tier': '逐层', 'Not reached': '未到达', 'Win': '胜', 'Loss': '负',
    'Rewatch battles': '重看对战', '↻ New run': '↻ 新的一局',
    'Score': '得分', 'points': '分', 'No wins': '没有胜场', 'Base (wins × speed)': '基础分（胜场 × 速度）', 'Team handicap': '队伍系数', '(by tier)': '（按分级）',
    'Cakewalk': '热身', 'Meme': '整活', 'Red': '小赤', 'Middle': '中级', 'Advanced': '高级', 'Air': '终局',
    'Post as {name}': '以 {name} 发布', 'Sign in to post': '登录后发布成绩', 'Scores can only be posted on the hosted site.': '成绩只能在正式站点上发布。', 'Submitted.': '已提交。', 'Only fresh campaign runs can be submitted.': '只有全新的战役局可以提交。',
    'This run cannot be submitted.': '这一局无法提交。', 'Verifying your run…': '正在验证你的对局…',
    'Verified! You are #{rank} on the leaderboard.': '验证通过！你在排行榜上排名第 {rank}。', 'Verified! Your best is still {best} points (#{rank}).': '验证通过！你的最高分仍是 {best} 分（第 {rank} 名）。', 'Could not submit: {error}': '提交失败：{error}',
    'Leaderboard': '排行榜', '🏆 Leaderboard': '🏆 排行榜', 'top {n} · best run per player': '前 {n} 名 · 每位玩家的最佳成绩',
    'Sign in': '登录', 'Sign out': '退出', 'Log in': '登录', 'Register': '注册', 'Create account': '创建账号', 'Name': '名字', 'Password': '密码', 'Signing in…': '正在登录…',
    'No email and no password reset: a lost password is a lost account. Up to 5 accounts per network per day.': '不需要邮箱，也无法重置密码：忘记密码即失去账号。每个网络每天最多注册 5 个账号。', '{w}/{b} wins': '{w}/{b} 胜', 'No runs yet. Be the first!': '还没有记录，来做第一个吧！',
    'Normal': '一般', 'Loading pool…': '正在加载抽选池…', '{n} sets': '{n} 套配置', 'All': '全部', 'BST': '种族值', 'Tier': '分级', 'Cells': '格子',
    '{n} of {m} draftable Pokémon': '{n} / {m} 只可抽选宝可梦', '{n} natives': '本世代 {n} 只', 'thin': '稀疏', 'Click a cell to see its Pokémon.': '点击格子查看其中的宝可梦。', '{n} cells, {m} thin': '{n} 个格子，{m} 个稀疏',
    'Fire': '火', 'Water': '水', 'Grass': '草', 'Electric': '电', 'Ice': '冰', 'Fighting': '格斗', 'Poison': '毒', 'Ground': '地面', 'Flying': '飞行',
    'Psychic': '超能力', 'Bug': '虫', 'Rock': '岩石', 'Ghost': '幽灵', 'Dragon': '龙', 'Dark': '恶', 'Steel': '钢', 'Fairy': '妖精',
  },
  ja: {
    'Rollmons — Draft & Battle': 'Rollmons — ドラフト＆バトル',
    'Draft': 'ドラフト', 'Loadout': '型選び', 'Gauntlet': 'ボスラッシュ', 'Battle': 'バトル', 'Results': '結果',
    'Pokédex': 'ずかん', '← Back': '← 戻る',
    'Draft · Battle · Conquer': 'ドラフト · バトル · 制覇',
    'Roll 6 mons via Gen × Type, battle 10 bosses.': '「世代 × タイプ」のスロットで6匹を引き、10人のボスに挑もう。',
    '▶ Start a new run': '▶ 新しくはじめる', 'Browse the pool': 'プールを見る',
    'Lv 100 · Gen 9': 'Lv 100 · 第9世代',
    'Loading…': '読み込み中…', 'Loading game data…': 'ゲームデータを読み込み中…', 'Could not load game data: {error}': 'ゲームデータを読み込めませんでした：{error}',
    '◓ Gen × Type Slot Roller': '◓ 世代 × タイプ スロット', 'GEN': '世代', 'TYPE': 'タイプ',
    'A wild ’mon<br>appears here': 'やせいのポケモンが<br>ここに現れる', '● Roll': '● 回す',
    'Step 1 — Build your team': 'ステップ1 — チームを組む', 'Draft your six': '6匹をドラフト', 'Copy team export': 'チームをコピー', 'Copied ✓': 'コピーしました ✓',
    'Your party': 'てもち', '{n} / 6 drafted': '{n} / 6 匹',
    'Team assembled 🎉': 'チーム完成 🎉', 'Six unique Pokémon, locked at level 100. Next, choose each one\'s set.': '重複なしの6匹、レベルは100固定。次はそれぞれの型を選ぼう。',
    'Choose sets →': '型を選ぶ →',
    'Complete': '完了', 'Round {n} of 6': 'ラウンド {n} / 6', 'Wild cell': '出現マス',
    'Thin cell — only {n} from this generation; the rest are visitors from nearby generations.': '薄いマス — この世代は {n} 匹のみ。残りは近い世代からのゲストです。',
    'Skip cell ({a}/{b})': 'マスをスキップ（{a}/{b}）', 'Gen {n}': '第{n}世代', 'Gen {g} · BST {b}': '第{g}世代 · 種族値 {b}',
    'Rarity': 'レアリティ', 'Poké Ball': 'モンスターボール', 'Great Ball': 'スーパーボール', 'Ultra Ball': 'ハイパーボール', 'Master Ball': 'マスターボール', 'Visitor · Gen {n}': 'ゲスト · 第{n}世代',
    'Slot odds — Poké Ball {c}% · Great Ball {u}% · Ultra Ball {r}% · Master Ball {l}%': '各枠の確率 — モンスターボール {c}% · スーパーボール {u}% · ハイパーボール {r}% · マスターボール {l}%',
    'Pick {name}': '{name} を選ぶ', 'Slot {n}': '枠 {n}', 'Empty': '空き',
    'Rolling the first cell…': '最初のマスを回しています…', 'game data is still loading': 'ゲームデータを読み込み中です',
    'Step 2 — Build each set': 'ステップ2 — 型を決める', 'Choose your sets': '型を選ぶ',
    'Pick one set per Pokémon. Mega is opt-in — only one Mega can evolve per battle.': '1匹につき1つの型を選ぶ。メガシンカは任意 — 1バトルにつき1匹だけ。',
    'To the gauntlet →': 'ボスラッシュへ →', 'Set': '型',
    'Step 3 — Set the ladder': 'ステップ3 — はしごを組む', 'Boss gauntlet': 'ボスラッシュ',
    'Run the tiered 10-battle campaign (random team per level), or set a manual ladder below.': '段階式の10戦キャンペーン（各段からランダム1チーム）か、下で手動のはしごを組む。',
    '🏔 Start campaign (10, tiered)': '🏔 キャンペーン開始（10戦・段階式）', 'Manual: exhibition': '手動：エキシビション', 'Manual: run ladder': '手動：はしご戦',
    'Add a boss': 'ボスを追加', 'Paste a Showdown team export.': 'Showdownのチームテキストを貼り付け。', 'Boss name': 'ボスの名前', 'e.g. Champion Geeta': '例：チャンピオン オモダカ',
    'PokéPaste export': 'PokéPaste テキスト', 'Add boss': '追加', 'Cancel': 'キャンセル', 'Save boss': '保存', 'Edit': '編集', 'Edit {name}': '{name} を編集',
    'Advanced: single-boss test': '上級：ボス1人とテスト', 'Boss': 'ボス', 'Battle this boss': 'このボスと戦う',
    '{name} (pasted)': '{name}（貼り付け）', '{name} (edited)': '{name}（編集済み）', 'pasted': '貼り付け', 'edited': '編集済み',
    'No bosses found under rollmons/bosses/.': 'rollmons/bosses/ にボスが見つかりません。', 'At least one boss must remain.': 'ボスは最低1人必要です。',
    'Validate and save to apply.': '検証して保存すると反映されます。', 'Name and export are required.': '名前とチームテキストは必須です。',
    'A run can hold at most {n} bosses.': 'ボスは最大 {n} 人までです。', 'Validating…': '検証中…', 'Saved {name}.': '{name} を保存しました。', 'Added {name}.': '{name} を追加しました。',
    'Does not validate: {error}': '検証エラー：{error}', 'Draft a team first.': '先にチームをドラフトしてください。', 'Add at least one boss first.': '先にボスを1人以上追加してください。', 'Pick a boss to test.': 'テストするボスを選んでください。',
    'Step 4 — The arena': 'ステップ4 — アリーナ', 'Each matchup plays out in the live Showdown engine.': '各バトルはShowdownエンジンでリアルタイムに進行します。',
    'Both AIs think on <em>your</em> device (about 4 s of one CPU core per battle, nothing is sent to a server).': '両方のAIは<em>あなたの</em>端末で思考します（1バトルにつきCPU1コアを約4秒。サーバーには何も送信しません）。',
    'Low power: half the think time, slightly weaker play': '省電力：思考時間を半分にし、AIは少し弱くなります',
    'View run summary →': 'まとめを見る →',
    'Waiting': '待機', 'Now': '進行中', 'Watch this battle': 'このバトルを見る', 'Tie': '引き分け', '{name} wins': '{name} の勝ち', 'Live · turn {n}': 'ライブ · {n}ターン目', 'vs': 'vs',
    'Waiting for the first battle…': '最初のバトルを待っています…', 'Matchups stream in here as your team climbs the ladder.': 'はしごを登るにつれ、バトルがここに流れてきます。',
    'No replay for this battle': 'このバトルのリプレイはありません', '{label} in {n} turns.': '{label}（{n}ターン）。',
    'Now battling {name} — {i} of {n}.': '{name} と対戦中 — {i} / {n} 戦目。', 'Now battling {name} — turn {n}.': '{name} と対戦中 — {n}ターン目。',
    'Climbing the ladder — one loss ends the run.': 'はしごを登る — 1敗で終了。', 'Exhibition — playing every boss.': 'エキシビション — 全ボスと対戦。',
    'Tiered campaign — 10 battles, one random team drawn per level.': '段階式キャンペーン — 10戦、各段からランダムに1チーム。',
    'Run complete — view the summary.': 'ラン終了 — まとめを見よう。', 'Single exhibition battle.': 'エキシビション1戦。',
    'Campaign complete': 'キャンペーン終了', 'Run complete': 'ラン終了', '{n}-battle campaign': '{n}戦キャンペーン', 'Champion! 🏆': 'チャンピオン！🏆', 'Run ended': 'ラン終了', 'Gauntlet complete': 'ボスラッシュ完了',
    'cleared {w}/{t}': 'クリア {w}/{t}', '{avg} avg turns': '平均 {avg} ターン',
    'Damage by Pokémon': 'ポケモン別ダメージ', 'share of team damage': 'チーム内の割合', '{n}% dealt': '{n}% 与えた', 'No damage was recorded this run.': 'このランではダメージが記録されませんでした。',
    'Run MVP': 'ランのMVP', 'MVP': 'MVP', 'of team damage · {n}% HP dealt': 'のチームダメージ · {n}% HP を削った',
    'Wins': '勝', 'Losses': '敗', 'Ties': '分', 'Avg turns': '平均ターン', 'The climb': '登頂記録', 'tier by tier': '段ごと', 'Not reached': '未到達', 'Win': '勝ち', 'Loss': '負け',
    'Rewatch battles': 'バトルを見直す', '↻ New run': '↻ 新しいラン',
    'Score': 'スコア', 'points': 'ポイント', 'No wins': '勝利なし', 'Base (wins × speed)': '基礎点（勝利 × スピード）', 'Team handicap': 'チーム係数', '(by tier)': '（ティア基準）',
    'Cakewalk': '楽勝', 'Meme': 'ネタ', 'Red': 'レッド', 'Middle': '中級', 'Advanced': '上級', 'Air': '最終',
    'Post as {name}': '{name} として登録', 'Sign in to post': 'ログインして登録', 'Scores can only be posted on the hosted site.': 'スコアは公開サイトでのみ登録できます。', 'Submitted.': '登録済み。', 'Only fresh campaign runs can be submitted.': '登録できるのは新規のキャンペーンランだけです。',
    'This run cannot be submitted.': 'このランは登録できません。', 'Verifying your run…': 'ランを検証中…',
    'Verified! You are #{rank} on the leaderboard.': '検証完了！ランキング {rank} 位です。', 'Verified! Your best is still {best} points (#{rank}).': '検証完了！自己ベストは {best} 点のままです（{rank} 位）。', 'Could not submit: {error}': '登録できませんでした：{error}',
    'Leaderboard': 'ランキング', '🏆 Leaderboard': '🏆 ランキング', 'top {n} · best run per player': '上位 {n} · プレイヤーごとのベスト',
    'Sign in': 'ログイン', 'Sign out': 'ログアウト', 'Log in': 'ログイン', 'Register': '新規登録', 'Create account': 'アカウント作成', 'Name': '名前', 'Password': 'パスワード', 'Signing in…': 'ログイン中…',
    'No email and no password reset: a lost password is a lost account. Up to 5 accounts per network per day.': 'メール不要・パスワード再設定なし：パスワードを忘れるとアカウントは失われます。1 つのネットワークから 1 日に作れるアカウントは 5 つまで。', '{w}/{b} wins': '{w}/{b} 勝', 'No runs yet. Be the first!': 'まだ記録がありません。最初の1人になろう！',
    'Normal': 'ノーマル', 'Loading pool…': 'プールを読み込み中…', '{n} sets': '型 {n} 件', 'All': 'すべて', 'BST': '種族値', 'Tier': 'ティア', 'Cells': 'マス',
    '{n} of {m} draftable Pokémon': 'ドラフト可能 {n} / {m} 匹', '{n} natives': 'この世代 {n} 匹', 'thin': '薄い', 'Click a cell to see its Pokémon.': 'マスをクリックするとポケモンが表示されます。', '{n} cells, {m} thin': '{n} マス、薄いマス {m}',
    'Fire': 'ほのお', 'Water': 'みず', 'Grass': 'くさ', 'Electric': 'でんき', 'Ice': 'こおり', 'Fighting': 'かくとう', 'Poison': 'どく', 'Ground': 'じめん', 'Flying': 'ひこう',
    'Psychic': 'エスパー', 'Bug': 'むし', 'Rock': 'いわ', 'Ghost': 'ゴースト', 'Dragon': 'ドラゴン', 'Dark': 'あく', 'Steel': 'はがね', 'Fairy': 'フェアリー',
  },
};

export function detectLang(navigatorLanguage: string | undefined, stored: string | null): Lang {
  if (stored === 'en' || stored === 'zh' || stored === 'ja') return stored;
  const nav = (navigatorLanguage ?? '').toLowerCase();
  if (nav.startsWith('zh')) return 'zh';
  if (nav.startsWith('ja')) return 'ja';
  return 'en';
}

let current: Lang = 'en';
export function lang(): Lang { return current; }
export function setLang(l: Lang): void {
  current = l;
  try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ }
}
export function initLang(override?: string | null): Lang {
  let stored: string | null = null;
  try { stored = localStorage.getItem(LANG_KEY); } catch { /* private mode */ }
  current = detectLang(typeof navigator !== 'undefined' ? navigator.language : undefined, override ?? stored);
  return current;
}

/** Translate `key` (English text) into the current language, filling `{placeholders}`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const s = current === 'en' ? key : (STRINGS[current][key] ?? key);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

export function translations(l: Exclude<Lang, 'en'>): Readonly<Record<string, string>> { return STRINGS[l]; }

/** Retranslate static markup: data-i18n (text), data-i18n-html, data-i18n-placeholder, data-i18n-title. */
export function applyStatic(root: ParentNode & {documentElement?: HTMLElement}): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml!); });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder!); });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle!); });
  root.querySelectorAll<HTMLSelectElement>('select[data-lang-select]').forEach((el) => { el.value = current; });
  if (root.documentElement) root.documentElement.lang = current === 'zh' ? 'zh-CN' : current;
}

export interface SpeciesNames { [num: string]: {zh?: string; ja?: string} }
export interface DexEntryForName { num?: number; forme?: string; baseSpecies?: string }

/** Localised species name: the base species' name in the current language plus the English forme suffix. */
export function localSpeciesName(englishName: string, entry: DexEntryForName | undefined, names: SpeciesNames | undefined): string {
  if (current === 'en' || !entry || !names || entry.num === undefined) return englishName;
  const local = names[String(entry.num)]?.[current];
  if (!local) return englishName;
  return entry.forme ? `${local}-${entry.forme}` : local;
}
