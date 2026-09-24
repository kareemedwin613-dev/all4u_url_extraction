# Active original resume tagging — completed

Verified in production at 2026-09-23T07:49:32.733Z.

Reviewed 44 active original resumes: 43 updated, 1 unchanged. Every resulting primary/subtype assignment and original-content hash was checked after commit, with zero mismatches. The update transaction asserted that no non-tag resume fields changed (apart from the normal updated timestamp).

Archived resumes, existing tailored copies, JD records and applications were not targeted. Existing tailored copies retain their prior snapshot tags; new tailored copies inherit the original's current tags through the existing insert trigger.

## Classification approach

- Multiple primary categories require relevant original-resume experience; AI-assisted coding alone does not create AI/ML eligibility.
- Only Software Engineering receives technology subtypes. Non-SE subtype rows and generic Backend/Frontend/Full Stack role tags were removed from these originals.
- This is classification of the submitted original resumes, not independent verification of their employment or project claims.
- Eric Zheng: Software Engineering + AI and Machine Learning; .NET Engineering + Python Engineering.
- Andrew Thomas has React/TypeScript/Node experience, but the current taxonomy has no JavaScript/TypeScript technology subtype. Software Engineering is retained without a generic role tag.
- Brian Schillaci's original describes software/data engineering but does not name a programming stack; no technology subtype was invented.
- Taxonomy entries were not created, renamed, or retired globally.

## Resulting categories

Counts overlap because resumes can have multiple primaries.

- Data Engineering: 19
- Business Intelligence and Analytics: 10
- Software Engineering: 33
- AI and Machine Learning: 21
- Cloud, DevOps and Reliability: 6
- Cybersecurity: 1

## Per-resume results

