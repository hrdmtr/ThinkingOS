# Thinking OS（仮称）Step 3｜軽量な競合補強リサーチ

> Step 3成果物。4つのリサーチエージェントによる並列調査結果をまとめたもの。
> いずれも一次情報ではなく二次情報（ブログ・記事・GitHub等）中心の軽量調査であり、信頼度に幅がある点に注意。

---

## 1. LLM Wiki（Karpathyパターン）の最新動向

Karpathyのgist「llm-wiki.md」（2026年4月公開）は「フォルダに資料を投入→LLMが読み込みwikiページに統合」という設計で、公式文書自体には会話ストリームのようなリアルタイム入力への言及はなく、静的資料の逐次投入が前提。この点はarXiv論文「Streaming Knowledge Compilation」(2606.09877)でも「LLM wikiシステムは伝統的に静的コーパスを前提とするが、情報環境が継続的に進化する場合この前提が破綻する」と明言されており、企画側の主張（静的ドキュメントの一度きりのコンパイル）と一致する。

一方で、gistの派生実装「LLM Wiki v2」などでは継続的キャプチャやドリフト検出への拡張が既に試みられており、コミュニティ側もこのギャップを認識・対処し始めている段階にある。また、会話をエピソードノード化し時系列エッジで連結する手法（Zep等の会話グラフ手法）は、Karpathyパターンとは別の系譜として既に存在する。

**含意**：「静的×動的」の対比は裏付けが取れたが、「まだ誰も気づいていないギャップ」ではなく「認識され始めているが未解決のギャップ」という位置づけが正確。Thinking OSの差別化の軸は、静的/動的の対比よりも「関係ラベルの最終確定を人間が行う」という設計の方に置いた方が独自性を出しやすい（詳細後述）。

