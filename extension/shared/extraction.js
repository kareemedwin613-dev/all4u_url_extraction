// This function is injected into the active tab and therefore intentionally has no external dependencies.
export function extractJobFromPage(useSelection = false) {
  const cleanText = (value) => String(value || "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const textFromHtml = (html) => {
    const container = document.createElement("div");
    container.innerHTML = String(html || "");
    container.querySelectorAll("script,style,noscript,[hidden],[aria-hidden='true']").forEach((node) => node.remove());
    container.querySelectorAll("br,p,li,div,h1,h2,h3,h4").forEach((node) => node.append(document.createTextNode("\n")));
    return cleanText(container.textContent);
  };
  const visibleText = (element) => {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return "";
    const style = getComputedStyle(element);
    return style.display === "none" || style.visibility === "hidden" ? "" : cleanText(element.innerText || element.textContent);
  };
  const firstMeaningful = (selectors, min = 2, max = Infinity, singleLine = false) => {
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const text = visibleText(element);
        if (text.length >= min && text.length <= max && (!singleLine || !text.includes("\n"))) return text;
      }
    }
    return "";
  };
  const walk = (value, seen = new Set()) => {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.some((type) => String(type).toLowerCase() === "jobposting")) return value;
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      const match = walk(child, seen);
      if (match) return match;
    }
    return null;
  };
  let posting = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { posting = walk(JSON.parse(script.textContent)); } catch { /* Ignore malformed JSON-LD blocks. */ }
    if (posting) break;
  }
  const meta = (property) => document.querySelector(`meta[property='${property}'],meta[name='${property}']`)?.content || "";
  const isGenericCompany = (value) => /^(?:job\s*boards?|careers?|jobs?|greenhouse|lever|workday|recruiting|recruitment|apply)$/i.test(cleanText(value));
  const companyCandidate = (...values) => values.map(cleanText).find((value) => value && value.length <= 100 && !isGenericCompany(value)) || "";
  const siteCompany = () => {
    const applicationName = cleanText(meta("application-name"));
    if (applicationName && applicationName.length <= 100 && !/\b(careers?|jobs?)\b/i.test(applicationName) && !isGenericCompany(applicationName)) return applicationName;
    const siteName = cleanText(meta("og:site_name"));
    if (siteName && siteName.length <= 100 && !isGenericCompany(siteName)) return siteName.replace(/\.io$/i, "");
    const titlePrefix = cleanText(document.title).split(/\s+(?:[-|–—]\s*)careers?\b/i)[0].trim();
    if (titlePrefix && titlePrefix.length <= 100 && !/\b(careers?|jobs?)\b/i.test(titlePrefix)) return titlePrefix;
    const hostLabel = location.hostname.replace(/^www\./, "").split(".")[0];
    const genericHosts = new Set(["jobs", "careers", "boards", "recruiting", "apply", "greenhouse", "lever", "workday"]);
    return hostLabel && !genericHosts.has(hostLabel.toLowerCase()) ? hostLabel.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "";
  };
  const titleSelectors = [".iCIMS_Header", ".job-preview-title", ".jobs-unified-top-card__job-title", "[data-testid='job-title']", "[data-testid*='jobTitle']", "[class*='job-title']", "[class*='jobTitle']", "h1"];
  const companySelectors = [".jobs-unified-top-card__company-name", "[data-testid='company-name']", "[data-testid*='company']", "[class*='company-name']", "[class*='companyName']"];
  const locationSelectors = [".jobs-unified-top-card__bullet", ".job-preview-location", ".iCIMS_JobHeaderField", "[data-testid='job-location']", "[data-testid*='location']", "[class*='job-location']", "[class*='jobLocation']", "[class~='location']"];
  const descriptionSelectors = [".iCIMS_JobContent", ".job-preview-details", ".jobs-description-content__text", ".jobs-description", "#job-details", "#job-description", ".job-description", "[data-testid='job-description']", "[data-testid*='jobDescription']", "[class*='job-description']", "[class*='jobDescription']"];
  const salarySelectors = ["[data-testid*='salary']", "[data-testid*='compensation']", "[class*='salary-range']", "[class*='salaryRange']", "[class~='salary']", "[class*='compensation']"];
  const selection = cleanText(window.getSelection()?.toString());
  if (useSelection && selection.length < 100) return { error: { code: "SELECTION_EMPTY" } };
  let company = companyCandidate(posting?.hiringOrganization?.name,firstMeaningful(companySelectors, 2, 100, true),siteCompany());
  let jobTitle = cleanText(posting?.title) || firstMeaningful(titleSelectors) || cleanText(meta("og:title").replace(/^Career Opportunities\s*-\s*/i, ""));
  let jobDescription = "";
  let captureMethod = "manual";
  let extractionConfidence = "low";
  if (useSelection) {
    jobDescription = selection; captureMethod = "selection"; extractionConfidence = company && jobTitle ? "high" : "medium";
  } else if (posting && cleanText(posting.title) && cleanText(posting.hiringOrganization?.name) && textFromHtml(posting.description).length >= 100) {
    jobDescription = textFromHtml(posting.description); captureMethod = "json_ld"; extractionConfidence = "high";
  } else {
    jobDescription = firstMeaningful(descriptionSelectors, 100);
    if (jobDescription) { captureMethod = "known_selector"; extractionConfidence = jobTitle ? "medium" : "low"; }
    if (!jobDescription) {
      const generic = [...document.querySelectorAll("main,article,[class*='job'],[id*='job'],[class*='description'],[id*='description'],[class*='posting'],[id*='posting'],[class*='details'],[id*='details']")]
        .map((element) => ({ text: visibleText(element), element })).filter(({ text }) => text.length >= 100).sort((a, b) => b.text.length - a.text.length)[0];
      if (generic) { jobDescription = generic.text; captureMethod = generic.element.matches("main,article") ? "main_fallback" : "generic_selector"; }
      else if (cleanText(meta("og:description")).length >= 100) {
        jobDescription = cleanText(meta("og:description")); captureMethod = "generic_selector";
      } else {
        const mainText = firstMeaningful(["main", "article", "body"], 100);
        if (mainText) { jobDescription = mainText; captureMethod = "main_fallback"; }
      }
    }
  }
  let sourceUrl = posting?.url ? String(posting.url) : location.href;
  try { sourceUrl = new URL(sourceUrl, location.href).href; } catch { sourceUrl = location.href; }
  const locations=(Array.isArray(posting?.jobLocation)?posting.jobLocation:[posting?.jobLocation]).filter(Boolean).map((item)=>item?.address||item).map((address)=>typeof address==="string"?cleanText(address):cleanText([address?.addressLocality,address?.addressRegion,address?.postalCode,address?.addressCountry?.name||address?.addressCountry].filter(Boolean).join(", "))).filter(Boolean);
  const remotePosting=String(posting?.jobLocationType||"").toUpperCase()==="TELECOMMUTE";
  const locationMeta=cleanText(meta("job-location")||meta("job_location")||meta("geo.placename"));
  const locationElement=firstMeaningful(locationSelectors,2,300,true);
  const descriptionLocation=jobDescription.match(/(?:^|\n)(?:job |work |office |company )?location\s*:?\s*([^\n]{2,150})/i)?.[1]||"";
  const extractedLocation=cleanText(locations.join("; ")||locationMeta||locationElement||descriptionLocation);
  const salaryNode=posting?.baseSalary||{},salaryValue=salaryNode?.value||salaryNode||{};
  const salaryMin=Number.isFinite(Number(salaryValue?.minValue))?Number(salaryValue.minValue):(Number.isFinite(Number(salaryValue?.value))?Number(salaryValue.value):null);
  const salaryMax=Number.isFinite(Number(salaryValue?.maxValue))?Number(salaryValue.maxValue):salaryMin;
  const salaryCurrency=cleanText(salaryNode?.currency||posting?.salaryCurrency).toUpperCase();
  const salaryPeriod=cleanText(salaryValue?.unitText).toUpperCase();
  const salaryElement=firstMeaningful(salarySelectors,3,500,true);
  const salaryText=salaryElement||[salaryCurrency,salaryMin,salaryMax!==salaryMin?`- ${salaryMax}`:"",salaryPeriod].filter((value)=>value!==null&&value!=="").join(" ");
  return {
    company, jobTitle, sourceUrl, sourceSite: location.hostname.replace(/^www\./, ""), jobDescription,
    location:remotePosting?"":extractedLocation,workArrangement:remotePosting?"REMOTE":"",
    salary:{min:salaryMin,max:salaryMax,currency:salaryCurrency,period:salaryPeriod,text:salaryText},
    captureMethod, extractionConfidence, capturedAtClient: new Date().toISOString()
  };
}

export function selectBestFrameExtraction(injectionResults = []) {
  const priority={selection:5,json_ld:4,known_selector:3,generic_selector:2,main_fallback:1,manual:0};
  const best=injectionResults.filter(({result})=>result?.jobDescription).sort((a,b)=>{
    const score=({result})=>(priority[result.captureMethod]||0)*100000+(result.company?10000:0)+(result.jobTitle?10000:0)+Math.min(result.jobDescription.length,50000);
    return score(b)-score(a)||(a.frameId===0?-1:b.frameId===0?1:0);
  })[0]||null;
  if(!best||best.frameId===0)return best;
  const generic=/^(?:job\s*boards?|careers?|jobs?|greenhouse|lever|workday|recruiting|recruitment|apply)$/i;
  const outer=injectionResults.find(({frameId,result})=>frameId===0&&result?.company&&!generic.test(String(result.company).trim()));
  if((!best.result.company||generic.test(String(best.result.company).trim()))&&outer)return {...best,result:{...best.result,company:outer.result.company}};
  return best;
}