| Resume # | Candidate | Primary categories | Software Engineering subtypes | Result |
| --- | --- | --- | --- | --- |
| 2 | Bradley Anderson | Data Engineering; Business Intelligence and Analytics | — | Updated |
| 8 | Brian Rose | Software Engineering | .NET Engineering | Updated |
| 9 | Joseph Melberg | Software Engineering; AI and Machine Learning; Cloud, DevOps and Reliability | .NET Engineering; Java Engineering | Updated |
| 10 | Corbin Woods | Software Engineering; AI and Machine Learning | Java Engineering; Python Engineering; .NET Engineering | Updated |
| 11 | Derek Myers | Data Engineering; Business Intelligence and Analytics | — | Updated |
| 12 | Joseph Fontana | Software Engineering | Java Engineering; .NET Engineering | Updated |
| 13 | Devin Belden | AI and Machine Learning; Software Engineering; Business Intelligence and Analytics | Python Engineering | Updated |
| 15 | Katelyn Farmwald | Data Engineering; Business Intelligence and Analytics | — | Updated |
| 16 | Erika Deissler | Software Engineering | Java Engineering | Updated |
| 17 | Demarcus Johnson | Software Engineering | Java Engineering; Python Engineering | Updated |
| 19 | Jurgia Sanchez | Software Engineering; AI and Machine Learning | Java Engineering; .NET Engineering | Updated |
| 20 | Marko Krsikapa | Software Engineering; AI and Machine Learning; Cloud, DevOps and Reliability | Golang Engineering; Python Engineering | Updated |
| 21 | Alexander Clark | Cloud, DevOps and Reliability; Software Engineering | Java Engineering | Updated |
| 22 | Eric Zheng | Software Engineering; AI and Machine Learning | .NET Engineering; Python Engineering | Updated |
| 23 | Michael Walker | Data Engineering; AI and Machine Learning; Software Engineering; Business Intelligence and Analytics | Python Engineering | Updated |
| 24 | William Young | Data Engineering | — | Updated |
| 25 | Jacob Waller | Software Engineering; Cloud, DevOps and Reliability | Ruby on Rails Engineering | Updated |
| 26 | Joseph Martinez | Software Engineering; AI and Machine Learning | .NET Engineering | Updated |
| 27 | Mohammed Uddin | AI and Machine Learning; Data Engineering; Software Engineering; Business Intelligence and Analytics | Python Engineering | Updated |
| 33 | Andrew Thomas | Software Engineering | — | Updated |
| 34 | Eddie Reveles | Software Engineering | .NET Engineering | Updated |
| 35 | Luke Lopez | Data Engineering; AI and Machine Learning | — | Updated |
| 36 | Christopher Stewart | Data Engineering; Software Engineering | Java Engineering | Updated |
| 37 | Joshua Owens | Software Engineering; AI and Machine Learning | Python Engineering | Updated |
| 38 | Jason Miller | Software Engineering | .NET Engineering; Ruby on Rails Engineering; Golang Engineering; Python Engineering | Updated |
| 39 | Derek Williams | Software Engineering; AI and Machine Learning; Data Engineering | Python Engineering; Java Engineering | Updated |
| 40 | Garrett Newman | Software Engineering; Data Engineering | .NET Engineering; Python Engineering | Updated |
| 41 | Nicholas Smith | AI and Machine Learning; Software Engineering; Data Engineering | Python Engineering | Updated |
| 43 | Todd Phillips | Software Engineering; AI and Machine Learning | Python Engineering; .NET Engineering; Java Engineering; Golang Engineering | Updated |
| 45 | Jared Ratto | Business Intelligence and Analytics; AI and Machine Learning; Data Engineering | — | Updated |
| 46 | Hannah Gallagher | Software Engineering; AI and Machine Learning | Python Engineering | Updated |
| 48 | Consuelo Mejia | Software Engineering; AI and Machine Learning | Python Engineering; .NET Engineering | Updated |
| 11296 | Brian Schillaci | Data Engineering; Software Engineering | — | Updated |
| 11299 | Freddy Criollo | Data Engineering | — | Updated |
| 12605 | Avi Patel | Data Engineering; Business Intelligence and Analytics | — | Unchanged |
| 12608 | Brian Jones | Data Engineering; Software Engineering | .NET Engineering | Updated |
| 12625 | Terry Lewis | Data Engineering | — | Updated |
| 12671 | Matan Diamond | AI and Machine Learning; Software Engineering | Python Engineering; Java Engineering; Ruby on Rails Engineering | Updated |
| 12692 | James Harkrader | AI and Machine Learning; Business Intelligence and Analytics | — | Updated |
| 14087 | Pushpalatha Ongolu | Software Engineering | Java Engineering | Updated |
| 14426 | Syed Hammadul Haque | AI and Machine Learning; Data Engineering; Software Engineering | Python Engineering | Updated |
| 16914 | Brooke Jones | Cloud, DevOps and Reliability; Cybersecurity; Software Engineering | Java Engineering | Updated |
| 20816 | Ryan Alman | AI and Machine Learning; Business Intelligence and Analytics; Data Engineering | — | Updated |
| 20817 | David Alden | Cloud, DevOps and Reliability; Software Engineering | Python Engineering; Java Engineering | Updated |

## Review notes

### Bradley Anderson (#2)

- Before: Data Engineering / AWS Data Engineering; Business Intelligence and Analytics
- After: Data Engineering; Business Intelligence and Analytics
- Basis: Data-platform/ETL ownership plus earlier BI dashboards and geospatial analytics. AI data preparation alone is not AI engineering.

### Brian Rose (#8)

- Before: Software Engineering / .NET Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; Software subtypes: .NET Engineering
- Basis: Repeated production C#/ASP.NET application delivery. Java appears in skills but not demonstrated project ownership; AI coding tools and application CI/CD do not establish separate AI/DevOps careers.

### Joseph Melberg (#9)

- Before: Software Engineering / Full-Stack/AI Engineering; Software Engineering / .NET Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; AI and Machine Learning; Cloud, DevOps and Reliability; Software subtypes: .NET Engineering, Java Engineering
- Basis: Production .NET generative-AI claims pipelines, Semantic Kernel, RAG/evals; IoT platform autoscaling/SLO/on-call operations; Java17/Spring Boot explicitly listed as backend skills.

### Corbin Woods (#10)

- Before: Software Engineering / Full-Stack/AI Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; AI and Machine Learning; Software subtypes: Java Engineering, Python Engineering, .NET Engineering
- Basis: Spring Boot and ASP.NET backend expertise; BERT/PyTorch models, SageMaker/MLOps and production RAG.

### Derek Myers (#11)

