-- Backfill level labels from questions.json data
-- Run AFTER migration 003
-- This is a one-time data migration, safe to re-run

UPDATE topics SET
  level_1_label = 'Data is siloed, inconsistent, and often manually managed with no quality checks.',
  level_2_label = 'Some clean data exists but accessibility and cataloguing are limited.',
  level_3_label = 'Key data assets are governed, catalogued, and accessible to project teams.',
  level_4_label = 'Automated quality checks and pipelines ensure reliable data across the organization.',
  level_5_label = 'Data is democratized, real-time, and continuously optimized for AI workloads.'
WHERE topic_key = 'data-quality-availability';

UPDATE topics SET
  level_1_label = 'Legacy on-premise systems with manual ETL and no scalability.',
  level_2_label = 'Basic cloud or hybrid setup; limited automation in data pipelines.',
  level_3_label = 'Scalable cloud data platform with automated ingestion and processing.',
  level_4_label = 'Modern lakehouse architecture with streaming and batch capabilities.',
  level_5_label = 'Fully automated, event-driven data mesh with self-serve access.'
WHERE topic_key = 'data-infrastructure';

UPDATE topics SET
  level_1_label = 'No formal data governance; ownership and policies are undefined.',
  level_2_label = 'Informal ownership exists for some datasets; policies are ad-hoc.',
  level_3_label = 'Formal governance council with defined owners and documented policies.',
  level_4_label = 'Governance is embedded in workflows with automated compliance checks.',
  level_5_label = 'Organization-wide data governance drives strategic decision-making.'
WHERE topic_key = 'data-governance-framework';

UPDATE topics SET
  level_1_label = 'Reporting is manual, spreadsheet-based, and backward-looking only.',
  level_2_label = 'Basic BI dashboards provide descriptive analytics for some functions.',
  level_3_label = 'Diagnostic and trend analytics are used across key business areas.',
  level_4_label = 'Predictive models are operationalized and inform business decisions.',
  level_5_label = 'Prescriptive analytics and AI-driven insights are embedded enterprise-wide.'
WHERE topic_key = 'data-analytics-capabilities';

UPDATE topics SET
  level_1_label = 'No dedicated AI/ML talent; reliance on external vendors for all efforts.',
  level_2_label = 'A few individuals have AI skills but no formal team or career path.',
  level_3_label = 'A dedicated data science team delivers projects with defined methodologies.',
  level_4_label = 'Cross-functional AI teams with MLOps, research, and engineering capabilities.',
  level_5_label = 'World-class AI talent embedded across the organization with continuous upskilling.'
WHERE topic_key = 'ai-ml-expertise';

UPDATE topics SET
  level_1_label = 'No AI-specific tools or platforms; experiments use ad-hoc scripts.',
  level_2_label = 'Basic ML frameworks in use; no standardized platform or MLOps tooling.',
  level_3_label = 'Standardized AI platform with experiment tracking and model registry.',
  level_4_label = 'End-to-end MLOps pipeline with CI/CD, monitoring, and automated retraining.',
  level_5_label = 'Cutting-edge platform with AutoML, feature stores, and real-time serving.'
WHERE topic_key = 'technology-stack';

UPDATE topics SET
  level_1_label = 'No training programs; employees learn informally on their own time.',
  level_2_label = 'Occasional workshops or external courses available but not tracked.',
  level_3_label = 'Structured learning paths and certifications for key roles.',
  level_4_label = 'Comprehensive AI academy with role-based curricula and hands-on labs.',
  level_5_label = 'Continuous learning culture with AI literacy programs for all employees.'
WHERE topic_key = 'training-opportunities';

UPDATE topics SET
  level_1_label = 'No process for evaluating or adopting AI innovations.',
  level_2_label = 'Innovation is sporadic; pilots rarely move beyond proof-of-concept.',
  level_3_label = 'Structured innovation process with stage-gate evaluation of AI pilots.',
  level_4_label = 'Innovation lab with fast prototyping and clear paths to production.',
  level_5_label = 'Innovation is embedded in culture with systematic horizon scanning.'
