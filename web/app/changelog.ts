// What's new: player-facing release notes, newest first, shown by the title
// screen's "What's new" link (docs/ROADMAP.md §8). Hand-written in player
// language, never generated from commits; add an entry here when something a
// player can feel ships. No contributor names, and no running "N player sets
// are now in the pool" bullet (the author's calls, 2026-10-26/27).
import type {Lang} from './i18n.ts';

export interface NewsEntry { date: string; bullets: Record<Lang, string[]> }

export const CHANGELOG: readonly NewsEntry[] = [
  {date: '2026-10-28', bullets: {
    en: [
      'New player-contributed set: UU Scarf Moxie Krookodile.',
    ],
    zh: [
      '新增玩家投稿配置：UU Scarf Moxie Krookodile。',
    ],
    ja: [
      'プレイヤー投稿の型を追加：UU Scarf Moxie Krookodile。',
    ],
  }},
  {date: '2026-10-27', bullets: {
    en: [
      '5 new player-contributed sets: Scarf Wall Breaker Pangoro, Contrary Bulk Sweeper Enamorus, Victory Dance Sweeper Lilligant-Hisui, and two Unburden Sweeper Hawlucha (Liechi and Sitrus Berry).',
      '55 player sets are now in the pool.',
    ],
    zh: [
      '新增 5 套玩家投稿配置：Scarf Wall Breaker Pangoro、Contrary Bulk Sweeper Enamorus、Victory Dance Sweeper Lilligant-Hisui，以及两套 Unburden Sweeper Hawlucha（枝荔果与文柚果）。',
      '抽选池中的玩家配置已达 55 套。',
    ],
    ja: [
      'プレイヤー投稿の型を5つ追加：Scarf Wall Breaker Pangoro、Contrary Bulk Sweeper Enamorus、Victory Dance Sweeper Lilligant-Hisui、Unburden Sweeper Hawlucha ×2（チイラのみ／オボンのみ）。',
      'プールのプレイヤー投稿型は55になりました。',
    ],
  }},
  {date: '2026-10-26', bullets: {
    en: [
      '7 new player-contributed sets: Substitute CM Raikou, Sun Punch Dusknoir, Choice Band Spiritomb, Coil Sweeper Sandaconda, Iron Defense Regirock, Defensive Drampa, Calm Mind Wigglytuff.',
      '50 player sets are now in the pool.',
    ],
    zh: [
      '新增 7 套玩家投稿配置：Substitute CM Raikou、Sun Punch Dusknoir、Choice Band Spiritomb、Coil Sweeper Sandaconda、Iron Defense Regirock、Defensive Drampa、Calm Mind Wigglytuff。',
      '抽选池中的玩家配置已达 50 套。',
    ],
    ja: [
      'プレイヤー投稿の型を7つ追加：Substitute CM Raikou、Sun Punch Dusknoir、Choice Band Spiritomb、Coil Sweeper Sandaconda、Iron Defense Regirock、Defensive Drampa、Calm Mind Wigglytuff。',
      'プールのプレイヤー投稿型は50になりました。',
    ],
  }},
  {date: '2026-10-25', bullets: {
    en: [
      'First post-launch contributions landed: Spikes Quagsire, Scarf Buzzwole, SD Scolipede.',
      'Landed sets now appear on your next reload — no more hour-long wait.',
    ],
    zh: [
      '上线后的首批投稿已收录：Spikes Quagsire、Scarf Buzzwole、SD Scolipede。',
      '收录的配置现在刷新页面即可看到，不再需要等待一小时。',
    ],
    ja: [
      'リリース後最初の投稿を収録：Spikes Quagsire、Scarf Buzzwole、SD Scolipede。',
      '収録された型はリロードですぐ反映されるようになりました。',
    ],
  }},
  {date: '2026-10-24', bullets: {
    en: [
      'Rollmons has a home: rollmon.gg (the old addresses redirect).',
      'Fixed: Revival Blessing (Pawmot) aborted the battle when picking who to revive. Thanks to the player who reported it.',
    ],
    zh: [
      'Rollmons 有了正式域名：rollmon.gg（旧地址会自动跳转）。',
      '修复：帕莫特使用复生祝福选择复活对象时对战会中断。感谢报告此问题的玩家。',
    ],
    ja: [
      'Rollmons の正式ドメインが rollmon.gg になりました（旧アドレスはリダイレクト）。',
      '修正：パーモットの「さいきのいのり」で復活対象を選ぶ際にバトルが中断する問題。報告してくれたプレイヤーに感謝。',
    ],
  }},
  {date: '2026-10-23', bullets: {
    en: [
      'How it works: the rules, odds and scoring explained from the title screen.',
      'Start over button on the draft screen.',
      'Contribute drawer with tabs: a set for any Pokémon, a boss team, or feedback.',
      'Leaderboard shows each team as sprites and loads up to the top 100.',
      '40 player sets landed, including Mega Mewtwo X/Y and Mega Kangaskhan.',
    ],
    zh: [
      '玩法说明：从标题页即可查看规则、概率与计分。',
      '抽选页新增「重新开始」按钮。',
      '投稿抽屉改为分页：可投稿任意宝可梦的配置、头目队伍或反馈。',
      '排行榜以像素图标展示队伍，可查看前 100 名。',
      '收录 40 套玩家配置，包括超级超梦 X/Y 与超级袋兽。',
    ],
    ja: [
      '遊び方：タイトル画面からルール・確率・スコアの説明を見られます。',
      'ドラフト画面に「最初から」ボタンを追加。',
      '投稿ドロワーがタブ式に：任意のポケモンの型、ボスチーム、フィードバック。',
      'リーダーボードがチームをドット絵で表示、上位100位まで閲覧可能。',
      'プレイヤー投稿の型を40収録（メガミュウツーX/Y、メガガルーラなど）。',
    ],
  }},
];