- Before: Data Engineering / Databricks; Business Intelligence and Analytics
- After: Data Engineering; Business Intelligence and Analytics
- Basis: Healthcare claims lakehouse/ETL and operational BI/reporting. ML-ready datasets do not by themselves establish AI engineering.

### Joseph Fontana (#12)

- Before: Software Engineering / Java Engineering; Software Engineering / .NET Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; Software subtypes: Java Engineering, .NET Engineering
- Basis: Repeated Java/C# enterprise application and web-service delivery; AI-assisted coding alone does not support AI primary.

### Devin Belden (#13)

- Before: AI and Machine Learning; Business Intelligence and Analytics
- After: AI and Machine Learning; Software Engineering; Business Intelligence and Analytics; Software subtypes: Python Engineering
- Basis: Predictive models in scikit-learn, Python test automation/SDET and BI/dashboard delivery.

### Katelyn Farmwald (#15)

- Before: Data Engineering / Databricks; Business Intelligence and Analytics
- After: Data Engineering; Business Intelligence and Analytics
- Basis: Azure/Databricks lakehouses, data integration and BI; AI-ready data alone is not model/AI-product engineering.

### Erika Deissler (#16)

- Before: Software Engineering / Java Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; Software subtypes: Java Engineering
- Basis: Java/Spring Boot and full-stack application architecture; no separate AI/ML responsibilities established.

### Demarcus Johnson (#17)

- Before: Software Engineering / Java Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; Software subtypes: Java Engineering, Python Engineering
- Basis: Java/Spring Boot production services and Python/Django Robinhood onboarding; other languages only in a broad skills list.

### Jurgia Sanchez (#19)

- Before: Software Engineering / Java Engineering; Software Engineering / Full-Stack/AI Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; AI and Machine Learning; Software subtypes: Java Engineering, .NET Engineering
- Basis: Java/Kotlin and earlier C#/ASP.NET delivery; production Bedrock/Claude RAG and agentic case triage.

### Marko Krsikapa (#20)

- Before: Software Engineering / Golang Engineering; Software Engineering / Python Engineering; Software Engineering / Full-Stack/AI Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering; Cloud, DevOps and Reliability / Site Reliability Engineering; Cloud, DevOps and Reliability / Platform Engineering
- After: Software Engineering; AI and Machine Learning; Cloud, DevOps and Reliability; Software subtypes: Golang Engineering, Python Engineering
- Basis: Go/Python AI SDLC orchestration and RAG; global scheduling platform, multi-region recovery and SLO ownership.

### Alexander Clark (#21)

- Before: Cloud, DevOps and Reliability
- After: Cloud, DevOps and Reliability; Software Engineering; Software subtypes: Java Engineering
- Basis: Multiple dedicated DevOps roles with Terraform/Kubernetes/GitOps; earlier Java/Spring Boot software engineering.

### Eric Zheng (#22)

- Before: AI and Machine Learning; Software Engineering / Full-Stack/AI Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; AI and Machine Learning; Software subtypes: .NET Engineering, Python Engineering
- Basis: Production C#/.NET services and Python/FastAPI; Bloomberg LLM fine-tuning, summarization, evaluation and agentic workflows.

### Michael Walker (#23)

- Before: Data Engineering; Business Intelligence and Analytics
- After: Data Engineering; AI and Machine Learning; Software Engineering; Business Intelligence and Analytics; Software subtypes: Python Engineering
- Basis: Production lakehouse/streaming and Gemini document extraction; earlier software engineer API/dashboard delivery and Python ETL; customer usage reporting and product analytics.

### William Young (#24)

- Before: Data Engineering; Business Intelligence and Analytics
- After: Data Engineering
- Basis: Spark/Databricks platforms and feature/training datasets; AI enablement infrastructure rather than demonstrated model or AI application development.

### Jacob Waller (#25)

- Before: Cloud, DevOps and Reliability
- After: Software Engineering; Cloud, DevOps and Reliability; Software subtypes: Ruby on Rails Engineering
- Basis: Lead Rails development and dedicated deployment/platform reliability automation. Copilot/Cursor usage alone is not AI engineering.

### Joseph Martinez (#26)

- Before: Software Engineering / .NET Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; AI and Machine Learning; Software subtypes: .NET Engineering
- Basis: C#/ASP.NET enterprise modernization with internal LLM/RAG knowledge retrieval and agentic workflow integration.

