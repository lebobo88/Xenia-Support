# Building Production-Grade Multi-Agent AI Teams for Customer Support: Architectures, Skills, Operations, and Governance Across Enterprise and SMB

## Executive Summary

Agentic AI is reshaping customer support by moving from single chatbots and static self-service flows toward coordinated teams of autonomous agents embedded into contact center and CRM ecosystems. Analyst firms forecast that by the end of the decade, these systems will be capable of autonomously resolving a large majority of routine issues, but will coexist with human agents in tightly coupled hybrid models rather than fully replacing them. This report synthesizes current industry practice, academic research, and vendor architectures to define how to design, deploy, and govern multi-agent support teams for both SMB and enterprise contexts.[^1][^2][^3][^4][^5]

Key findings include:

- Multi-agent architectures with explicit orchestration (graph- or policy-based) materially outperform monolithic bots on complex multi-turn support workflows and reduce error rates when combined with review and moderation agents.[^6][^7][^8]
- The emerging de facto topology in production is a primary orchestrator agent fronting a pool of specialized agents, often backed by shared RAG and observability layers, with human supervisors positioned as "automation managers" rather than front-line responders.[^9][^10][^11]
- Cost-to-serve advantages are highly context-dependent: while McKinsey and vendor case studies show large productivity and CSAT gains, recent Gartner-aligned analyses warn that per-resolution gen-AI costs can exceed offshore human agents by 2030 unless orchestration, guardrails, and use cases are tightly scoped.[^12][^13][^3][^14]
- Security and governance are rapidly formalizing around the OWASP Top 10 for LLM applications and a newer OWASP GenAI/Agentic security body of work, with specific focus on prompt injection, insecure output handling, excessive agency, and memory/context poisoning in agent networks.[^15][^16][^17]
- For SMBs, platform-native agent stacks from CCaaS/CRM providers (e.g., Salesforce Agentforce, HubSpot Breeze Agents) offer the best path to value in the next 3–6 months; enterprises in regulated sectors increasingly adopt pattern-based, event-driven multi-agent architectures with explicit shared state and portable context layers.[^18][^19][^10][^20][^21][^22]

The rest of this report follows the requested structure: paradigm shift, agent taxonomy, enterprise vs. SMB approaches, orchestration and state management, HITL and escalation, SWOT and risk, compliance and governance, deployment roadmap, and emerging gaps.

## The Paradigm Shift: Legacy Bots vs. Agentic AI Teams

### From decision trees to autonomous workflows

Legacy chatbots and IVR systems relied on deterministic, rules-based flows (decision trees, intent-routing with fixed responses), with limited ability to handle ambiguity or multi-intent queries. Generative and agentic AI introduce agents that can reason over unstructured knowledge, call tools and APIs, and coordinate with other agents to complete end-to-end workflows rather than answer single turns.[^23][^24][^25][^26][^6]

Gartner and Forrester describe this shift as moving from channel-based self-service widgets to "digital customer interaction solutions" and "conversational AI platforms" that orchestrate dynamic blends of automation and human assistance across chat, messaging, voice, and third‑party assistants. Salesforce and HubSpot similarly position their agent platforms as digital labor layers that sit on top of CRM, CCaaS, and data clouds, executing tasks such as case routing, order lookup, refunds, and proactive outreach via autonomous agents.[^4][^25][^10][^20][^21][^27]

### Expected business impact and realistic constraints

McKinsey’s 2024 work on gen AI in customer care highlights 30–50 percent gains in agent productivity and double-digit improvements in containment and CSAT when gen-AI assistants are deployed well, especially in knowledge-intensive support. Experimental evidence from a large-scale deployment of an AI assistant to 5,000+ human agents similarly shows roughly 14–18 percent productivity gains and larger benefits for less experienced agents. At the same time, Gartner and CIO-oriented coverage caution that fully automated, agentless models can become more expensive than offshore labor and that many companies are re-hiring or retaining human agents in hybrid Human+AI models.[^2][^3][^28][^14][^29][^12]

Forrester predicts that contact centers will evolve toward automation supervisors and specialists who manage fleets of AI agents, while conversational AI platforms must straddle modern LLM capabilities and real-world CCaaS constraints. The net implication is that multi-agent AI should be framed as an augmentation layer that shifts humans into oversight, exception handling, and complex relationship work rather than a pure cost-elimination play.[^5][^9][^4]

## Taxonomy of a Customer Support AI Agent Team (Roles, Skills, & Tools)

### Canonical agent roles

Academic and industrial work on multi-agent customer service systems converges on a set of recurring roles with different scopes and tools. The table below summarizes a practical taxonomy tailored to support:[^7][^8][^21][^6]

