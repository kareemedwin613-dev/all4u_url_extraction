import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, Select, Space, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { copyApplicationCoverLetter, prepareApplicationQaPrompt, downloadApplicationCoverLetter, downloadApplicationResume, formatMineResumeOptionLabel, listMyApplications, startApplicationExtensionAction } from "../../services/application-service.js";
import { createPreparedCopy } from "../../services/prepared-copy.js";
import { PANEL_APPLICATIONS_KEY, panelApplicationItems } from "../../shared/page-applications.js";
import { APPLIER_STATUS_FILTER_OPTIONS } from "../../shared/applier-application-statuses.js";
import { ApplicationCard } from "../components/ApplicationCard.jsx";
import { ApplicationStatusModal } from "../components/ApplicationStatusModal.jsx";

const { Text } = Typography;
const VISIBLE_STATUSES = new Set(["ASSIGNED", "IN_PROGRESS", "BLOCKED", "APPLIED"]);
function matchesStatusFilter(applicationStatus, filter) {
  if (!filter) return VISIBLE_STATUSES.has(applicationStatus);
  if (filter === "ASSIGNED") return applicationStatus === "ASSIGNED" || applicationStatus === "IN_PROGRESS";
  return applicationStatus === filter;
}

export function MyApplicationsView({ client, backendBaseUrl, onStatus, onError }) {
  const [status, setStatus] = useState("ASSIGNED");
  const [resumeFilter, setResumeFilter] = useState("");
  const [screenshotFeedback, setScreenshotFeedback] = useState("");
  const [items, setItems] = useState(null);
  const [resumes, setResumes] = useState([]);
  const [total, setTotal] = useState(0);
  const [editingApplication, setEditingApplication] = useState(null);
  const [extensionBusy, setExtensionBusy] = useState("");
  const [readyPromptId, setReadyPromptId] = useState("");
  const copyPreparedPrompt = useMemo(() => createPreparedCopy(
    id => prepareApplicationQaPrompt(client, backendBaseUrl, id),
  ), [client, backendBaseUrl]);
  useEffect(() => { setReadyPromptId(""); }, [copyPreparedPrompt]);

  async function startExtensionAction(application, action) {
    const key=`${application.id}:${action}`;
    setExtensionBusy(key);
    try {
      // Profile review (PROFILE_REVIEW_REQUIRED) and Resume checks run inside the shared start.
      const { handoff }=await startApplicationExtensionAction(client,backendBaseUrl,application.id,action);
      const targetHost=handoff?.targetUrl?new URL(handoff.targetUrl).hostname:"";
      const actionLabel=action==="LOAD_RESUME"?"Resume attachment":"Autofill";
      onStatus({message:handoff?.usedCurrentTab?`${actionLabel} started on this tab${targetHost?` (${targetHost})`:""}. You can switch to another job tab and start it too.`:`${actionLabel} context is active.`,kind:"info"});
    } catch(error) {
      onError(error);
    } finally { setExtensionBusy(""); }
  }

  // Job pages offer these Applications in their on-page Autofill button.
  useEffect(() => {
    if (!items) return;
    chrome.storage.session.set({ [PANEL_APPLICATIONS_KEY]: { updatedAt: Date.now(), items: panelApplicationItems(items) } }).catch(() => {});
  }, [items]);

  async function reload({ nextStatus = status, nextResumeId = resumeFilter, nextScreenshotFeedback = screenshotFeedback } = {}) {
    try {
      // Status-scoped profile resume options come from the full matching set on the server.
      // Items are limited to 100 after status (+ optional profile resume) filters.
      let activeResumeId = nextResumeId;
      let data = await listMyApplications(client, backendBaseUrl, {
        status: nextStatus,
        resumeId: activeResumeId,
        screenshotFeedback: nextScreenshotFeedback,
        sort: "assigned_asc",
      });
      if (activeResumeId && !data.resumes.some((resume) => resume.id === activeResumeId)) {
        activeResumeId = "";
        setResumeFilter("");
        data = await listMyApplications(client, backendBaseUrl, {
          status: nextStatus,
          resumeId: "",
          screenshotFeedback: nextScreenshotFeedback,
          sort: "assigned_asc",
        });
      }
      setItems(data.items);
      setResumes(data.resumes);
      setTotal(data.total);
    } catch (error) {
      onError(error);
    }
  }

  function handleSaved(updated) {
    setEditingApplication(null);
    setItems((rows) => {
      if (!rows) return rows;
      const index = rows.findIndex((row) => row.id === updated.id);
      if (index < 0) return rows;
      if (!matchesStatusFilter(updated.status, status)) {
        setTotal((value) => Math.max(0, value - 1));
        return rows.filter((row) => row.id !== updated.id);
      }
      return rows.map((row) => row.id === updated.id ? { ...row, ...updated } : row);
    });
  }

  async function downloadResume(application) {
    const key = `${application.id}:DOWNLOAD_RESUME`;
    setExtensionBusy(key);
    onStatus({ message: "Preparing Resume download…", kind: "info" });
    try {
      const result = await downloadApplicationResume(client, backendBaseUrl, application.id, undefined, { companyName: application.company });
      onStatus({
        message: `${result.resumeType === "TAILORED" ? "Tailored" : "Original"} Resume #${result.resumeNumber} saved to Downloads as ${result.downloadName||result.filename}.`,
        kind: "success",
      });
    } catch (error) { onError(error); }
    finally { setExtensionBusy(""); }
  }

  async function downloadCoverLetter(application) {
    setExtensionBusy(`${application.id}:DOWNLOAD_COVER_LETTER`);
    onStatus({ message: "Preparing cover letter…", kind: "info" });
    try {
      const result = await downloadApplicationCoverLetter(client, backendBaseUrl, application.id, undefined, { companyName: application.company, candidateName: application.candidate_name });
      onStatus({
        message: `${result.kind === "TAILORED" ? "Tailored" : "Base"} cover letter saved to Downloads as ${result.downloadName}.`,
        kind: "success",
      });
    } catch (error) { onError(error); }
    finally { setExtensionBusy(""); }
  }

  async function copyCoverLetter(application) {
    setExtensionBusy(`${application.id}:COPY_COVER_LETTER`);
    onStatus({ message: "Preparing cover letter text...", kind: "info" });
    try {
      await copyApplicationCoverLetter(client, backendBaseUrl, application.id);
      onStatus({ message: "Cover letter copied as plain text. Ready to paste.", kind: "success" });
    } catch (error) { onError(error); }
    finally { setExtensionBusy(""); }
  }

  async function copyQaPrompt(application) {
    setExtensionBusy(`${application.id}:COPY_QA_PROMPT`);
    onStatus({ message: readyPromptId === application.id ? "Copying prepared prompt..." : "Preparing Resume and JD prompt...", kind: "info" });
    setReadyPromptId("");
    try {
      const result = await copyPreparedPrompt(application.id);
      if (!result.copied) {
        setReadyPromptId(application.id);
        onStatus({ message: "Prompt ready. Click Copy prepared prompt to copy it without loading again.", kind: "info" });
        return;
      }
      onStatus({ message: `Q&A prompt copied with the ${result.resumeType === "TAILORED" ? "tailored" : "original"} Resume and JD. Paste into ChatGPT, then ask your questions.`, kind: "success" });
    } catch (error) { onError(error); }
    finally { setExtensionBusy(""); }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumeOptions = useMemo(
    () => [
      { value: "", label: "All profiles" },
      ...resumes.map((resume) => ({
        value: resume.id,
        label: formatMineResumeOptionLabel(resume),
      })),
    ],
    [resumes],
  );

  return (
    <>
      <Card style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            style={{ width: 200 }}
            value={status}
            options={APPLIER_STATUS_FILTER_OPTIONS}
            onChange={(value) => {
              setStatus(value);
              setResumeFilter("");
              reload({ nextStatus: value, nextResumeId: "" });
            }}
          />
          <Select
            style={{ width: 220 }}
            allowClear
            value={screenshotFeedback || undefined}
            placeholder="Screenshot feedback"
            options={[
              { value: "HAS_FEEDBACK", label: "Has feedback (mistakes)" },
              { value: "NO_FEEDBACK", label: "No feedback" },
            ]}
            onChange={(value) => {
              const next = value || "";
              setScreenshotFeedback(next);
              reload({ nextScreenshotFeedback: next });
            }}
          />
          <Select
            style={{ width: 260 }}
            value={resumeFilter}
            options={resumeOptions}
            onChange={(value) => {
              setResumeFilter(value);
              reload({ nextResumeId: value });
            }}
            placeholder="Search candidate or profile"
            showSearch
            optionFilterProp="label"
            virtual
            listHeight={280}
          />
          <Button icon={<ReloadOutlined />} onClick={() => reload()}>
            Refresh
          </Button>
        </Space>
        {items && total > items.length ? (
          <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            Showing {items.length} of {total} Applications for this filter.
          </Text>
        ) : null}
      </Card>
      {!items ? null : !items.length ? (
        <Card>
          <Empty
            description={
              resumeFilter
                ? "No Applications match this profile filter."
                : "No Applications are currently assigned to you."
            }
          />
        </Card>
      ) : (
        items.map((application) => (
          <ApplicationCard key={application.id} application={application} onUpdateStatus={setEditingApplication} onExtensionAction={startExtensionAction} onDownloadResume={downloadResume} onDownloadCoverLetter={downloadCoverLetter} onCopyCoverLetter={copyCoverLetter} onCopyQaPrompt={copyQaPrompt} readyPromptId={readyPromptId} extensionBusy={extensionBusy} />
        ))
      )}
      {editingApplication && (
        <ApplicationStatusModal
          application={editingApplication}
          client={client}
          backendBaseUrl={backendBaseUrl}
          onClose={() => setEditingApplication(null)}
          onSaved={handleSaved}
          onStatus={onStatus}
          onError={onError}
        />
      )}
    </>
  );
}