### Mohammed Uddin (#27)

- Before: AI and Machine Learning
- After: AI and Machine Learning; Data Engineering; Software Engineering; Business Intelligence and Analytics; Software subtypes: Python Engineering
- Basis: Production ML/LLM platforms, Python FastAPI/Flask serving, Spark/Kafka data pipelines and analytics/dashboard experience.

### Andrew Thomas (#33)

- Before: Software Engineering / Full Stack Engineering; Software Engineering / Frontend Engineering
- After: Software Engineering
- Basis: React/TypeScript/Node full-stack delivery. No language-specific JavaScript/TypeScript subtype exists; excluded generic role tags.

### Eddie Reveles (#34)

- Before: Software Engineering / .NET Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; Software subtypes: .NET Engineering
- Basis: C#/.NET healthcare/defense software modernization; AI-assisted coding tools do not establish a distinct AI engineering background.

### Luke Lopez (#35)

- Before: Data Engineering; Business Intelligence and Analytics
- After: Data Engineering; AI and Machine Learning
- Basis: Databricks/PySpark lakehouse ownership plus Azure OpenAI, Azure AI Search, vector embeddings and MLflow search/recommendation pipelines, beyond generic ML dataset preparation.

### Christopher Stewart (#36)

- Before: Data Engineering / Databricks; Business Intelligence and Analytics
- After: Data Engineering; Software Engineering; Software subtypes: Java Engineering
- Basis: Staff data engineering plus earlier Accenture production Java/Spring Boot applications and REST services. Python data processing is not separately treated as Python web/backend expertise.

### Joshua Owens (#37)

- Before: Software Engineering / Full-Stack/AI Engineering; Software Engineering / Python Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; AI and Machine Learning; Software subtypes: Python Engineering
- Basis: Python/FastAPI full-stack enterprise RAG platform, multi-provider LLM orchestration and automated evaluation.

### Jason Miller (#38)

- Before: Software Engineering / .NET Engineering; Software Engineering / Ruby on Rails Engineering; Software Engineering / Golang Engineering; Software Engineering / Python Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; Software subtypes: .NET Engineering, Ruby on Rails Engineering, Golang Engineering, Python Engineering
- Basis: Production C#/Go telehealth services, Ruby on Rails/FHIR healthcare interoperability, and Python backend workflow automation.

### Derek Williams (#39)

- Before: Software Engineering / Full-Stack/AI Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; AI and Machine Learning; Data Engineering; Software subtypes: Python Engineering, Java Engineering
- Basis: Python/FastAPI RAG and agentic AI; Java/Spring backend services and cloud distributed data-processing platforms.

### Garrett Newman (#40)

- Before: Software Engineering / .NET Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; Data Engineering; Software subtypes: .NET Engineering, Python Engineering
- Basis: C#/Node enterprise services and production Python/Kafka intelligence-ingestion pipelines; security product development alone is not a general cybersecurity category.

### Nicholas Smith (#41)

- Before: AI and Machine Learning
- After: AI and Machine Learning; Software Engineering; Data Engineering; Software subtypes: Python Engineering
- Basis: Python/FastAPI enterprise RAG/NLP and ML-serving services with substantial Spark data engineering.

### Todd Phillips (#43)

- Before: Software Engineering / Full-Stack/AI Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; AI and Machine Learning; Software subtypes: Python Engineering, .NET Engineering, Java Engineering, Golang Engineering
- Basis: Python/LangGraph production agents, .NET enterprise modernization and Java/Go cloud management application delivery. Cloud-management product work is not assumed to be a separate DevOps role.

### Jared Ratto (#45)

- Before: Business Intelligence and Analytics
- After: Business Intelligence and Analytics; AI and Machine Learning; Data Engineering
- Basis: Data analyst/scientist predictive pricing and optimization models, BI reporting and ETL delivery.

### Hannah Gallagher (#46)

- Before: AI and Machine Learning
- After: Software Engineering; AI and Machine Learning; Software subtypes: Python Engineering
- Basis: Python backend services and LLM code-evaluation frameworks. Golang appears only in skills, without enough project detail to add that specialty.

### Consuelo Mejia (#48)