| Agent Role | Primary Responsibilities | Typical Tools/Systems | Notes |
|-----------|---------------------------|------------------------|-------|
| Triage/Router Agent | Classify intent, detect language and sentiment, route to specialized agent or human queue | NLU classifier, ticketing API, language detection, sentiment model | Often implemented as the primary orchestrator in hierarchical topologies.[^10][^11][^22] |
| FAQ / Self-Service Agent | Resolve routine inquiries, surface KB articles, handle simple transactions | RAG over KB, FAQ store, lightweight transactional APIs | For SMB, often equals the only external-facing agent; in enterprise, it is one specialist among many.[^20][^30] |
| Billing & Account Agent | Handle invoices, refunds, plan changes, payment failures | Billing APIs, ERP/finance system, policy rules engine | Requires strong guardrails and approval workflows for monetary actions.[^19][^31] |
| Technical Triage Agent | Diagnose product issues, collect logs, run troubleshooting scripts | Product telemetry APIs, log search, runbook database, remote diagnostics tools | Often collaborates with human L2/L3 engineering.[^8][^22] |
| Loyalty & Retention Agent | Identify churn risk, offer incentives, negotiate retention offers | CRM, propensity/churn models, discount/coupon APIs | May be constrained to recommendation mode with human approval in regulated sectors.[^32][^31] |
| QA & Compliance Monitoring Agent | Review agent (AI and human) conversations for policy violations, hallucinations, and quality | Conversation logs, pattern rules, embedding similarity, policy catalogs | Multi-agent moderation architectures show significant improvements in quality and auditability.[^7][^33] |
| Knowledge Management Agent | Detect content gaps, propose or draft new KB articles from tickets | Ticket logs, KB CMS API, document store | Prominent in HubSpot’s Knowledge Base Agent and similar offerings.[^20][^27] |
| Analytics & Optimization Agent | Monitor KPIs, run experiments, suggest workflow or prompt changes | Data warehouse, BI/metrics APIs, LangSmith/observability tools | Supports continuous improvement loops.[^22][^34] |

### Core capabilities and skills

Across these roles, production-grade agents share a set of foundational skills:[^8][^23][^6]

- **Tool execution and API calling**: Structured function-calling to perform reads and writes in CRM, ticketing, billing, logistics, and authentication systems, typically expressed via JSON schemas with strict typing and error handling.
- **Dynamic RAG and knowledge access**: Retrieval over product docs, KB, policy manuals, and historical tickets, often using vector stores and sometimes graph-enhanced RAG for reliability and source attribution.[^35]
- **Stateful dialogue and context management**: Ability to preserve customer context, active objects (order, subscription, device), and constraints across multi-step workflows, even as control passes between agents.[^10][^11][^6]
- **Empathy and sentiment modulation**: Real-time sentiment tracking and style adaptation to de-escalate conversations, with guardrails to avoid manipulative behavior.[^36][^37]
- **Policy and compliance awareness**: Encoded constraints around refunds, disclosures, consent, and regional regulatory requirements (e.g., “right to a human representative”).[^32][^15]

## Enterprise vs. SMB Benchmarks & Architectural Approaches

### Platform patterns for SMBs

SMBs typically lack the engineering capacity to build custom agent orchestration layers and instead favor embedded AI within their existing CRM and help desk platforms. HubSpot’s Breeze Customer Agent exemplifies this: it is deployed as a 24/7 concierge that handles lead qualification and support, uses unified CRM data to personalize responses, and resolves more than half of support tickets automatically for many customers. These agents are configured via declarative workflows and limited tool bindings (e.g., ticket creation, order tracking, simple account updates) rather than arbitrary code.[^20][^30][^38][^39]

Similarly, CCaaS providers and CRM platforms such as Salesforce (Agentforce), Genesys, and other vendors in the Forrester Digital Customer Interaction Solutions and CCaaS Waves offer multi-channel AI agents, knowledge bots, and agent assist features as managed services with per-seat or per-interaction pricing. Forrester emphasizes that these platforms dynamically balance automated and human-assisted experiences, providing out-of-the-box orchestration and analytics for small teams.[^25][^40][^19][^11][^18][^10]

### Custom architectures for enterprises

Enterprises, particularly in financial services, telecom, and regulated B2B SaaS, increasingly adopt custom multi-layer architectures where LLM-based agents sit alongside event-driven integration layers, data lakes, and advanced security controls. A representative Salesforce Agentforce architecture uses:[^41][^19][^18]

- A **multi-agent orchestration layer** powered by an "Atlas Reasoning Engine" that routes tasks from a primary agent to specialist agents and, via Agent2Agent (A2A), to third‑party agents.[^11][^42][^10]
- A **unified data layer** (Salesforce Data Cloud) that serves as the shared state/memory for customer profiles, interactions, and permissions, accessible to agents based on policy.[^43][^18]
- **Event-driven integration** via Flow, Apex, and MuleSoft to connect Service Cloud, Marketing Cloud, Commerce Cloud, and external systems while maintaining decoupled workflows.[^18][^41]
- **Observability and governance** (Agentforce Observability, Salesforce Shield) for monitoring, encryption, and policy enforcement over agent actions and data access.[^10][^18]

Case studies on Agentforce deployments report substantial improvements: one study reports First-Call Resolution rising from 68 to 90 percent, Average Handle Time dropping by 28 percent, and customer satisfaction increasing by 22 percent with payback in approximately five months. Multi-firm analyses further show strong ROI for AI-augmented case management but stress the need for granular instrumentation to attribute value to specific capabilities (bots, routing, automation) and guide optimization.[^19][^31]

### Enterprise vs. SMB stack comparison

