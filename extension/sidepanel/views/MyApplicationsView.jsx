import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Empty, Select, Space } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { createApplicationExtensionSession, getApplicationExtensionContext, listMyApplications, updateApplicationExtensionSession } from "../../services/application-service.js";
import { MESSAGE_TYPES } from "../../shared/messages.js";
import { ApplicationCard } from "../components/ApplicationCard.jsx";
import { ApplicationStatusModal } from "../components/ApplicationStatusModal.jsx";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "NOT_APPLIED", label: "Not Applied" },
  { value: "APPLIED", label: "Applied" },
  { value: "SCREENING", label: "Screening" },
  { value: "INTERVIEW_SCHEDULED", label: "Interview Scheduled" },
  { value: "OFFER_RECEIVED", label: "Offer Received" },
  { value: "REJECTED", label: "Rejected" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "CLOSED", label: "Closed" },
];

export function MyApplicationsView({ client, backendBaseUrl, onStatus, onError }) {
  const [applicationStatus, setApplicationStatus] = useState("");
  const [resumeFilter, setResumeFilter] = useState("");
  const [items, setItems] = useState(null);
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

  async function reload(nextStatus = applicationStatus) {
    try {
      setItems(await listMyApplications(client, backendBaseUrl, { applicationStatus: nextStatus }));
    } catch (error) {
      onError(error);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumeOptions = useMemo(() => {
    const names = [...new Set((items || []).map((application) => application.resume_name).filter(Boolean))].sort();
    return [{ value: "", label: "All resumes" }, ...names.map((name) => ({ value: name, label: name }))];
  }, [items]);

  const filteredItems = useMemo(
    () => (items || []).filter((application) => !resumeFilter || application.resume_name === resumeFilter),
    [items, resumeFilter],
  );

  return (
    <>
      <Card style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select
            style={{ width: 200 }}
            value={applicationStatus}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setApplicationStatus(value);
              reload(value);
            }}
          />
          <Select
            style={{ width: 200 }}
            value={resumeFilter}
            options={resumeOptions}
            onChange={setResumeFilter}
            placeholder="Filter by resume"
          />
          <Button icon={<ReloadOutlined />} onClick={() => reload()}>
            Refresh
          </Button>
        </Space>
      </Card>
      {!items ? null : !filteredItems.length ? (
        <Card>
          <Empty
            description={
              items.length ? "No Applications match this resume filter." : "No Applications are currently assigned to you."
            }
          />
        </Card>
      ) : (
        filteredItems.map((application) => (
          <ApplicationCard key={application.id} application={application} onUpdateStatus={setEditingApplication} onExtensionAction={startExtensionAction} extensionBusy={extensionBusy} />
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