WHERE topic_key = 'innovation-adoption';

UPDATE topics SET
  level_1_label = 'AI initiatives are disconnected from business strategy and pursued in isolation.',
  level_2_label = 'Some AI projects align with strategic objectives, but efforts remain fragmented.',
  level_3_label = 'AI initiatives are systematically aligned with business goals and key functions.',
  level_4_label = 'AI strategy is integrated with overall business strategy and drives measurable outcomes.',
  level_5_label = 'AI is a core enabler of business strategy and creates competitive advantage.'
WHERE topic_key = 'ai-strategy-alignment';

UPDATE topics SET
  level_1_label = 'No executive ownership; AI efforts are ad-hoc and unsupported.',
  level_2_label = 'A few leaders sponsor isolated initiatives without consistent governance.',
  level_3_label = 'Clear executive sponsorship exists with defined goals and accountability.',
  level_4_label = 'Leadership actively steers AI portfolio with KPIs and cross-functional alignment.',
  level_5_label = 'Executives champion AI as a strategic capability and continuously invest to scale impact.'
WHERE topic_key = 'leadership-sponsorship';

UPDATE topics SET
  level_1_label = 'No change management; AI projects create confusion and resistance.',
  level_2_label = 'Basic communication about AI projects but no structured change process.',
  level_3_label = 'Change management plans accompany major AI initiatives with stakeholder engagement.',
  level_4_label = 'Dedicated change team manages adoption, training, and impact assessment.',
  level_5_label = 'Change agility is a core competency; organization adapts fluidly to AI-driven transformation.'
WHERE topic_key = 'change-management';

UPDATE topics SET
  level_1_label = 'No AI roadmap; initiatives are reactive and uncoordinated.',
  level_2_label = 'Informal list of AI ideas without prioritization or resource planning.',
  level_3_label = 'Documented AI roadmap with prioritized initiatives and milestones.',
  level_4_label = 'Multi-year AI investment plan with portfolio management and governance.',
  level_5_label = 'Dynamic AI roadmap continuously updated based on outcomes and market signals.'
WHERE topic_key = 'roadmap-planning';

UPDATE topics SET
  level_1_label = 'No AI governance; decisions are made ad-hoc without oversight.',
  level_2_label = 'Basic guidelines exist but are not enforced or widely known.',
  level_3_label = 'Formal governance framework with clear roles, policies, and review boards.',
  level_4_label = 'Governance is embedded in AI lifecycle with automated compliance gates.',
  level_5_label = 'Best-in-class governance that balances innovation speed with risk management.'
WHERE topic_key = 'governance-framework';

UPDATE topics SET
  level_1_label = 'No awareness of AI ethics; bias and fairness are not considered.',
  level_2_label = 'Informal awareness but no documented guidelines or review process.',
  level_3_label = 'Published AI ethics principles with bias testing for high-risk models.',
  level_4_label = 'Ethics review board evaluates models pre-deployment with fairness metrics.',
  level_5_label = 'Ethics-by-design approach with continuous monitoring and external auditing.'
WHERE topic_key = 'ethical-issues';

UPDATE topics SET
  level_1_label = 'AI risks are not identified, tracked, or mitigated.',
  level_2_label = 'Some risks are recognized but management is reactive and inconsistent.',
  level_3_label = 'Risk assessment is part of AI project planning with defined mitigation steps.',
  level_4_label = 'Enterprise AI risk register with quantified impact and automated monitoring.',
  level_5_label = 'Proactive risk intelligence informs AI strategy and investment decisions.'
WHERE topic_key = 'risk-management';

UPDATE topics SET
  level_1_label = 'No awareness of AI-related regulations or industry standards.',
  level_2_label = 'Basic awareness but no formal compliance program or documentation.',
  level_3_label = 'Compliance requirements are documented and tracked for AI systems.',
  level_4_label = 'Automated compliance checks integrated into the AI development lifecycle.',
  level_5_label = 'Proactive regulatory engagement with industry-leading standards adoption.'