| Dimension | SMB-Oriented Stack (e.g., HubSpot, mid-market CCaaS) | Enterprise-Oriented Stack (e.g., Salesforce Agentforce, custom LangGraph/CrewAI) |
|----------|------------------------------------------------------|--------------------------------------------------------------------------------|
| Orchestration | Embedded, vendor-defined; configuration via low-code flows and intents.[^25][^20] | Explicit graph/policy-based orchestration, often using frameworks like LangGraph or custom orchestrators plus platform engines.[^6][^10][^22] |
| Agents | 1–5 pre-defined agents (Customer, KB, Prospecting) plus a few assistants.[^20][^27] | Dozens of specialized agents including ambient/background agents across service, sales, marketing, and operations.[^18][^21][^22] |
| Data | Single-tenant CRM and ticketing data; limited external data joins. | Unified data cloud / lakehouse aggregating CRM, billing, usage, marketing, with fine-grained access control.[^18][^41][^43] |
| Channels | Web chat, email, some messaging (WhatsApp, FB Messenger).[^20][^30] | Omnichannel including voice, SMS, mobile app, third‑party assistants and partner bots.[^25][^40][^21] |
| Governance | Basic role-based access and content filters, platform-level logging. | Formal governance including encryption at rest/transport, audit trails, explainability, and policy controls mapped to frameworks such as SOC 2, GDPR, HIPAA.[^18][^19][^15] |
| Customization | Prompt and KB tuning, pre-built actions; limited custom tools. | Full custom tools, external agents, memory strategies, and integration patterns; can embed internal models and proprietary orchestration.[^6][^41][^44] |
| Cost Model | Platform subscription plus usage; optimized for quick time-to-value. | Combination of platform licensing, cloud infrastructure, LLM token costs, and engineering headcount; optimized for TCO and strategic capabilities.[^40][^29][^31] |

## Technical Orchestration & State Management Best Practices

### Orchestration topologies: hierarchical vs. peer-to-peer

Multi-agent frameworks and industry implementations support both hierarchical and peer-to-peer topologies. In hierarchical designs, a primary orchestrator agent interprets the customer request, makes decomposition decisions, and delegates sub-tasks to specialist agents, aggregating results into a final response; Salesforce Agentforce and many LangGraph-based systems use this pattern. Peer-to-peer designs allow agents to discover and message each other more freely, which increases flexibility but raises the risk of loops, inconsistent state, and unbounded token usage.[^22][^45][^44][^46][^6][^8][^11][^10]

Emerging best practice is to use **graph-based orchestration** where agents are nodes in a directed state graph with explicit transitions, timeouts, and termination conditions, ensuring that control flow is deterministic even when agent internals are stochastic. LangGraph and similar libraries provide a unified state object passed between nodes, which can include conversation history, active tickets, and per-agent scratch space, with orchestration logic expressed declaratively.[^45][^34][^6][^35]

### State, memory, and portable context

One of the most challenging aspects of multi-agent support systems is preserving rich context across agent handoffs and over time without exhausting context windows or leaking sensitive data. Vendors and architects are converging on a layered memory model:[^17][^6][^43]

- **Transient conversation state** held in the orchestrator or channel adapter (chat session, call session), containing recent turns and active object references.
- **Shared long-term memory** stored in a permission-aware data cloud, vector store, or graph database capturing tickets, prior interactions, and preferences; accessed via tools, not via direct prompt stuffing.[^35][^17][^18]
- **Agent-local working memory** for intermediate reasoning (e.g., plans, critiques) that is not written back unless explicitly approved.

Thought leaders in the Agentforce ecosystem argue for a "portable context" layer—a structured, signed state token representing user identity, goals, and current objects—that travels across agents and platforms akin to a SAML assertion for intent and tone. This pattern reduces reintroduction friction while enforcing a single source of truth and helps defend against memory and context poisoning attacks highlighted by OWASP’s agentic security work.[^43][^17]

### Loop prevention and cost control

To mitigate token runaway risk and infinite agent loops, production systems implement several controls:

- **Global step and token budgets** per interaction and per workflow, enforced at the orchestrator and platform level.[^16][^45]
- **Graph-level termination conditions** such as maximum depth, explicit terminal states (e.g., "Escalate to human", "Create follow-up ticket"), and error states for tool failures.[^6][^35]
- **Instrumentation and evaluation** pipelines that continuously log agent traces, analyze stuck states, and refine prompts and routing rules; examples include LangSmith-based evaluation and telemetry for LangGraph deployments.[^34][^22]

Industry analyses also stress the importance of carefully scoping use cases and models for cost control, given forecasts that per-resolution gen-AI costs may exceed 3 USD by 2030 without optimization. This reinforces the need for stateless tools where possible, aggressive KB caching, and tiered model selection (e.g., using cheaper models for triage and KB lookups, premium models only for complex reasoning).[^3][^14]

## Human-in-the-Loop (HITL) & Escalation Architectures

### HITL patterns in customer support

Academic systems and real-world platforms increasingly treat human agents as collaborators rather than fallbacks. Typical HITL patterns include:[^28][^12][^36]