**出典**
- [karpathy's gist: llm-wiki.md](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
- [Streaming Knowledge Compilation (arXiv 2606.09877)](https://arxiv.org/pdf/2606.09877)
- [LLM Wiki v2 — extending Karpathy's pattern](https://gist.github.com/rohitg00/2067ab416f7bbe447c1977edaaa681e2)
- [Beyond RAG: How Andrej Karpathy's LLM Wiki Pattern Builds Knowledge](https://levelup.gitconnected.com/beyond-rag-how-andrej-karpathys-llm-wiki-pattern-builds-knowledge-that-actually-compounds-31a08528665e)

---

## 2. Obsidianプラグイン（Smart Connections等）の自動構造化の限界

Smart Connections、Text Generator等のObsidian向けAIプラグインは、いずれも埋め込みベクトルの類似度スコアで「関連しそうなノート」を提示するに留まり、関係の意味的ラベル付け（「根拠になる」「反証する」等）やアイデア/仮説/判断といった意味分類は行っていない。Smart Connections自体もGitHub上で「link building copilot」と自称しており、候補からWikilinkを実際に作るのは人間の操作。Text Generatorは要約・アウトライン生成が主目的でリンク構造化機能自体を持たない。第三者記事（mindwiki.io）も、Obsidianのプラグイン群には自動分類・自動リンカーの仕組みが本体に存在せず、個別プラグインを寄せ集める構造だと指摘している。

GitHub issuesでは類似度検索の粒度や動作不安定さへの不満は見つかったが、「ラベル付き関係を自動生成すべき」という明示的な要望は確認できなかった（探索範囲の限界の可能性あり）。

**含意**：「単純な埋め込み類似度によるリンク提案止まり」という企画側の主張は現時点でも概ね成立する。

**出典**
- [GitHub - brianpetro/obsidian-smart-connections](https://github.com/brianpetro/obsidian-smart-connections)
- [Smart Connections for Obsidian](https://smartconnections.app/smart-connections/)
- [GitHub - nhaouari/obsidian-textgenerator-plugin](https://github.com/nhaouari/obsidian-textgenerator-plugin)
- [Obsidian + AI: the plugin landscape, what's missing](https://mindwiki.io/blog/obsidian-plus-ai-landscape-and-alternative)

---

## 3. 日記・ジャーナリングアプリの継続率データ

日記/ジャーナリングアプリの30日継続率は12〜20%程度、AI搭載アプリ（ガイド付きプロンプト等）は継続率が15〜20ポイント向上する、という言及があるが、いずれも比較ブログ記事の要約であり出典・方法論が不明確なため信頼度は中程度にとどまる。「継続者は約8%、22%が試して挫折」という数字も個人ブログ由来で学術的裏付けは確認できなかった。挫折理由としては「効果が遅く見えにくい」「完璧主義」「辛い感情の回避」が繰り返し挙げられている。

対話型の優位性については、学術寄りの裏付けとして、Telegramチャットボット×GPT-4フィードバックによる14日間介入研究（n=115）でwell-being改善（+8.0%）、不安・抑うつ低下（各-12%前後）を確認。また対話的自己（dialogical self）研究は、単一視点の独白より複数視点が交差する対話の方が内省の質を高めると理論的に支持している。

**含意**：「他者性の欠如が継続・深化を妨げる」という主張を直接・定量的に検証した信頼できる一次データは見つからなかった。理論的支持（対話的自己理論）と間接的な介入効果（AIチャットボット併用型の改善効果）はあるが、これのみを実証根拠として企画書やPRに数値付きで掲載するのはリスクがある。定性的な論拠として使うか、ドッグフーディングで自分のデータを取ってから補強するのが安全。

**出典**
- [Why 3 Out of 4 People Quit Journaling (Medium)](https://medium.com/@mariomosca/why-3-out-of-4-people-quit-journaling-and-what-finally-made-it-stick-for-me-e134683d577b)
- [Here's Why Most People Quit Their Journaling Habit (Thrive Global)](https://community.thriveglobal.com/here-s-why-most-people-quit-their-journaling-habit/)
- [Integrating Chatbot-Driven Journaling and Advanced Language Models (ResearchGate)](https://www.researchgate.net/publication/384178928_Integrating_Chatbot-Driven_Journaling_and_Advanced_Language_Models_for_Psychological_Research)
- [Types of Inner Dialogues and Functions of Self-Talk (Frontiers in Psychology)](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2020.00227/full)
- [Two Modes of Reflection (arXiv 2510.05510)](https://arxiv.org/pdf/2510.05510)

---

## 4. Why Now｜LLM性能・コスト動向

- **トークン単価**：2025年初頭〜2026年にかけてLLM API価格は大幅下落。GPT-4o入力価格は$5.00→$2.50/百万トークンへ半減、廉価モデルは$0.10/百万トークン台まで低下したとの報告あり。DeepSeekやGemini Flash等の効率モデルは$1/百万トークン未満が一般化。
- **コンテキストウィンドウ**：2026年時点で主要フロンティアモデルが軒並み100万トークンの入力コンテキストを標準搭載する傾向。「過去の会話ログを都度全文読み込む」設計が技術的に現実的になってきたという方向性を裏付ける。
- **推論速度**：最新GPU・推論スタック最適化により旧世代比で数倍のスループット向上、Time-to-First-Tokenも1〜2秒台に短縮との報告。「会話のたびにAI推論を挟んでも体験を損ねない」水準に近づいている。

**含意**：3点とも「価格低下・コンテキスト拡大・速度向上」という方向性自体は複数の独立記事で一致しており、Why Nowの根拠として使える強さはある。ただし出典の多くが一次情報（Anthropic/OpenAI/Google公式の料金ページ・モデルカード）ではなく二次記事のため、企画書に具体的数値を載せる場合は各社公式情報での裏取りを推奨。

**出典**
- [LLM API Pricing Comparison In 2026 (CloudZero)](https://www.cloudzero.com/blog/llm-api-pricing-comparison/)
- [Cost Per Token Over Time (DeployBase)](https://deploybase.ai/articles/cost-per-token-over-time-how-llm-api-pricing-has-dropped)
- [Claude Context Window Size 2026 (Morph)](https://www.morphllm.com/claude-context-window)
- [AI Context Window Comparison 2026 (Digital Applied)](https://www.digitalapplied.com/blog/ai-context-window-comparison-2026-1m-to-10m-tokens)
- [Fastest LLM Inference APIs in 2026 (Inworld)](https://inworld.ai/resources/fastest-llm-inference-api)

---

## 総括：企画への反映ポイント

> **本質的価値と補強論拠を混同しない**：Thinking OSの本質的価値は「知識ベースが自分の中に蓄積されていくこと自体」（ビジョン文「会話を消費せず、育てる」）であり、これは静的/動的の対比とは独立に成立する価値である。以下の「静的LLM Wiki vs 動的会話ログ」の議論は、あくまで「なぜ既存ツールではこの価値が実現されてこなかったか」を補強する脇の論拠であり、PR本文の主役に据えるべきではない。

1. **「静的LLM Wiki vs 動的会話ログ」は需要の裏付けとして使える**：この対比は、Karpathyのgist派生実装やarXiv論文（Streaming Knowledge Compilation）など、独立した複数の観測者が同じギャップに既にたどり着いている論点だった。これは差別化の鮮度が薄れたということではなく、むしろ「複数の人が同じ問題に独立に気づき始めている＝そこに解くべきニーズがある」というWhy Nowの裏付けとして前向きに使える。そのうえで、「AIは想起と関係候補の提示まで、名付け（ラベル確定）は人間が行う」という役割分担は、今回調べた範囲（Obsidianプラグイン、LLM Wiki系、会話グラフ系のいずれも）に同種の設計を明示的に採る事例が見当たらなかった。両者は対立しないので、PR/FAQでは「静的×動的のギャップ＝需要の証拠」と「名付けを人間に残す設計＝独自性」を両輪で使うのがよい。
2. **ジャーナリングアプリとの対比は定性論拠にとどめる**：継続率データは信頼度が低い二次情報のみで、数値をPRに載せるのはリスクがある。「他者性の欠如」という論点自体は対話的自己理論等で理論的支持があるため、定性的な訴求として残しつつ、数値主張は避けるか、ドッグフーディングで得た自分のデータに差し替える。
3. **Why Nowは使える**：価格・コンテキスト・速度の3トレンドは方向性が一致しており、Why Now材料として採用可能。ただしPR/FAQ等の対外文書に具体的数値を出す場合は一次情報（公式料金ページ）での裏取りが必要。

---

## チェックリスト対応状況
- [x] LLM Wiki（Karpathyパターン）の最新動向を再確認
- [x] Obsidianプラグイン（Smart Connections等）の自動構造化の限界を確認
- [x] 日記アプリ／ジャーナリングアプリの継続率データがあれば収集
- [x] 「Why Now」を補強する材料を1〜2個追加