WHERE topic_key = 'compliance-standards';

UPDATE topics SET
  level_1_label = 'No systematic process for identifying AI opportunities.',
  level_2_label = 'Ad-hoc ideas collected but no structured evaluation or prioritization.',
  level_3_label = 'Use case pipeline with business impact scoring and feasibility analysis.',
  level_4_label = 'Portfolio approach with strategic alignment, ROI estimation, and stage-gating.',
  level_5_label = 'AI opportunity radar with continuous scanning and rapid validation.'
WHERE topic_key = 'use-cases';

UPDATE topics SET
  level_1_label = 'AI ROI is never measured or discussed.',
  level_2_label = 'Anecdotal success stories but no formal metrics or tracking.',
  level_3_label = 'KPIs defined for AI projects with periodic ROI reviews.',
  level_4_label = 'Standardized value measurement framework across all AI initiatives.',
  level_5_label = 'Real-time value dashboards with attribution modeling and impact analytics.'
WHERE topic_key = 'roi-measurement';

UPDATE topics SET
  level_1_label = 'Business stakeholders are uninvolved; AI is purely a technical exercise.',
  level_2_label = 'Stakeholders are consulted occasionally but not actively engaged.',
  level_3_label = 'Business owners co-design AI solutions and validate outcomes.',
  level_4_label = 'Cross-functional teams with embedded business and AI expertise.',
  level_5_label = 'Stakeholders champion AI adoption and drive demand for new capabilities.'
WHERE topic_key = 'stakeholder-engagement';

UPDATE topics SET
  level_1_label = 'No AI solutions in production; all efforts are experimental.',
  level_2_label = 'One or two pilots running but none scaled to production impact.',
  level_3_label = 'Several AI solutions in production delivering measurable business value.',
  level_4_label = 'AI solutions are core to key business processes with continuous improvement.',
  level_5_label = 'AI-native products and services generate significant competitive advantage.'
WHERE topic_key = 'ai-solutions';

UPDATE topics SET
  level_1_label = 'No dedicated AI/ML platform; teams use disparate tools and scripts.',
  level_2_label = 'Basic ML framework adoption but no shared platform or standards.',
  level_3_label = 'Centralized ML platform with experiment tracking and shared resources.',
  level_4_label = 'Enterprise-grade platform with AutoML, feature stores, and model serving.',
  level_5_label = 'Best-in-class AI platform with real-time inference and continuous learning.'
WHERE topic_key = 'ai-ml-platforms';

UPDATE topics SET
  level_1_label = 'Infrastructure is legacy, on-premise, and unsuited for AI workloads.',
  level_2_label = 'Some cloud usage but infrastructure lacks scalability for AI.',
  level_3_label = 'Hybrid or cloud setup supports basic model training and deployment.',
  level_4_label = 'Scalable MLOps infrastructure is in place for efficient model lifecycle.',
  level_5_label = 'Fully automated, serverless, and optimized for AI at scale.'
WHERE topic_key = 'cloud-infrastructure';

UPDATE topics SET
  level_1_label = 'AI outputs are copy-pasted manually; no system integration.',
  level_2_label = 'Basic API integration for a few use cases; mostly point-to-point.',
  level_3_label = 'Standard integration patterns with APIs and event-driven architecture.',
  level_4_label = 'AI services are composable microservices integrated into core platforms.',
  level_5_label = 'Seamless AI-native integration across the entire digital ecosystem.'
WHERE topic_key = 'integration-capabilities';

UPDATE topics SET
  level_1_label = 'No AI-specific security measures; models and data are unprotected.',
  level_2_label = 'Basic access controls but no adversarial testing or privacy measures.',
  level_3_label = 'Security reviews for AI systems with data privacy impact assessments.',
  level_4_label = 'Automated vulnerability scanning for models with differential privacy.',
  level_5_label = 'Zero-trust AI security with federated learning and privacy-preserving AI.'
WHERE topic_key = 'security-privacy';