- **AI-co-pilot for human agents**: Gen-AI suggests responses, surfaces relevant KB content, and updates case fields while humans retain final say; shown to significantly boost productivity and quality, especially for less experienced agents.[^12][^28]
- **Shadow AI agents**: AI agents draft responses and actions in the background for live tickets, with human reviewers approving or editing outputs—a "reverse pilot" mode during initial rollout.[^36][^28]
- **AI-first with escalation**: AI agents handle the initial interaction and resolve low/medium complexity issues, but escalate based on thresholds (confidence, sentiment, risk, regulatory flags, tool errors) to human queues.[^47][^48]

Hybrid models highlighted by Gartner and Forrester position human staff as automation supervisors and specialists managing AI fleets, rather than front-line responders, while ensuring a "digital first, but not digital only" strategy.[^9][^2][^5]

### Escalation triggers and workflows

Best-practice escalation topologies define explicit triggers:

- **Low confidence or missing knowledge**: Based on retrieval coverage metrics, model self-assessment, or secondary critic agents.[^33][^7]
- **High-risk actions**: Financial credits, contract changes, and irreversible actions require human approval or at least a secondary verification agent.[^31][^19]
- **Regulatory and sentiment thresholds**: If the customer explicitly requests a human, if the system detects sustained negative sentiment, or if jurisdiction mandates access to human agents, the workflow must switch to a person.[^37][^3][^32]

Implementation-wise, escalation is best modeled as a terminal state in the orchestration graph that hands control to a human queue with full context (conversation history, agent actions attempted, relevant KB passages) and clearly marks which actions were or were not executed.

### Supervisor experience and "Agent Manager" role

The emerging "Agent Manager" role—akin to a site reliability engineer for AI workflows—needs:

- Dashboards showing containment and escalation rates by use case, segment, and channel.[^48][^29][^22]
- Trace views that let supervisors replay agent interactions, inspect tool calls, and annotate errors for retraining.
- Controls to throttle specific tools or agents, adjust confidence thresholds, and push hotfixes to prompts or policies without code deployments.

Vendor tools such as Agentforce Observability and evaluation platforms around LangGraph are converging on these needs by providing trace visualization, performance metrics, and policy enforcement hooks.[^22][^34][^10]

## SWOT & Comprehensive Risk Assessment

### SWOT overview for multi-agent AI support systems

| Category | Key Points |
|---------|-----------|
| Strengths | 24/7 availability, instant responses, multi-language support, and the ability to orchestrate complex workflows via tool usage at scale.[^1][^20][^21] Strong productivity gains for human agents and higher FCR when deployed with good data.[^12][^28][^19] |
| Weaknesses | Susceptibility to hallucinations, brittleness on novel edge cases, orchestration complexity, and opaque reasoning across agent networks.[^7][^33][^26] Token and infrastructure cost volatility; dependency on vendor roadmaps.[^3][^14][^49] |
| Opportunities | Repositioning human teams toward high‑value work (relationship management, complex diagnostics), proactive support, and deep CRM data synchronization across go-to-market functions.[^48][^32][^38][^27] New business models based on outcome-based pricing and AI-driven customer success.[^31][^26] |
| Threats | Prompt injection, data exfiltration, model and context poisoning, systemic API failures cascading through agent webs, and reputational damage from incorrect or biased responses.[^15][^16][^17] Regulatory changes increasing requirements for disclosures and human access, potentially raising operational burdens.[^3][^32] |

### Detailed risk assessment

1. **Token runaway and infinite loops**  
   Multi-agent systems can accidentally trigger cycles (e.g., critic and generator agents repeatedly calling each other), leading to unbounded token consumption and latency. Controls include:[^44][^46][^45]
   - Hard limits on steps and tokens per interaction.
   - Graph-level acyclicity except where loops are explicitly bounded.
   - Watchdog agents or external monitors that terminate stuck executions.

2. **Stale context and data drift**  
   RAG systems and cached embeddings can become stale, leading to outdated policy or product answers. Mitigation strategies include scheduled re-ingestion, change-data-capture integration with source systems, and freshness-aware retrieval where recent documents are favored.[^48][^35]

3. **Escalation friction and "bot walls"**  
   Over-aggressive containment targets or poorly designed escalation UX can trap customers behind bots, increasing frustration and churn—a risk highlighted in survey-based customer care research. Best practice is to expose clear escape hatches, honor stated preferences for humans, and ensure escalations carry full context so customers do not need to repeat themselves.[^29][^32]

4. **Security and privacy violations**  
   OWASP’s LLM Top 10 and GenAI security projects document critical risks including prompt injection (LLM01), insecure output handling (LLM02), sensitive information disclosure (LLM06), excessive agency (LLM08), and memory/context poisoning in agentic systems. Guardrails must therefore include strong input/output validation, least-privilege tool scopes, PII redaction, and continuous red teaming.[^15][^16][^17]

5. **Liability and misrepresentation**  
   Incorrect policy statements, unauthorized refunds, and discriminatory outcomes can create legal exposure, especially in finance and healthcare. Organizations must clearly disclose AI usage, track provenance of answers (citations back to source docs), and maintain human accountability for high-impact decisions.[^32][^15]

## Compliance, Governance, & Security Standards

### Regulatory and standards landscape

