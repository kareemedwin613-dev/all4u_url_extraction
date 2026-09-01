import type { TailoringInput, TailoringOutput } from "../src/types.js";

export const validationDate=new Date("2026-08-03T12:00:00.000Z");

export function compliantOutput(input:TailoringInput):TailoringOutput{
  return{
    summary:"Senior Data Engineer delivering reliable cloud data platforms and reporting systems with Python, SQL, Snowflake, and AWS. Builds batch and streaming pipelines, automated data-quality controls, and optimized warehouse workflows that support analytics teams at production scale. Applies SSIS, Jenkins, and GitHub Actions to strengthen ETL delivery, CI/CD practices, operational documentation, and system reliability while partnering with business teams on Tableau and Power BI reporting.",
    professionalExperience:[
      {
        sourceExperienceId:"amazon-data-engineer",
        tailoredDetails:[
          "- Modernized cloud data-platform delivery by moving reporting marts from SQL Server into Snowflake and Redshift.",
          "- Scaled reliable batch processing beyond 100 million rows per run through SSIS, Python, validation automation, and exception-handling controls.",
          "- Connected AWS event streams to analytical dashboards, supplying real-time data for downstream reporting.",
          "- Standardized production releases with Jenkins and GitHub Actions, embedding CI/CD practices into platform delivery.",
          "- Translated business reporting needs into curated Tableau and Power BI outputs through cross-functional delivery."
        ].join("\n")
      },
      {
        sourceExperienceId:"contoso-data-engineer",
        tailoredDetails:[
          "- Delivered financial-reporting data flows by pairing Python and SQL ingestion logic.",
          "- Established operational safeguards through data-quality controls and maintainable production documentation.",
          "- Optimized warehouse query paths to make curated analytical data more accessible to reporting users.",
          "- Equipped analysts with dependable datasets for recurring reporting and downstream analysis.",
          "- Unified ingestion, quality, query-tuning, and documentation practices into an operable reporting workflow."
        ].join("\n")
      }
    ],
    skills:["Python","SQL","Snowflake","AWS","SSIS","Jenkins","GitHub Actions","Data Quality"],
    changeSummary:["Rebuilt source evidence into JD-aligned project narratives."],
    unsupportedRequirements:["Kubernetes"],
    warnings:["Quantified evidence is unavailable for contoso-data-engineer."]
  };
}
