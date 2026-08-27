import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, Select, Space, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { createApplicationExtensionSession, downloadApplicationResume, getApplicationExtensionContext, listMyApplications, updateApplicationExtensionSession } from "../../services/application-service.js";
import { MESSAGE_TYPES } from "../../shared/messages.js";
import { ApplicationCard } from "../components/ApplicationCard.jsx";
import { ApplicationStatusModal } from "../components/ApplicationStatusModal.jsx";

const { Text } = Typography;

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "BLOCKED", label: "Blocked" },
  { value: "APPLIED", label: "Applied" },
  { value: "SCREENING", label: "Screening" },
  { value: "INTERVIEW_SCHEDULED", label: "Interview Scheduled" },
  { value: "OFFER_RECEIVED", label: "Offer Received" },
  { value: "REJECTED", label: "Rejected" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export function MyApplicationsView({ client, backendBaseUrl, onStatus, onError }) {
  const [status, setStatus] = useState("");
  const [resumeFilter, setResumeFilter] = useState("");
  const [items, setItems] = useState(null);
  const [resumes, setResumes] = useState([]);
  const [total, setTotal] = useState(0);
  const [editingApplication, setEditingApplication] = useState(null);
  const [extensionBusy, setExtensionBusy] = useState("");

  async function startExtensionAction(application, action) {
    const key=`${application.id}:${action}`;
    setExtensionBusy(key);
    let extensionSession;
    try {
      const context=await getApplicationExtensionContext(client,backendBaseUrl,application.id);
      if(action==="AUTOFILL"&&!context?.candidate?.profileAvailable)throw Object.assign(new Error("Verify this Resume's Autofill Metadata in the dashboard before using Autofill."),{code:"PROFILE_REVIEW_REQUIRED"});
      if(action==="AUTOFILL"&&!context?.permissions?.canAutofill)throw Object.assign(new Error("This Application needs an active Resume and a valid HTTP(S) job URL before Autofill can start."),{code:"APPLICATION_AUTOFILL_UNAVAILABLE"});
      if(action==="LOAD_RESUME"&&!context?.permissions?.canLoadResume)throw Object.assign(new Error("The Resume connected to this Application is not active."),{code:"APPLICATION_RESUME_UNAVAILABLE"});
      extensionSession=await createApplicationExtensionSession(client,backendBaseUrl,application.id,action);
      const result=await chrome.runtime.sendMessage({type:MESSAGE_TYPES.HANDOFF_APPLICATION_SESSION,payload:extensionSession});
      if(!result?.ok)throw Object.assign(new Error(result?.error?.message||"The Application could not be activated."),{code:result?.error?.code});
      await updateApplicationExtensionSession(client,backendBaseUrl,extensionSession.id,"RECEIVED");
      const targetHost=result.data?.targetTabUrl?new URL(result.data.targetTabUrl).hostname:"";
      onStatus({message:action==="AUTOFILL"&&result.data?.usedCurrentTab?`Autofill is active on the current tab${targetHost?` (${targetHost})`:""}.`:`${action==="LOAD_RESUME"?"Resume loading":"Autofill"} context is active.`,kind:"success"});
    } catch(error) {
      if(extensionSession?.id)await updateApplicationExtensionSession(client,backendBaseUrl,extensionSession.id,"FAILED","HANDOFF_FAILED").catch(()=>{});
      onError(error);
    } finally { setExtensionBusy(""); }
  }

  async function reload({ nextStatus = status, nextResumeId = resumeFilter } = {}) {
    try {
      // Status-scoped resume options come from the full matching set on the server.
      // Items are limited to 100 after status (+ optional resume) filters.
      let activeResumeId = nextResumeId;
      let data = await listMyApplications(client, backendBaseUrl, {
        status: nextStatus,
        resumeId: "",
      });
      if (activeResumeId && !data.resumes.some((resume) => resume.id === activeResumeId)) {
        activeResumeId = "";
        setResumeFilter("");
      }
      if (activeResumeId) {
        data = await listMyApplications(client, backendBaseUrl, {
          status: nextStatus,
          resumeId: activeResumeId,
        });
      }
      setItems(data.items);
      setResumes(data.resumes);
      setTotal(data.total);
    } catch (error) {
      onError(error);
    }
  }

  async function downloadResume(application) {
    const key = `${application.id}:DOWNLOAD_RESUME`;
    setExtensionBusy(key);
    try {
      const result = await downloadApplicationResume(client, backendBaseUrl, application.id);
      onStatus({ message: `${result.resumeType === "TAILORED" ? "Tailored" : "Original"} Resume #${result.resumeNumber} download started.`, kind: "success" });
    } catch (error) { onError(error); }
    finally { setExtensionBusy(""); }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumeOptions = useMemo(
    () => [
      { value: "", label: "All resumes" },
      ...resumes.map((resume) => ({
        value: resume.id,
        label: resume.resumeName || `Resume #${resume.resumeNumber || "?"}`,
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
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setStatus(value);
              setResumeFilter("");
              reload({ nextStatus: value, nextResumeId: "" });
            }}
          />
          <Select
            style={{ width: 220 }}
            value={resumeFilter}
            options={resumeOptions}
            onChange={(value) => {
              setResumeFilter(value);
              reload({ nextResumeId: value });
            }}
            placeholder="Filter by resume"
            showSearch
            optionFilterProp="label"
          />
          <Button icon={<ReloadOutlined />} onClick={() => reload()}>
            Refresh
          </Button>
        </Space>
        {items && total > items.length ? (
          <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            Showing {items.length} of {total} Applications for this Status{resumeFilter ? " + Resume" : ""} filter.
          </Text>
        ) : null}
      </Card>
      {!items ? null : !items.length ? (
        <Card>
          <Empty
            description={
              resumeFilter
                ? "No Applications match this resume filter."
                : "No Applications are currently assigned to you."
            }
          />
        </Card>
      ) : (
        items.map((application) => (
          <ApplicationCard key={application.id} application={application} onUpdateStatus={setEditingApplication} onExtensionAction={startExtensionAction} onDownloadResume={downloadResume} extensionBusy={extensionBusy} />
        ))
      )}
      {editingApplication && (
        <ApplicationStatusModal
          application={editingApplication}
          client={client}
          backendBaseUrl={backendBaseUrl}
          onClose={() => setEditingApplication(null)}
          onSaved={() => {
            setEditingApplication(null);
            reload();
          }}
          onStatus={onStatus}
          onError={onError}
        />
      )}
    </>
  );
}