Customer support AI operates at the intersection of data protection regulations (GDPR, CCPA), sector-specific rules (HIPAA, financial regulations), and emerging AI-specific laws in North America and Europe. Key themes relevant to agentic systems include:[^17][^32]

- **Data minimization and purpose limitation**: Restricting collection and retention of personal data and ensuring uses align with stated purposes.
- **Right to access a human and to contest automated decisions**: Increasingly codified in AI acts and consumer protection regulations, requiring explicit pathways to human review and clear disclosures of AI involvement.[^3][^32]
- **Security-by-design for AI systems**: Incorporating robust authentication, encryption, monitoring, and risk management into AI workflows.

Industry certifications such as SOC 2 and ISO 27001, and frameworks like the NIST AI Risk Management Framework, are being extended to cover AI workflows, while OWASP’s GenAI and LLM Top 10 provide concrete technical vulnerability taxonomies.[^16][^15][^17]

### OWASP LLM and Agentic security guidance

The OWASP Top 10 for Large Language Model Applications (v1.1 and 2024 updates) identifies ten categories of risk, several of which are especially relevant to multi-agent support stacks:[^15][^16]

- **LLM01 Prompt Injection**: Malicious user inputs attempt to override system prompts or exfiltrate data.
- **LLM02 Insecure Output Handling**: Downstream systems naively execute or display LLM outputs without validation.
- **LLM06 Sensitive Information Disclosure**: Models leak confidential data in responses.
- **LLM08 Excessive Agency**: Systems grant models too much autonomy to act, leading to unintended actions.

The newer OWASP GenAI Security project and its Agentic Applications crosswalk extend this to agent networks, emphasizing memory/context poisoning, unsafe plugin design, and the need for comprehensive DevSecOps around AI. These resources provide actionable controls such as:[^17]

- Sandboxing tools and enforcing strict schemas and guardrails for executable outputs.
- Implementing red-team exercises focused on agent chains (e.g., injection via RAG documents, compromised tools).
- Monitoring and rate-limiting agent actions at the platform layer.

### Governance patterns in vendor architectures

Enterprise architectures like Agentforce integrate governance by design: they use platform-native encryption (Salesforce Shield), fine-grained object permissions, and centralized logging of all agent actions for audit and troubleshooting. Forrester’s work on digital customer interaction solutions stresses the importance of vendor selection criteria around security certifications, data residency, and governance features for AI-driven contact centers. Combined with internal AI governance councils and RACI matrices, these ensure that AI initiatives are aligned with legal, trust, and safety requirements.[^40][^25][^19][^18][^10]

## Strategic Roadmap for Deployment

### Architecture sizing and tiering

Architecture recommendations differ for SMB and enterprise, but follow analogous maturity stages.

**SMB blueprint (platform-centric):**

- Use a CRM/CCaaS platform with deeply embedded AI agents (e.g., HubSpot Breeze, mid-market CCaaS with gen-AI bots and agent assist).[^30][^38][^20]
- Start with a single external Customer Agent that handles FAQ, simple account inquiries, and lead qualification, plus built-in knowledge base and help desk workspace.
- Gradually enable additional agents (Knowledge Base Agent, Customer Handoff Agent) to support documentation creation and smooth escalation.[^27][^20]
- Leverage platform dashboards to monitor containment, CSAT, and ticket backlog, making adjustments via configuration rather than custom code.

**Enterprise blueprint (decoupled, high governance):**

- Deploy a multi-layer architecture: channel adapters, orchestrator graph, shared context/memory layer, tool layer (APIs, RAG, workflow engines), and observability/security layer.[^41][^45][^18]
- Use frameworks like LangGraph or custom orchestration engines for deterministic workflow graphs; integrate with enterprise CRM/CCaaS (e.g., Salesforce Service Cloud with Agentforce) via event-driven connectors.[^6][^10][^22]
- Implement a comprehensive taxonomy of agents (triage, technical, billing, QA, analytics) with least-privilege tool access and fine-grained role definitions.
- Invest in an AI operations function (AIOps for support) to run experiments, manage prompts, and continuously improve based on metrics and logs.[^34][^22]

### Cost and ROI considerations

Market studies and case research show that AI agents can reduce cost per contact, increase FCR, and unlock revenue via better CX, but benefits vary widely by implementation quality. At the same time, Gartner-aligned analysis indicates that per-resolution AI costs may exceed offshore human agents by 2030 without cost controls and focused use cases. A pragmatic cost strategy includes:[^14][^28][^19][^31][^12][^3]

- Prioritizing high-volume, low-complexity intents for automation.
- Using smaller or optimized models for triage and KB retrieval, reserving large models for complex troubleshooting.
- Continuously tuning tools and prompts to minimize unnecessary tokens (e.g., reducing verbosity, avoiding extraneous agent-to-agent chatter).

### Implementation funnel: crawl → walk → run

A phased roadmap aligns technical risk with business value:

1. **Crawl: Internal shadow agents on historical tickets**  
   - Build an initial multi-agent graph with triage, knowledge, and drafting agents, but run it offline on past ticket logs.[^23][^7][^6]
   - Evaluate resolution quality, hallucination rates, and tool usage patterns using human scoring and automated metrics.
   - Implement security controls and governance while impact is limited.

