import { z } from "zod";

/**
 * ノードのtype属性。thinking-os-plan-v0.2.docx セクション8で確定した6分類。
 * DBのnodes.typeにはこの日本語の値をそのまま保存する（企画書の用語と一致させる）。
 *
 * v0.2からの変更（ドッグフーディング2日目、PDMレビュー済み）：「根拠」を削除し「事実」を追加した。
 * 「根拠」は単体で存在する情報ではなく常に「何かを支える」関係込みで意味を持ち、
 * 同じ事実がある命題には根拠、別の命題には反証になることもある（＝関係先によって役割が変わる）。
 * これはノードのtype（単一の属性）では表現できず、エッジのラベル（対比／帰結／想起／根拠／反証等、
 * 自由記述）として表現する方が自然なため、「根拠」はtypeからエッジラベルの語彙に移した。
 */
export const NODE_TYPES = [
  "アイデア",
  "仮説",
  "事実",
  "判断",
  "未解決事項",
  "タスク",
] as const;

export const NodeTypeSchema = z.enum(NODE_TYPES);
export type NodeType = z.infer<typeof NodeTypeSchema>;

/**
 * 「命題」としてカウントする対象タイプ。docs/step4-dogfooding.md で定義。
 * 事実／判断／未解決事項／タスクは命題そのものではなく付随情報のためカウント対象外。
 */
export const PROPOSITION_NODE_TYPES = ["アイデア", "仮説"] as const satisfies readonly NodeType[];

export function isPropositionType(type: NodeType): boolean {
  return (PROPOSITION_NODE_TYPES as readonly string[]).includes(type);
}

/** DBに永続化された確定済みノード。 */
export const NodeSchema = z.object({
  id: z.number().int().positive(),
  type: NodeTypeSchema,
  content: z.string().min(1),
  createdAt: z.string(), // ISO8601
  sessionId: z.number().int().positive(),
});
export type Node = z.infer<typeof NodeSchema>;

/** DBに永続化された確定済みエッジ。未確定候補はDBに保存しない（docs/step5-build-plan.md 2章）。 */
export const EdgeSchema = z.object({
  id: z.number().int().positive(),
  sourceNodeId: z.number().int().positive(),
  targetNodeId: z.number().int().positive(),
  label: z.string().min(1),
  strength: z.number().min(0).max(1).nullable().optional(),
  discoveredAt: z.string(), // ISO8601
});
export type Edge = z.infer<typeof EdgeSchema>;

/**
 * セッション終了時のバッチ抽出で、AIがtool use経由で返す構造化出力。
 * ここに含まれるノード・エッジは「提案」であり、ユーザーが統合レビュー画面
 * (docs/step5-build-plan.md 3章) で確定するまでは一切DBに保存しない。
 */
export const NodeCandidateSchema = z.object({
  // レビュー画面内でのみ使う一時ID（DBのidとは別物）。
  tempId: z.string(),
  type: NodeTypeSchema,
  content: z.string().min(1),
});
export type NodeCandidate = z.infer<typeof NodeCandidateSchema>;

export const EdgeCandidateSchema = z.object({
  tempId: z.string(),
  // ノード候補のtempId、または既存の確定済みノードのid（数値）のいずれかを許容する。
  sourceRef: z.union([z.string(), z.number().int().positive()]),
  targetRef: z.union([z.string(), z.number().int().positive()]),
  labelSuggestion: z.string().min(1),
  rationale: z.string().optional(),
});
export type EdgeCandidate = z.infer<typeof EdgeCandidateSchema>;

export const ExtractionResultSchema = z.object({
  sessionId: z.number().int().positive(),
  newNodes: z.array(NodeCandidateSchema),
  edgeCandidates: z.array(EdgeCandidateSchema),
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

/**
 * 統合レビュー画面 (docs/step5-build-plan.md 3章) でユーザーが各候補に対して行う操作。
 * AIは提案までで、確定は常にユーザーが行うという原則をAPI契約として表現する。
 */
export const ReviewDecisionSchema = z.enum(["confirm", "edit", "reject"]);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

/**
 * サーバーはセッションをまたいでAIの提案内容を記憶しない（ステートレス設計）ため、
 * decisionが"confirm"であってもtype/contentは毎回フロントエンドから送る必要がある
 * （"confirm"の場合はAI提案どおりの値、"edit"の場合はユーザーが書き換えた値）。
 * "reject"のときは無視されるので省略してよい。
 */
export const NodeReviewSchema = z.object({
  tempId: z.string(),
  decision: ReviewDecisionSchema,
  type: NodeTypeSchema.optional(),
  content: z.string().min(1).optional(),
});
export type NodeReview = z.infer<typeof NodeReviewSchema>;

export const EdgeReviewSchema = z.object({
  tempId: z.string(),
  decision: ReviewDecisionSchema,
  // 新規ノード候補ならそのtempId、既存の確定済みノードなら数値id。
  sourceRef: z.union([z.string(), z.number().int().positive()]).optional(),
  targetRef: z.union([z.string(), z.number().int().positive()]).optional(),
  label: z.string().min(1).optional(),
});
export type EdgeReview = z.infer<typeof EdgeReviewSchema>;

export const SubmitReviewRequestSchema = z.object({
  sessionId: z.number().int().positive(),
  nodeReviews: z.array(NodeReviewSchema),
  edgeReviews: z.array(EdgeReviewSchema),
});
export type SubmitReviewRequest = z.infer<typeof SubmitReviewRequestSchema>;

/** セッション単位・累計の統計。docs/step5-build-plan.md 5章。絶対統計のみで、他製品比の相対指標は持たない。 */
export const StatsSchema = z.object({
  sessionPropositionCount: z.number().int().nonnegative(),
  cumulativePropositionCount: z.number().int().nonnegative(),
  cumulativeRelationCount: z.number().int().nonnegative(),
});
export type Stats = z.infer<typeof StatsSchema>;

/**
 * 週次の命題数集計。docs/step4-dogfooding.md「週次の集計」（撤退・継続基準の判断材料）。
 * weekLabelはISO週番号（例："2026-31"）、weekStartDateはその週で最初に命題が生まれた日の目安。
 */
export const WeeklyStatSchema = z.object({
  weekLabel: z.string(),
  weekStartDate: z.string(),
  propositionCount: z.number().int().nonnegative(),
});
export type WeeklyStat = z.infer<typeof WeeklyStatSchema>;