- Before: Software Engineering / Python Engineering; Software Engineering / Full Stack Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; AI and Machine Learning; Software subtypes: Python Engineering, .NET Engineering
- Basis: Python/Django and earlier C#/ASP.NET applications; Python coding-agent orchestration and production ML service integration with controlled evaluation/rollout.

### Brian Schillaci (#11296)

- Before: Data Engineering; Business Intelligence and Analytics
- After: Data Engineering; Software Engineering
- Basis: Career progression from software engineer building web applications to senior data engineer; no explicit programming language evidence to invent technology tags.

### Freddy Criollo (#11299)

- Before: Data Engineering / ETL and Data Warehousing; Business Intelligence and Analytics
- After: Data Engineering
- Basis: Dedicated data engineering roles, Python/Spark/AWS ETL, CDC and dimensional modeling.

### Avi Patel (#12605)

- Before: Data Engineering; Business Intelligence and Analytics
- After: Data Engineering; Business Intelligence and Analytics
- Basis: Enterprise ETL/DataStage, analytical modeling and Python analytics. TensorFlow mentioned without model ownership, so no AI primary.

### Brian Jones (#12608)

- Before: Data Engineering / Databricks; Business Intelligence and Analytics
- After: Data Engineering; Software Engineering; Software subtypes: .NET Engineering
- Basis: Big-data ETL/Java/Spark pipeline ownership plus explicitly built ASP.NET Core dashboard. No Java application framework beyond data processing was established.

### Terry Lewis (#12625)

- Before: Data Engineering; Business Intelligence and Analytics
- After: Data Engineering
- Basis: Dedicated Shipt data engineering progression; Java/Python production data pipelines, not standalone backend-product experience.

### Matan Diamond (#12671)

- Before: AI and Machine Learning
- After: AI and Machine Learning; Software Engineering; Software subtypes: Python Engineering, Java Engineering, Ruby on Rails Engineering
- Basis: Production recommender/ranking ML plus explicit Spring Boot/Spring Security and Ruby on Rails backend work.

### James Harkrader (#12692)

- Before: AI and Machine Learning
- After: AI and Machine Learning; Business Intelligence and Analytics
- Basis: ML engineering, data science, quantitative financial research and visualization. No explicit programming stack to invent software tags.

### Pushpalatha Ongolu (#14087)

- Before: Software Engineering / Full Stack Engineering; Software Engineering / Java Engineering; Software Engineering / Backend Engineering
- After: Software Engineering; Software subtypes: Java Engineering
- Basis: Long-term Java/J2EE/Spring Boot microservices and React/Angular enterprise application development.

### Syed Hammadul Haque (#14426)

- Before: AI and Machine Learning
- After: AI and Machine Learning; Data Engineering; Software Engineering; Software subtypes: Python Engineering
- Basis: GenAI/RAG and ML pipelines; Python serverless AI microservices and enterprise Databricks/Snowflake data engineering.

### Brooke Jones (#16914)

- Before: Cloud, DevOps and Reliability
- After: Cloud, DevOps and Reliability; Cybersecurity; Software Engineering; Software subtypes: Java Engineering
- Basis: Dedicated cloud DevOps and cybersecurity work (malware/intrusion/vulnerability analysis), plus Java/Node API integration delivery.

### Ryan Alman (#20816)

- Before: AI and Machine Learning
- After: AI and Machine Learning; Business Intelligence and Analytics; Data Engineering
- Basis: Production causal/predictive models, experimentation/growth analytics and Spark feature/data pipelines.

### David Alden (#20817)

- Before: Cloud, DevOps and Reliability
- After: Cloud, DevOps and Reliability; Software Engineering; Software subtypes: Python Engineering, Java Engineering
- Basis: Lead AWS/CI-CD DevOps plus earlier Python SQLAlchemy web interfaces and C++/Java model-selection application development.

## Recovery

[Previous tags and review record](./review-and-backup.json) contains the original classification rows and decisions. [Restore script](./restore-previous-tags.sql) restores only these classification changes and aborts if source content or resulting tags have changed. It is a recovery artifact, not executed. Normal updated timestamps are not rolled back.

The application script was first tested inside a rolled-back transaction, then committed and verified with an independent read. The only repository configuration change adds this private artifacts folder to .gitignore.