2. **Walk: AI assist and simple external flows**  
   - Introduce AI as a co-pilot for human agents and as an external self-service bot for simple FAQs and order tracking.[^28][^20][^12]
   - Use human-in-the-loop review for all high-risk actions and monitor escalation patterns.
   - Begin segmenting intents into automation tiers based on observed performance.

3. **Run: Fully integrated multi-agent execution**  
   - Expand agents' authority to execute real-time data mutations (e.g., refunds within thresholds, entitlement changes) under strict policy and logging.[^19][^18]
   - Deploy additional specialist agents (loyalty, technical diagnostics, proactive outreach) and integrate with marketing and product telemetry.
   - Operate continuous improvement loops where QA agents, analytics agents, and human supervisors co-evolve prompts, tools, and workflows.[^7][^22][^34]

### Agent skills playbook and tool standards

For both SMB and enterprise, a clear "agent skills" playbook is essential. It should cover:

- **Tool definitions**: Each tool (API, workflow) has a JSON schema, preconditions, expected outputs, error types, and side-effect semantics.[^45][^6]
- **Access control**: Map tools to agent roles with least-privilege scopes; sensitive tools require multi-step approvals or secondary agents.[^15][^17]
- **Error handling**: Standard patterns for retries, fallbacks, and customer messaging when tools fail.
- **Logging and observability**: All tool invocations and agent decisions are logged with correlation IDs and made accessible to supervisors.

## Knowledge Gaps & Emergence to Monitor

Despite rapid progress, several areas remain under‑specified or in flux:

- **Standardized context tokens and schemas**: While practitioners propose portable context tokens for agent handoffs across platforms, there is no widely adopted open standard.[^43][^17]
- **Agent benchmarking and KPIs**: Beyond traditional contact center metrics, there is not yet consensus on standardized benchmarks for multi-agent support systems, though analyst firms are beginning to define interaction outcome metrics and automation value indices.[^4][^5][^48]
- **Regulatory clarity on autonomous actions**: Laws around automated decision-making in finance, healthcare, and telecom are evolving, and guidance on agent authority levels and audit trails is still emerging.[^32][^17]
- **Interoperability between vendor ecosystems**: Mechanisms like Agent2Agent and MCP-style protocols hint at cross-platform agent collaboration, but practices for secure, context-rich delegation across organizational boundaries are immature.[^10][^43][^17]
- **Robustness under adversarial conditions**: While OWASP and security vendors have documented attack patterns, systematically hardened architectures and red-team-tested patterns for large-scale multi-agent support systems remain an active area of work.[^16][^17][^15]

Addressing these gaps will be critical for organizations aiming to mature from early deployments to resilient, enterprise-wide agentic support ecosystems over the next two to three years.

---

## References

1. [Gartner Predicts that Agentic AI Will Solve 80 Percent of Customer ...](https://www.cxtoday.com/contact-center/agentic-ai-gartner-predicts-80-of-customer-problems-solved-without-human-help-by-2029/) - Gartner has predicted that agentic AI will autonomously resolve 80 percent of common customer servic...

2. [Gartner report: Human Agents + AI = Best Customer Service - LinkedIn](https://www.linkedin.com/posts/bradleybirnbaum_gartner-predicts-50-of-organizations-will-activity-7339101848483647488-hJdT) - Yesterday, Gartner issued a report titled: "Rehiring Human Agents to Replace AI is 2025's Latest Tre...

3. [AI in customer service: Not the cost-saver you think - CIO](https://www.cio.com/article/4130943/why-ai-is-not-a-cost-saving-model-in-customer-service.html) - Gartner acknowledges, however, that it will be some time before AI can sustainably improve the custo...

4. [The Tightrope Walkers: Conversational AI Must Bridge Modern AI ...](https://www.forrester.com/blogs/the-tightrope-walkers-conversational-ai-must-bridge-modern-ai-and-contact-center-reality/) - Learn how leading conversational AI vendors balance rapid innovation with trust and fit for contact ...

5. [Predictions 2026: AI Gets Real For Customer Service - Forrester](https://www.forrester.com/blogs/2026-the-year-ai-gets-real-for-customer-service-but-its-not-glamorous-work/) - Forrester predicts that 30% of enterprises will create parallel AI functions that mirror human servi...

6. [Multi-Agent AI Architectures for Automated Customer Service Management Systems](https://ijaibdcms.org/index.php/ijaibdcms/article/view/462/) - An increasing number of companies have recently adopted automated systems to manage their Customer S...

7. [Multi-Agent LLM Approach for Moderating E-Commerce Customer Service Responses](https://sol.sbc.org.br/index.php/webmedia/article/view/37979) - Language model (LLM)-based solutions have been widely adopted in automated customer service systems,...

8. [Large Language Models and Multi-Agent Systems for Customer Support Ticket Automation](https://ieeexplore.ieee.org/document/11304425/) - Customer service operations increasingly struggle to handle the rising volume and complexity of supp...

9. [AI to bring 'massive disruption' to contact center workforces ...](https://www.customerexperiencedive.com/news/ai-massive-disruption-contact-center-workforces/753737/) - Forrester expects AI agents will remake the customer service workforce as they begin to handle more ...

10. [Agentforce Multi-Agent Orchestration - Salesforce](https://www.salesforce.com/agentforce/multi-agent-orchestration/) - Multi-Agent Orchestration allows you to build a team of specialized AI agents that work collaborativ...

11. [Multi-Agent Orchestration](https://www.salesforce.com/ap/agentforce/multi-agent-orchestration/?bc=OTH) - Build a collaborative AI agent team that works together to solve complex problems faster. Learn more...

12. [Generative AI at Work](https://arxiv.org/pdf/2304.11771.pdf) - We study the staggered introduction of a generative AI-based conversational
assistant using data fro...

13. [Gen AI in customer care: Early successes and challenges](https://www.mckinsey.com/capabilities/operations/our-insights/gen-ai-in-customer-care-early-successes-and-challenges&rut=70359c5528bf5fef8d46aaad0c8527d7245a34c8bc9613fb12ece59d4e44f921) - Contact centers are ripe for transformation with gen AI. Organizations yet to get started can learn ...

14. [Gartner predicts AI agents in customer service could cost more than ...](https://www.facebook.com/CMSWire/posts/gartner-predicts-ai-agents-in-customer-service-could-cost-more-than-offshore-hum/1364942745676508/) - A Gartner report suggests that replacing human agents with AI chatbots in call centers could save up...

15. [OWASP Top 10 for Large Language Model Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) - OWASP Top 10 for Large Language Model Applications version 1.1 · LLM01: Prompt Injection · LLM02: In...

16. [What are the OWASP Top 10 risks for LLMs? - Cloudflare](https://www.cloudflare.com/learning/ai/owasp-top-10-risks-for-llms/) - Prompt injection · Insecure output handling · Training data poisoning · Model denial of service · Su...

17. [OWASP Gen AI Security Project: Home](https://genai.owasp.org) - The 2025 OWASP Top 10 for LLMs effectively debunks the misconception that securing GenAI is solely a...

18. [Multi-Layered Scalable Architecture Diagram for AI-Powered Agentforce Integration within Salesforce Enterprise Ecosystem](https://lorojournals.com/index.php/emsj/article/view/1421) - Agentforce represents a paradigm shift in enterprise customer relationship management through the de...

19. [AgentForce: Leveraging AI and Automation to Elevate Salesforce Service Agent Performance](https://ieeexplore.ieee.org/document/11379344/) - Artificial Intelligence and automation now change how Customer Relationship Management work, making ...

20. [HubSpot Launches New and Enhanced AI Agents, Plus Over 200 ...](https://ir.hubspot.com/news-releases/news-release-details/hubspot-launches-new-and-enhanced-ai-agents-plus-over-200) - Latest innovations help SMBs take advantage of AI efficiency across marketing, sales, and customer s...

21. [AI agents behind the scenes. - Salesforce](https://www.salesforce.com/news/stories/ai-agents-behind-the-scenes/) - Vivant Brings Agentforce to Customer Service Teams. Agentforce Brings Vivint Customer Service Teams ...

22. [How Minimal built a multi-agent customer support system with ...](https://www.langchain.com/blog/how-minimal-built-a-multi-agent-customer-support-system-with-langgraph-langsmith) - Learn how Minimal built a multi-agent AI system with LangGraph & LangSmith to automate 90% of e-comm...

23. [Bringing the State-of-the-Art to Customers: A Neural Agent Assistant
  Framework for Customer Service Support](https://arxiv.org/pdf/2302.03222.pdf) - Building Agent Assistants that can help improve customer service support
requires inputs from indust...

24. [The TRISEC framework for optimizing conversational agent design across search, experience and credence service contexts](https://www.emerald.com/insight/content/doi/10.1108/JOSM-10-2021-0402/full/pdf?title=the-trisec-framework-for-optimizing-conversational-agent-design-across-search-experience-and-credence-service-contexts) - PurposeService providers increasingly use conversational agents (CAs), such as chatbots, to effectiv...

25. [Introducing Forrester's Digital Customer Interaction Solutions ...](https://www.forrester.com/blogs/introducing-forresters-digital-customer-interaction-solutions-landscape/) - The Digital Customer Interaction Solutions Landscape, Q1 2024, report is now live, and a Forrester W...

26. [AI Agents: The autonomous workforce for automating workflows across industries](https://wjaets.com/node/850) - The emergence of AI agents represents a transformative milestone in artificial intelligence developm...

27. [Build your AI team with over 20 Breeze Agents and Assistants, plus ...](https://www.hubspot.com/company-news/build-your-ai-team) - Serves as your AI concierge for every GTM team, answering questions, qualifying leads, and resolving...

28. [Gen AI in customer care: Early successes and challenges - McKinsey](https://www.mckinsey.com/capabilities/operations/our-insights/gen-ai-in-customer-care-early-successes-and-challenges) - Contact centers are ripe for transformation with gen AI. Organizations yet to get started can learn ...

29. [Where is customer care in 2024?](https://www.mckinsey.com.br/en/capabilities/operations/our-insights/where-is-customer-care-in-2024) - Customer care organizations need to shift their approach to better serve the people who contact them...

30. [AI Customer Agent for Lead Gen & Ticket Resolution | HubSpot](https://www.hubspot.com/products/artificial-intelligence/ai-customer-service-agent) - Scale your go-to-market motion with HubSpot's AI Customer Agent. Qualify leads, answer sales questio...

31. [The Economic Value of AI-Augmented Case Management: A Multi-firm Study of Salesforce Service Cloud](https://gbej.org/articles/the-economic-value-of-ai-augmented-case-management-a-multi-firm-study-of-salesforce-service-cloud/) - As artificial intelligence (AI) becomes increasingly integrated into customer relationship managemen...

32. [Where is customer care in 2024? | McKinsey.org](https://www.mckinsey.org/capabilities/operations/our-insights/where-is-customer-care-in-2024) - Customer care organizations need to shift their approach to better serve the people who contact them...

33. [Using multi-agent architecture to mitigate the risk of LLM hallucinations](https://arxiv.org/abs/2507.01446) - Improving customer service quality and response time are critical factors for maintaining customer l...

34. [How to Continuously Improve Your LangGraph Multi-Agent System](https://galileo.ai/blog/evaluate-langgraph-multi-agent-telecom) - A step by step process to continuously improve langgraph agents in production.

35. [A Study on the Implementation Method of an Agent-Based Advanced RAG
  System Using Graph](http://arxiv.org/pdf/2407.19994.pdf) - ...contextual understanding and biased information. To address these
limitations, this study impleme...

36. [A System for Human-AI collaboration for Online Customer Support](https://arxiv.org/pdf/2301.12158.pdf) - AI enabled chat bots have recently been put to use to answer customer service
queries, however it is...

37. [How Interaction Mechanism and Error Responses Influence Users’ Responses to Customer Service Chatbots](https://www.tandfonline.com/doi/pdf/10.1080/10447318.2024.2351707?needAccess=true)

38. [Beyond CRM: HubSpot's Bold 2025 Vision for AI-Driven Customer ...](https://www.newbreedrevenue.com/blog/hubspot-2025-spotlight) - HubSpot's 2025 AI vision: Fast, easy & unified customer success. Explore AI agents, smart workspaces...

39. [Breeze Customer Agent | HubSpot Spotlight Fall 2025 - YouTube](https://www.youtube.com/watch?v=cxeK4Sb7TaE) - A concierge for your customers. *Support every stage of your customer journey with one AI agent:* .....

40. [The Forrester Wave™: CCaaS, Q2 2025 Report - Genesys](https://www.genesys.com/resources/the-forrester-wave-contact-center-as-a-service) - Genesys is recognized as Leader in The Forrester Wave™: Contact Center As A Service, Q2 2025 Report....

41. [Event-Driven Architecture for Customer Engagement Automation and Secure Multi-Cloud Data Exchange in Salesforce.](https://theamericanjournals.com/index.php/tajet/article/view/7155/6542) - Event-driven architecture constitutes a software design paradigm through which systems establish com...

42. [Agentforce | Fundamentals | Salesforce Developers](https://architect.salesforce.com/docs/architect/fundamentals/guide/get-started-agentforce.html) - Enterprise Agentic Architecture and Design Patterns brings structure to multi-agent architectures us...

43. [How to design a Multi-Agent architecture for Salesforce Agentforce ...](https://www.linkedin.com/posts/gauravkheterpal_agentforce-salesforce-aiagents-activity-7348991248105422848-m1P3) - What does an ideal Multi-Agent architecture look like for Salesforce Agentforce when coupled with A2...

44. [Exploration of LLM Multi-Agent Application Implementation Based on
  LangGraph+CrewAI](https://arxiv.org/pdf/2411.18241.pdf) - ...through intelligent task allocation and resource management. The
main research contents of this p...

45. [Empirical Research on Utilizing LLM-based Agents for Automated Bug
  Fixing via LangGraph](https://arxiv.org/pdf/2502.18465.pdf) - ...designed to improve accuracy, efficiency, and scalability in
software development. The proposed s...

46. [CrewAI Multi-Agent AI Teams: Complete Guide with Memory - Mem0](https://mem0.ai/blog/crewai-guide-multi-agent-ai-teams) - Learn how to build multi-agent AI teams with CrewAI and add persistent memory with Mem0. Step-by-ste...

47. [McKinsey Direct](https://www.mckinsey.com/~/media/mckinsey/business%20functions/operations/our%20insights/gen%20ai%20in%20customer%20care%20early%20successes%20and%20challenges/gen-ai-in-customer-care-early-successes-and-challenges.pdf?shouldIndex=false)

48. [Generative AI is The Catalyst for Change in The Contact Center](https://tactful.ai/blog/takeaways-forrester-report-generative-ai-contact-center) - Key takeaways from Forrester's report on how generative AI is transforming contact centers, covering...

49. [Best Multi-Agent Frameworks in 2026 - GuruSup](https://gurusup.com/blog/best-multi-agent-frameworks-2026) - Compare the 6 leading multi-agent frameworks: OpenAI Agents SDK, LangGraph, CrewAI, AutoGen/AG2, Goo...

